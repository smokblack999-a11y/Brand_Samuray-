from typing import Any
from pydantic import BaseModel, Field

class EventRequest(BaseModel):
    type: str = Field(min_length=1, max_length=128)
    payload: dict[str, Any]
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=256)

class EventResponse(BaseModel):
    event_id: str
    status: str
