import hashlib
import hmac
from fastapi import Header, HTTPException
from sqlalchemy import select
from .config import settings
from .db import SessionLocal
from .models import Project

def _hash_key(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()

async def ensure_bootstrap_project() -> None:
    if not settings.BOOTSTRAP_API_KEY:
        return
    async with SessionLocal() as session:
        result = await session.execute(select(Project).where(Project.id == "default-project"))
        if result.scalar_one_or_none() is None:
            session.add(Project(id="default-project", api_key_hash=_hash_key(settings.BOOTSTRAP_API_KEY)))
            await session.commit()

async def authenticate_api_key(value: str | None) -> str:
    if not value:
        raise HTTPException(status_code=401, detail="Missing API key")
    key_hash = _hash_key(value)
    async with SessionLocal() as session:
        result = await session.execute(select(Project).where(Project.api_key_hash == key_hash))
        project = result.scalar_one_or_none()
    if not project or not hmac.compare_digest(project.api_key_hash, key_hash):
        raise HTTPException(status_code=401, detail="Invalid API key")
    return project.id

async def validate_api_key(x_api_key: str | None = Header(default=None)) -> str:
    return await authenticate_api_key(x_api_key)
