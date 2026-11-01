from pydantic import BaseModel, Field, field_validator
from datetime import datetime

class EventIn(BaseModel):
    source_id: str = Field(min_length=1, max_length=128)
    event_id: str = Field(min_length=1, max_length=160)
    event_type: str = Field(default="plate_observed", min_length=1, max_length=64)
    occurred_at: datetime
    plate_text: str = Field(min_length=1, max_length=32)
    ocr_confidence: float = Field(ge=0.0, le=1.0)
    frame_sha256: str | None = Field(default=None, pattern=r"^[a-fA-F0-9]{64}$")

    @field_validator("occurred_at")
    @classmethod
    def timezone_required(cls, value):
        if value.tzinfo is None:
            raise ValueError("occurred_at must include timezone")
        return value

class EventOut(BaseModel):
    ok: bool
    duplicate: bool
    event: dict
    decision: dict
