from app.kz_validator import validate_kz_plate

def test_standard_format():
    assert validate_kz_plate("123ABC01",0.99)["status"] == "OBSERVED_VALID_FORMAT"

def test_low_confidence_review():
    assert validate_kz_plate("123ABC01",0.2)["reason_code"] == "OCR_CONFIDENCE_LOW"

def test_bad_format_review_not_deny():
    result=validate_kz_plate("NOT-A-PLATE",0.99)
    assert result["status"] == "REVIEW"
    assert result["status"] != "DENY"

def test_normalization():
    assert validate_kz_plate("123 abc 01",0.99)["status"] == "OBSERVED_VALID_FORMAT"
