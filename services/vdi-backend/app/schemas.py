from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field, field_validator, model_validator


class EventIn(BaseModel):
    source_id: str = Field(min_length=1, max_length=128)
    event_id: str = Field(min_length=1, max_length=160)
    event_type: Literal["plate_observed", "entry", "exit", "payment"] = "plate_observed"
    occurred_at: datetime
    # OCR fields belong to camera/vehicle events, never to payment-provider events.
    plate_text: str | None = Field(default=None, min_length=1, max_length=32)
    ocr_confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    session_id: str | None = Field(default=None, min_length=1, max_length=160)
    ticket_id: str | None = Field(default=None, min_length=1, max_length=160)
    tariff_id: str | None = Field(default=None, min_length=1, max_length=128)
    provider_event_id: str | None = Field(default=None, min_length=1, max_length=200)
    transaction_id: str | None = Field(default=None, min_length=1, max_length=200)
    payment_status: Literal["pending", "succeeded", "failed", "refunded", "voided"] | None = None
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
    def validate_event_shape(self):
        if self.tariff_id is not None and self.event_type != "entry":
            raise ValueError("tariff_id must be attached to the entry event")
        if self.event_type == "plate_observed":
            if not self.plate_text or self.ocr_confidence is None:
                raise ValueError("plate_observed requires plate_text and ocr_confidence")
        elif self.event_type in ("entry", "exit"):
            if self.plate_text and self.ocr_confidence is None:
                raise ValueError("plate_text requires ocr_confidence")
            if self.ocr_confidence is not None and not self.plate_text:
                raise ValueError("ocr_confidence requires plate_text")
            if not self.session_id and not self.ticket_id and not self.plate_text:
                raise ValueError("entry/exit requires session_id, ticket_id or plate_text with ocr_confidence")
        elif self.event_type == "payment":
            if not self.session_id and not self.ticket_id:
                raise ValueError("payment requires normalized session_id or ticket_id")
            if self.amount_minor is None:
                raise ValueError("payment requires amount_minor")
            if self.payment_status is None:
                raise ValueError("payment requires payment_status")
            if not self.provider_event_id and not self.transaction_id:
                raise ValueError("payment requires provider_event_id or transaction_id")
            if self.plate_text is not None or self.ocr_confidence is not None:
                raise ValueError("payment events must not contain OCR fields")
        return self


class EventOut(BaseModel):
    ok: bool
    duplicate: bool
    event: dict
    decision: dict



class TariffRuleIn(BaseModel):
    tariff_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._-]+$")
    currency: str = Field(min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")
    rate_minor: int = Field(ge=0)
    billing_increment_minutes: int = Field(ge=1, le=1440)
    grace_minutes: int = Field(default=0, ge=0, le=1440)
    max_charge_minor: int | None = Field(default=None, ge=0)
