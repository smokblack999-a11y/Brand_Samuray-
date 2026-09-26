import asyncio
import json
import os
from datetime import datetime, timedelta

from sqlalchemy import select, update

from app.config import settings
from app.db import SessionLocal
from app.models import Event
from app.queue import ensure_group, reclaim_pending, redis_client
from app.websocket import manager

def backoff(attempt: int) -> int:
    return min(300, settings.RETRY_BASE_SECONDS * (2 ** max(0, attempt - 1)))

async def requeue_stale():
    cutoff = datetime.utcnow() - timedelta(seconds=settings.ACK_TIMEOUT_SECONDS)
    rows = []
    async with SessionLocal() as session:
        result = await session.execute(
            select(Event).where(Event.status == "dispatched", Event.dispatched_at < cutoff)
        )
        rows = result.scalars().all()
        for event in rows:
            event.status = "queued"
            event.next_attempt_at = datetime.utcnow()
        await session.commit()
    for event in rows:
        await redis_client.xadd(
            settings.STREAM,
            {"event": json.dumps({
                "id": event.id,
                "project_id": event.project_id,
                "type": event.event_type,
                "payload": event.payload,
            }, separators=(",", ":"))},
        )

async def process(message_id, fields):
    event_data = json.loads(fields["event"])
    event_id = event_data["id"]
    project_id = event_data["project_id"]

    async with SessionLocal() as session:
        result = await session.execute(select(Event).where(Event.id == event_id))
        event = result.scalar_one_or_none()
        if not event:
            await redis_client.xack(settings.STREAM, settings.GROUP, message_id)
            return
        if event.status == "delivered":
            await redis_client.xack(settings.STREAM, settings.GROUP, message_id)
            return
        event.attempts += 1
        event.status = "processing"
        await session.commit()

    count = await manager.broadcast(project_id, {
        "event_id": event_id,
        "type": event_data["type"],
        "payload": event_data["payload"],
        "status": "dispatched",
    })
    if count == 0:
        raise RuntimeError("no websocket destination")

    async with SessionLocal() as session:
        result = await session.execute(select(Event).where(Event.id == event_id))
        event = result.scalar_one()
        event.status = "dispatched"
        event.dispatched_at = datetime.utcnow()
        event.last_error = None
        await session.commit()
    await redis_client.xack(settings.STREAM, settings.GROUP, message_id)

async def mark_failed(event_id: str, exc: Exception):
    async with SessionLocal() as session:
        result = await session.execute(select(Event).where(Event.id == event_id))
        event = result.scalar_one_or_none()
        if not event:
            return
        if event.attempts >= settings.MAX_RETRIES:
            event.status = "deadletter"
            event.last_error = str(exc)[:2000]
            event.next_attempt_at = None
        else:
            event.status = "queued"
            event.last_error = str(exc)[:2000]
            event.next_attempt_at = datetime.utcnow() + timedelta(seconds=backoff(event.attempts))
        await session.commit()
        current = {
            "id": event.id,
            "project_id": event.project_id,
            "type": event.event_type,
            "payload": event.payload,
        }
        status = event.status
    if status == "queued":
        await asyncio.sleep(backoff(event.attempts))
        await redis_client.xadd(
            settings.STREAM,
            {"event": json.dumps(current, separators=(",", ":"))},
        )

async def handle_message(message_id, fields):
    try:
        await process(message_id, fields)
    except Exception as exc:
        try:
            event_data = json.loads(fields["event"])
            await mark_failed(event_data["id"], exc)
            await redis_client.xack(settings.STREAM, settings.GROUP, message_id)
        except Exception:
            pass

async def main():
    await ensure_group()
    consumer = "worker-" + str(os.getpid())
    ticks = 0
    while True:
        try:
            for message_id, fields in await reclaim_pending(consumer):
                await handle_message(message_id, fields)

            messages = await redis_client.xreadgroup(
                settings.GROUP, consumer, {settings.STREAM: ">"}, count=10, block=5000
            )
            for _, entries in messages:
                for message_id, fields in entries:
                    await handle_message(message_id, fields)

            ticks += 1
            if ticks % 6 == 0:
                try:
                    await requeue_stale()
                except Exception:
                    pass
        except Exception:
            await asyncio.sleep(2)

if __name__ == "__main__":
    asyncio.run(main())
