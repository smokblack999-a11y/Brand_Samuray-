from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field, field_validator, model_validator


class EventIn(BaseModel):
    source_id: str = Field(min_length=1, max_length=128)
    event_id: str = Field(min_length=1, max_length=160)
    event_type: Literal["plate_observed", "entry", "exit", "payment"] = "plate_observed"
    occurred_at: datetime
    plate_text: str = Field(min_length=1, max_length=32)
    ocr_confidence: float = Field(ge=0.0, le=1.0)
    crop_sha256: str | None = Field(default=None, pattern=r"^[a-fA-F0-9]{64}$")
    amount_minor: int | None = Field(default=None, ge=0)
    currency: str = Field(default="KZT", min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")

    @field_validator("occurred_at")
    @classmethod
    def timezone_required(cls, value):
        if value.tzinfo is None:
            raise ValueError("occurred_at must include timezone")
        return value

    @model_validator(mode="after")
    def payment_amount_required(self):
        if self.event_type == "payment" and self.amount_minor is None:
            raise ValueError("amount_minor is required for payment events")
        return self


class EventOut(BaseModel):
    ok: bool
    duplicate: bool
    event: dict
    decision: dict
