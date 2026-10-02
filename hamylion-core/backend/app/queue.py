import json
import redis.asyncio as redis
from .config import settings

redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)

async def ensure_group() -> None:
    try:
        await redis_client.xgroup_create(settings.STREAM, settings.GROUP, id="0-0", mkstream=True)
    except Exception as exc:
        if "BUSYGROUP" not in str(exc):
            raise

async def enqueue_event(event: dict) -> str:
    return await redis_client.xadd(
        settings.STREAM,
        {"event": json.dumps(event, separators=(",", ":"))},
    )

async def reclaim_pending(consumer: str, min_idle_ms: int = 30000, count: int = 20):
    cursor = "0-0"
    claimed = []
    while True:
        cursor, messages, _deleted = await redis_client.xautoclaim(
            settings.STREAM, settings.GROUP, consumer, min_idle_ms, cursor, count=count
        )
        claimed.extend(messages)
        if cursor == "0-0" or not messages:
            break
    return claimed
