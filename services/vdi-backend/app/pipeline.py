import hashlib
import time
import cv2
import easyocr
from ultralytics import YOLO
from .config import settings
from .kz_validator import validate_kz_plate
from .db import record_event

class VisionPipeline:
    def __init__(self):
        self.model = YOLO(settings.yolo_model_path)
        self.reader = easyocr.Reader(list(settings.ocr_languages), gpu=False)
        self.class_id = int(settings.yolo_class_id) if settings.yolo_class_id.strip() else None

    def process_frame(self, frame, source_id: str):
        height, width = frame.shape[:2]
        if width > settings.max_frame_width:
            scale = settings.max_frame_width / width
            frame = cv2.resize(frame, (int(width*scale), int(height*scale)))
        result = self.model.predict(frame, verbose=False, conf=0.35)[0]
        outputs = []
        boxes = result.boxes
        if boxes is None:
            return outputs
        for index, box in enumerate(boxes):
            cls_id = int(box.cls[0].item())
            if self.class_id is not None and cls_id != self.class_id:
                continue
            x1,y1,x2,y2 = [int(v) for v in box.xyxy[0].tolist()]
            x1=max(0,x1); y1=max(0,y1); x2=min(frame.shape[1],x2); y2=min(frame.shape[0],y2)
            crop=frame[y1:y2,x1:x2]
            if crop.size == 0:
                continue
            reads=self.reader.readtext(crop, detail=1, paragraph=False)
            if not reads:
                continue
            best=max(reads, key=lambda x: float(x[2]))
            text=str(best[1])
            confidence=float(best[2])
            validation=validate_kz_plate(text, confidence, settings.min_ocr_confidence)
            frame_hash=hashlib.sha256(crop.tobytes()).hexdigest()
            event_id=f"{source_id}:{frame_hash[:24]}:{index}"
            event={"source_id":source_id,"event_id":event_id,"event_type":"plate_observed",
                   "occurred_at":__import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
                   "ocr_confidence":confidence}
            saved, decision, proof, duplicate=record_event(event, validation, frame_hash)
            outputs.append({"event":saved,"decision":decision,"duplicate":duplicate})
        return outputs

def run_rtsp(stop_event):
    if not settings.rtsp_url:
        raise RuntimeError("RTSP_URL is not configured")
    pipeline=VisionPipeline()
    cap=cv2.VideoCapture(settings.rtsp_url, cv2.CAP_FFMPEG)
    if not cap.isOpened():
        raise RuntimeError("Unable to open RTSP stream")
    last=0.0
    try:
        while not stop_event.is_set():
            ok, frame=cap.read()
            if not ok:
                cap.release()
                time.sleep(2)
                cap=cv2.VideoCapture(settings.rtsp_url, cv2.CAP_FFMPEG)
                continue
            now=time.monotonic()
            if now-last >= settings.frame_interval_seconds:
                pipeline.process_frame(frame, settings.camera_id)
                last=now
    finally:
        cap.release()
