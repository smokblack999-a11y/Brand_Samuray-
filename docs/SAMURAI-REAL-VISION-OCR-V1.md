# SAMURAI REAL VISION — Cyrillic OCR V1 Integration Contract

Status: implementation specification; OCR is NOT yet integrated or enabled.

## Product requirement

Provide offline text extraction from a user-selected photo on Android, with support for Russian and Kazakh Cyrillic. OCR must not upload frames or photos. Cloud scene analysis remains a separate, explicit-consent feature.

## Selected recognition model

- Model: `cyrillic_PP-OCRv5_mobile_rec` exported to ONNX by PaddlePaddle.
- Official ONNX repository: `PaddlePaddle/cyrillic_PP-OCRv5_mobile_rec_onnx`.
- Recognition model artifact: `inference.onnx`, approximately 8.05 MB.
- Model license reported by the model repository: Apache-2.0.
- Supported languages include Russian and Kazakh, as well as other Cyrillic languages.
- The recognition model accepts text-line crops; it is NOT a complete OCR pipeline by itself.
- Recognition requires a matching character dictionary and preprocessing/postprocessing configuration. Do not substitute a different dictionary.

The published 80.27% figure is a benchmark reported by the model authors for their evaluation protocol. It is not a guaranteed accuracy for SAMURAI users, delivery labels, receipts, glare, motion blur or low-resolution images.

## Pipeline architecture

1. User explicitly selects a saved photo or presses a future "Распознать текст" action.
2. Decode the image with bounded dimensions and memory use.
3. Run a compatible on-device text detector to locate text regions.
4. Rectify/crop each text region and apply the exact model preprocessing.
5. Run Cyrillic PP-OCRv5 recognition through ONNX Runtime on device.
6. Decode CTC output using the matching Cyrillic dictionary.
7. Return text lines, bounding boxes, confidence values and per-stage timing.
8. Keep results local by default. Do not send OCR text or image bytes to Core unless a separate explicit user action is added.

## Runtime and packaging

The official PaddleOCR Android deployment example documents an ONNX Runtime Android integration and uses ONNX Runtime Android 1.21.1, OpenCV 4.5.3 and minSdk 26. Treat it as a reference implementation, not as proof that its bundled demo already supports the Cyrillic model.

Before adding runtime dependencies:
- Verify APK size and ABI coverage for armeabi-v7a and arm64-v8a.
- Verify ONNX Runtime Android native libraries are available for every supported ABI.
- Verify the chosen text detector is compatible with the recognition model generation and preprocessing.
- Pin model and dictionary artifacts to immutable revisions and record SHA-256 checksums.
- Download model artifacts only from a pinned trusted source over HTTPS; write to a temporary file, verify checksum, then atomically rename.
- Never load a partially downloaded or checksum-mismatched model.
- Provide a clear offline/unavailable state and a retry action.
- Do not bundle unverified model binaries directly in the Git repository.

## Performance and privacy constraints

- OCR runs only on a still image or on explicitly requested, throttled crops; never on every camera frame in V1.
- Use a single bounded inference worker and cancel/ignore stale results when the selected photo changes or the Activity is destroyed.
- Enforce maximum decoded dimensions and pixel count before allocating large bitmaps.
- Release ONNX sessions, tensors, bitmaps and temporary files deterministically.
- No telemetry may contain OCR text, photo bytes, filenames containing personal data, or precise GPS.
- Do not claim OCR output proves document authenticity, payment, identity, delivery, location or time.

## Required tests before enabling

### Automated
- Model manifest revision and checksum validation.
- Dictionary loading and blank/unknown token handling.
- CTC decoder repeated-token and blank-token cases.
- Image orientation, crop, resize and normalization tests.
- Empty image, corrupt image, oversized image and decompression-bomb limits.
- Cancellation, repeated selection and Activity lifecycle tests.
- Instrumentation smoke test on both armeabi-v7a and arm64-v8a.

### Golden image set
Create a permissioned test set containing:
- Russian printed labels and receipts.
- Kazakh Cyrillic text including Ә, Ғ, Қ, Ң, Ө, Ұ, Ү, Һ, І.
- Mixed Russian/Kazakh/Latin text and digits.
- Small text, skew, perspective, glare, shadows and motion blur.

Report character error rate (CER), word error rate (WER), detector recall, latency, peak memory and thermal behavior. Keep model-author benchmark scores separate from SAMURAI test results.

## Acceptance gate

OCR is considered implemented only after the end-to-end detector + recognizer runs fully offline on a physical Android device, the golden set is measured, and CI plus instrumentation tests pass. Until then, UI must label the feature as unavailable or experimental and must not claim text extraction works.
