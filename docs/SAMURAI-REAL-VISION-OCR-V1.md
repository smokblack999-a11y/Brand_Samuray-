# SAMURAI REAL VISION — Cyrillic OCR V1 Integration Contract

Status: initial still-image OCR integration added on the feature branch; CI and physical-device acceptance are pending.

## Product requirement

Provide offline text extraction from a user-selected photo on Android, with support for Russian and Kazakh Cyrillic. OCR must not upload frames or photos. Cloud scene analysis remains a separate, explicit-consent feature.

## Selected recognition model

- Runtime: Tesseract 5.5.1 through Tesseract4Android 4.9.0 (standard single-threaded variant).
- Language packs: official `tessdata_fast` `rus` and `kaz` LSTM models, pinned to Git revision `87416418657359cb625c412a48b6e1d6d41c29bd`.
- Exact model sizes and Git blob object IDs are embedded in the downloader manifest; downloaded files are verified before installation.
- Russian and Kazakh are separate language packs; both are loaded as `rus+kaz` for mixed-script photos.
- This initial pipeline uses Tesseract's built-in page segmentation and does not yet include a separate neural text detector or perspective rectifier.

The published 80.27% figure is a benchmark reported by the model authors for their evaluation protocol. It is not a guaranteed accuracy for SAMURAI users, delivery labels, receipts, glare, motion blur or low-resolution images.

## Pipeline architecture

1. User explicitly selects a saved photo and presses "Распознать текст локально".
2. Decode the image with bounded dimensions and memory use.
3. Run Tesseract's on-device page segmentation and LSTM recognizer over the bounded still image.
4. Return recognized text, mean confidence and elapsed time.
5. Keep results local. Do not send OCR text or image bytes to Core.

## Runtime and packaging

The official PaddleOCR Android deployment example documents an ONNX Runtime Android integration and uses ONNX Runtime Android 1.21.1, OpenCV 4.5.3 and minSdk 26. Treat it as a reference implementation, not as proof that its bundled demo already supports the Cyrillic model.

Runtime and model integration now use Tesseract4Android 4.9.0 and a pinned `tessdata_fast` Git revision. The app downloads model files to app-private storage over HTTPS, validates the exact Git blob object ID and byte count, then atomically renames the temporary file. It rejects incomplete or mismatched models. CI must still prove ABI packaging and APK size before the feature is considered releasable.

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
- First-run model bootstrap, offline second run and interrupted-download recovery.

### Golden image set
Create a permissioned test set containing:
- Russian printed labels and receipts.
- Kazakh Cyrillic text including Ә, Ғ, Қ, Ң, Ө, Ұ, Ү, Һ, І.
- Mixed Russian/Kazakh/Latin text and digits.
- Small text, skew, perspective, glare, shadows and motion blur.

Report character error rate (CER), word error rate (WER), detector recall, latency, peak memory and thermal behavior. Keep model-author benchmark scores separate from SAMURAI test results.

## Acceptance gate

OCR integration is considered release-ready only after CI, model bootstrap and physical-device tests on both supported ABIs pass and the Russian/Kazakh golden set is measured. The current implementation is an initial experimental integration; do not claim certified accuracy or document verification.
