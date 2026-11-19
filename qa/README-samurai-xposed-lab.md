# SAMURAI WhatsApp host APK audit

Use `apk_compat_audit.py` only with an APK you are authorized to inspect, preferably a copy of the official WhatsApp test client on a spare device/account.

```bash
python3 qa/apk_compat_audit.py /path/to/WhatsApp.apk --json
python3 -m unittest qa.tests.test_apk_compat_audit -v
```

The report records the APK SHA-256, ZIP integrity, DEX files, DEX version, DEX string counts, and the presence/absence of a small set of source-derived anchor literals. When Android Build Tools are installed, it also reads package name/version metadata through `aapt dump badging`.

Important limits:

- The script reads the APK locally and does not upload, unpack to disk, patch, resign or redistribute it.
- A matching string literal is not proof that a method signature matches, that an Xposed hook registers, or that a feature works.
- A missing string does not prove a feature is absent; the host may have changed names or code paths.
- Exact runtime acceptance requires the matching Android build, Xposed framework, package version and a two-device test record.
- Do not commit official WhatsApp APKs, DEX dumps, private keys, phone numbers or chat data to this repository.
