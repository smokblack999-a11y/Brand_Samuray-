import re

# Standard private-vehicle format: 3 digits + 3 Latin letters + 2-digit region.
# This intentionally does not attempt to validate diplomatic, military, transit,
# legacy, special-purpose or authenticity/ownership status.
PLATE_RE = re.compile(r"^([0-9]{3})([A-Z]{3})(0[1-9]|1[0-7]|18|19|20)$")
ALLOWED_REGIONS = {f"{n:02d}" for n in range(1, 21)}

def normalize_plate(value: str) -> str:
    value = (value or "").upper().strip()
    return re.sub(r"[\s-]+", "", value)

def validate_kz_plate(value: str, confidence: float, min_confidence: float = 0.70) -> dict:
    normalized = normalize_plate(value)
    if confidence < min_confidence:
        return {"status": "REVIEW", "reason_code": "OCR_CONFIDENCE_LOW", "normalized": normalized}
    match = PLATE_RE.fullmatch(normalized)
    if not match:
        return {"status": "REVIEW", "reason_code": "KZ_STANDARD_FORMAT_UNCONFIRMED", "normalized": normalized}
    if match.group(3) not in ALLOWED_REGIONS:
        return {"status": "REVIEW", "reason_code": "UNKNOWN_REGION_CODE", "normalized": normalized}
    return {"status": "OBSERVED_VALID_FORMAT", "reason_code": "KZ_STANDARD_FORMAT_MATCH", "normalized": normalized}
