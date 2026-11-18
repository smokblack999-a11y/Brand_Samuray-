#!/usr/bin/env python3
"""Read-only APK/Dex compatibility inventory for authorized local test APKs.

The tool never modifies or uploads the input APK. DEX string hits are evidence
of literals only; they do not prove that a method was resolved or a hook works.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import zipfile
from pathlib import Path
from typing import Iterable

MAX_APK_BYTES = 2 * 1024 * 1024 * 1024
MAX_ZIP_ENTRIES = 20_000
MAX_TOTAL_DEX_BYTES = 768 * 1024 * 1024
MAX_DEX_STRINGS = 2_000_000

ANCHOR_GROUPS = {
    "receipt_dispatch": (
        "ReadReceipts/sendDeliveryReadReceipt",
        "ReadReceipts/sendDeliveryReceiptIfNotRetry",
        "ReadReceipts/sendReceiptForIncomingMessage",
    ),
    "receipt_stanza": (
        "ProtocolTreeNode/getAttributeJid",
        "SendReadReceiptJob",
    ),
    "presence": (
        "PresenceStateManager",
        "SendPresenceJob",
    ),
    "view_once": (
        "view_once",
        "ViewOnce",
    ),
    "revoke": (
        "revoke",
        "delete",
        "message revoke",
    ),
}


class AuditError(Exception):
    """Raised for malformed or unsupported APK/DEX input."""


def read_uleb128(data: bytes, offset: int) -> tuple[int, int]:
    value = 0
    shift = 0
    for _ in range(5):
        if offset >= len(data):
            raise AuditError("ULEB128 value extends beyond input")
        byte = data[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if (byte & 0x80) == 0:
            return value, offset
        shift += 7
    raise AuditError("ULEB128 value is longer than five bytes")


def decode_mutf8_c_string(data: bytes) -> str:
    """Decode the ASCII/UTF-8 subset needed for source-anchor inventory."""
    end = data.find(b"\x00")
    if end < 0:
        raise AuditError("DEX string is not NUL terminated")
    raw = data[:end].replace(b"\xC0\x80", b"\x00")
    return raw.decode("utf-8", errors="replace")


def parse_dex_string_ids(dex: bytes) -> list[str]:
    if len(dex) < 112 or dex[:4] != b"dex\n":
        raise AuditError("Invalid DEX magic or truncated header")

    file_size, header_size, endian_tag = struct.unpack_from("<III", dex, 32)
    if file_size != len(dex) or header_size != 112 or endian_tag != 0x12345678:
        raise AuditError("Unsupported or inconsistent DEX header")

    string_count, string_ids_off = struct.unpack_from("<II", dex, 56)
    if string_count > MAX_DEX_STRINGS:
        raise AuditError("DEX string table exceeds safety limit")
    table_end = string_ids_off + string_count * 4
    if string_ids_off < 112 or table_end > len(dex):
        raise AuditError("DEX string_ids table is out of bounds")

    result: list[str] = []
    for index in range(string_count):
        data_off = struct.unpack_from("<I", dex, string_ids_off + index * 4)[0]
        if data_off >= len(dex):
            raise AuditError("DEX string_data offset is out of bounds")
        _utf16_size, cursor = read_uleb128(dex, data_off)
        result.append(decode_mutf8_c_string(dex[cursor:]))
    return result


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def find_aapt() -> str | None:
    found = shutil.which("aapt")
    if found:
        return found
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    if not sdk:
        return None
    candidates = sorted(
        (Path(sdk) / "build-tools").glob("*/aapt"),
        key=lambda item: item.parent.name,
        reverse=True,
    )
    return str(candidates[0]) if candidates else None


def read_badging(apk_path: Path) -> dict[str, str] | None:
    aapt = find_aapt()
    if not aapt:
        return None
    try:
        result = subprocess.run(
            [aapt, "dump", "badging", str(apk_path)],
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    match = re.search(
        r"^package: name='([^']+)' versionCode='([^']+)' versionName='([^']*)'",
        result.stdout,
        flags=re.MULTILINE,
    )
    if not match:
        return None
    return {
        "package_name": match.group(1),
        "version_code": match.group(2),
        "version_name": match.group(3),
    }


def inspect_apk(apk_path: Path) -> dict:
    if not apk_path.is_file():
        raise AuditError("Input APK does not exist or is not a regular file")
    if apk_path.stat().st_size > MAX_APK_BYTES:
        raise AuditError("APK exceeds the 2 GiB safety limit")

    try:
        with zipfile.ZipFile(apk_path, "r") as archive:
            entries = archive.infolist()
            if len(entries) > MAX_ZIP_ENTRIES:
                raise AuditError("APK contains too many ZIP entries")
            bad_entry = archive.testzip()
            if bad_entry:
                raise AuditError(f"ZIP CRC check failed at {bad_entry}")

            dex_entries = sorted(
                item for item in entries
                if re.fullmatch(r"classes(?:[0-9]+)?\.dex", Path(item.filename).name)
                and "/" not in item.filename
            )
            if not dex_entries:
                raise AuditError("No root-level DEX files found")
            total_dex = sum(item.file_size for item in dex_entries)
            if total_dex > MAX_TOTAL_DEX_BYTES:
                raise AuditError("Total uncompressed DEX size exceeds safety limit")

            dex_reports = []
            all_strings: set[str] = set()
            for item in dex_entries:
                payload = archive.read(item)
                strings = parse_dex_string_ids(payload)
                all_strings.update(strings)
                dex_reports.append({
                    "entry": item.filename,
                    "bytes": item.file_size,
                    "string_count": len(strings),
                    "dex_version": payload[4:7].decode("ascii", errors="replace"),
                })
    except zipfile.BadZipFile as exc:
        raise AuditError("Input is not a valid APK/ZIP archive") from exc

    anchors = {
        group: {
            literal: literal in all_strings
            for literal in literals
        }
        for group, literals in ANCHOR_GROUPS.items()
    }
    return {
        "schema_version": 1,
        "file_name": apk_path.name,
        "file_bytes": apk_path.stat().st_size,
        "sha256": sha256_file(apk_path),
        "zip_crc": "PASS",
        "package": read_badging(apk_path),
        "dex_files": dex_reports,
        "source_anchor_literals": anchors,
        "interpretation": (
            "A present DEX literal is not proof that a matching method exists, "
            "that an Xposed hook resolves, or that runtime behavior works. "
            "An absent literal can mean the host changed or uses another path."
        ),
        "privacy": "The APK is read locally; no content is uploaded or copied.",
    }


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path, help="Authorized local APK to inspect")
    parser.add_argument("--json", action="store_true", help="Print JSON report")
    args = parser.parse_args(argv)

    try:
        report = inspect_apk(args.apk)
    except (AuditError, OSError) as exc:
        print(f"APK audit failed: {exc}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"APK: {report['file_name']}")
        print(f"SHA-256: {report['sha256']}")
        print(f"ZIP CRC: {report['zip_crc']}")
        print(f"Package: {report['package'] or 'not detected (aapt unavailable)'}")
        for dex in report["dex_files"]:
            print(f"DEX: {dex['entry']} ({dex['bytes']} bytes, {dex['string_count']} strings)")
        for group, values in report["source_anchor_literals"].items():
            present = [name for name, found in values.items() if found]
            print(f"{group}: {len(present)}/{len(values)} literal anchors present")
        print(report["interpretation"])
        print(report["privacy"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
