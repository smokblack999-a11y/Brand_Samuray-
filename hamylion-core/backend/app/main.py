import hashlib
import uuid
from datetime import datetime

from fastapi import Depends, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from .auth import authenticate_api_key, ensure_bootstrap_project, validate_api_key
from .config import settings
from .db import SessionLocal, engine
from .models import Base, Event
from .queue import enqueue_event
from .schemas import EventRequest, EventResponse
from .websocket import manager

app = FastAPI(title="HAMYLION Core", version="3.0.0")

@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await ensure_bootstrap_project()

@app.get("/health")
async def health():
    return {"status": "ok", "service": "hamylion-core", "version": "3.0.0"}

def _event_dict(event: Event) -> dict:
    return {
        "event_id": event.id,
        "type": event.event_type,
        "payload": event.payload,
        "status": event.status,
        "attempts": event.attempts,
        "created_at": event.created_at,
        "dispatched_at": event.dispatched_at,
        "delivered_at": event.delivered_at,
        "last_error": event.last_error,
    }

@app.post("/v1/events", response_model=EventResponse)
async def create_event(request: EventRequest, project_id: str = Depends(validate_api_key)):
    idem = request.idempotency_key or hashlib.sha256(
        (request.type + ":" + repr(sorted(request.payload.items()))).encode("utf-8")
    ).hexdigest()
    async with SessionLocal() as session:
        result = await session.execute(
            select(Event).where(Event.project_id == project_id, Event.idempotency_key == idem)
        )
        found = result.scalar_one_or_none()
        if found:
            return EventResponse(event_id=found.id, status=found.status)

        event = Event(
            id=f"evt_{uuid.uuid4().hex}",
            project_id=project_id,
            event_type=request.type,
            payload=request.payload,
            status="queued",
            idempotency_key=idem,
        )
        session.add(event)
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            result = await session.execute(
                select(Event).where(Event.project_id == project_id, Event.idempotency_key == idem)
            )
            found = result.scalar_one()
            return EventResponse(event_id=found.id, status=found.status)

    try:
        await enqueue_event({
            "id": event.id,
            "project_id": project_id,
            "type": event.event_type,
            "payload": event.payload,
        })
    except Exception as exc:
        async with SessionLocal() as session:
            result = await session.execute(select(Event).where(Event.id == event.id))
            stored = result.scalar_one_or_none()
            if stored:
                stored.status = "queue_error"
                stored.last_error = str(exc)[:2000]
                await session.commit()
        raise HTTPException(status_code=503, detail="Queue unavailable")

    return EventResponse(event_id=event.id, status="queued")

@app.get("/v1/events/{event_id}")
async def get_event(event_id: str, project_id: str = Depends(validate_api_key)):
    async with SessionLocal() as session:
        result = await session.execute(select(Event).where(Event.id == event_id, Event.project_id == project_id))
        event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return _event_dict(event)

@app.post("/v1/events/{event_id}/ack")
async def ack_event(event_id: str, project_id: str = Depends(validate_api_key)):
    async with SessionLocal() as session:
        result = await session.execute(select(Event).where(Event.id == event_id, Event.project_id == project_id))
        event = result.scalar_one_or_none()
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")
        event.status = "delivered"
        event.delivered_at = datetime.utcnow()
        await session.commit()
    return {"event_id": event_id, "status": "delivered"}

@app.get("/v1/events")
async def list_events(
    status: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    project_id: str = Depends(validate_api_key),
):
    async with SessionLocal() as session:
        stmt = select(Event).where(Event.project_id == project_id)
        if status:
            stmt = stmt.where(Event.status == status)
        stmt = stmt.order_by(Event.created_at.desc()).limit(limit)
        result = await session.execute(stmt)
        rows = result.scalars().all()
    return {"events": [_event_dict(row) for row in rows]}

@app.websocket("/v1/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    project_id: str = Query("default-project"),
    api_key: str | None = Query(default=None),
):
    try:
        authenticated_project = await authenticate_api_key(api_key)
        if authenticated_project != project_id:
            await websocket.close(code=1008)
            return
    except HTTPException:
        await websocket.close(code=1008)
        return

    await manager.connect(project_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await manager.disconnect(project_id, websocket)
