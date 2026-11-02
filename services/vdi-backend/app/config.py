import os
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()

@dataclass(frozen=True)
class Settings:
    api_key: str = os.getenv("VDI_API_KEY", "")
    token_secret: str = os.getenv("PLATE_TOKEN_SECRET", "")
    database_path: str = os.getenv("DATABASE_PATH", "./data/vdi.sqlite3")
    enable_rtsp: bool = os.getenv("ENABLE_RTSP", "false").lower() == "true"
    rtsp_url: str = os.getenv("RTSP_URL", "")
    camera_id: str = os.getenv("CAMERA_ID", "rtsp-camera-01")
    yolo_model_path: str = os.getenv("YOLO_MODEL_PATH", "./weights/license-plate.pt")
    yolo_class_id: str = os.getenv("YOLO_CLASS_ID", "")
    ocr_languages: tuple = tuple(x.strip() for x in os.getenv("OCR_LANGUAGES", "en").split(",") if x.strip())
    min_ocr_confidence: float = float(os.getenv("MIN_OCR_CONFIDENCE", "0.70"))
    frame_interval_seconds: float = max(0.2, float(os.getenv("FRAME_INTERVAL_SECONDS", "1.0")))
    max_frame_width: int = max(320, int(os.getenv("MAX_FRAME_WIDTH", "1280")))

settings = Settings()
