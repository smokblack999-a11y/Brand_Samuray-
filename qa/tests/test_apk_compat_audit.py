import struct
import unittest

from qa.apk_compat_audit import (
    AuditError,
    decode_mutf8_c_string,
    parse_dex_string_ids,
    read_uleb128,
)


class DexParserTests(unittest.TestCase):
    def test_uleb128_single_byte(self):
        self.assertEqual((3, 1), read_uleb128(b"\x03", 0))

    def test_uleb128_multi_byte(self):
        self.assertEqual((624485, 3), read_uleb128(b"\xE5\x8E\x26", 0))

    def test_uleb128_rejects_truncated_value(self):
        with self.assertRaises(AuditError):
            read_uleb128(b"\x80", 0)

    def test_mutf8_null_escape(self):
        self.assertEqual("A\x00B", decode_mutf8_c_string(b"A\xC0\x80B\x00"))

    def test_mutf8_requires_terminator(self):
        with self.assertRaises(AuditError):
            decode_mutf8_c_string(b"not-terminated")

    def test_parse_minimal_dex_string_table(self):
        header = bytearray(112)
        header[0:8] = b"dex\n035\x00"
        table_offset = 112
        data_offset = 116
        string_data = b"\x03foo\x00"
        file_size = data_offset + len(string_data)
        struct.pack_into("<III", header, 32, file_size, 112, 0x12345678)
        struct.pack_into("<II", header, 56, 1, table_offset)
        dex = bytes(header) + struct.pack("<I", data_offset) + string_data
        self.assertEqual(["foo"], parse_dex_string_ids(dex))

    def test_rejects_non_dex(self):
        with self.assertRaises(AuditError):
            parse_dex_string_ids(b"not-a-dex")


if __name__ == "__main__":
    unittest.main()
