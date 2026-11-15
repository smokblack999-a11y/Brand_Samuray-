# SAMURAI REAL VISION V1

## Scope

V1 adds two distinct perception paths:

1. Local live perception: Android CameraX ImageAnalysis feeds frames to ML Kit object detection in STREAM_MODE. Inference runs on the device; frames are not uploaded by this analyzer. A transparent live overlay draws bounding boxes, coarse category labels, confidence and tracking IDs over PreviewView. CameraX crop and rotation coordinates are mapped into PreviewView pixels. The stream detector uses single-object mode to prioritize low latency on mobile devices. The default ML Kit object detector may need Google Play services to download its model the first time. Once available, frame inference is on-device.
2. Explicit cloud scene analysis: a user selects a saved JPEG and confirms a disclosure dialog. Android sends the image to the configured SAMURAI Core endpoint. Core forwards it to the OpenAI Responses API as an input_image data URL with detail high. Vision is disabled by default and requires VISION_ENABLED=true plus X-Vision-Consent: true.

## Core configuration

Set these variables in the Core environment:

OPENAI_API_KEY=...
OPENAI_VISION_MODEL=<a model enabled for image input in this API project>
VISION_ENABLED=true
VISION_MAX_IMAGE_BYTES=8388608
VISION_RATE_LIMIT_WINDOW_MS=60000
VISION_RATE_LIMIT_MAX=5

OPENAI_VISION_MODEL falls back to OPENAI_MODEL if omitted. Confirm that the selected model supports image input before enabling the feature.

## API

- GET /api/vision/health — authenticated configuration status; never returns secrets.
- POST /api/vision/analyze — authenticated raw JPEG/PNG/WEBP body. Required headers: X-API-Key, X-Vision-Consent: true, Content-Type; optional X-Vision-Prompt (maximum 1000 characters).

The Vision route validates image MIME and file signature, enforces a size limit and rate limit, and does not persist or log image bytes. The OpenAI API key remains on Core. Cloud analysis is opt-in for every request. A photo's visible timestamp/GPS stamp, if present, is also visible to the cloud model.

## Safety boundaries

- Object detection is not identity recognition and does not establish what a person intends. ML Kit's standard object detector provides broad categories, not detailed semantic scene understanding.
- Cloud image analysis is descriptive, not proof of payment, document authenticity, GPS, time, ownership, delivery or any other real-world event.
- Business decisions must be checked against authoritative Core records and, where required, a human reviewer.
- V1 does not implement continuous cloud video streaming, background surveillance, voice control, screen-control automation, or autonomous actions. Those are later modules requiring separate permissions, explicit controls and end-to-end tests.

## Next stage: Cyrillic OCR

The implementation contract, model selection, offline privacy requirements and acceptance gates are documented in [SAMURAI-REAL-VISION-OCR-V1.md](SAMURAI-REAL-VISION-OCR-V1.md). OCR is not implemented or enabled in this revision.

## Verification

Core unit tests cover image signature/size validation, Responses API request construction, explicit consent, disabled-by-default behavior and unsupported media. Android CI runs debug unit tests, lint and APK assembly. Device validation must still be performed on the target Redmi phone: camera preview, local detector model availability, frame latency, thermal behavior, cloud consent dialog and real Core/API round trip.
