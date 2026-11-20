import tempfile
import unittest
from pathlib import Path

from samurai_resource_engine.telegram import (
    _read_checkpoint, _write_checkpoint, assess_value, clean_text,
)


class TelegramScoringTests(unittest.TestCase):
    def test_valuable_messages_are_scored_not_filtered(self):
        result = assess_value("Deploy failed: https://example.test/api")
        self.assertGreater(result["score"], 0)
        self.assertIn("link", result["signals"])
        self.assertIn("technical_terms", result["signals"])

    def test_plain_message_is_still_a_valid_record(self):
        self.assertEqual(assess_value("Привет")["score"], 0)
        self.assertEqual(clean_text("  hello\x00  "), "hello")

    def test_checkpoint_is_atomic_and_restrictive(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "checkpoint.json"
            _write_checkpoint(path, 123)
            self.assertEqual(_read_checkpoint(path), 123)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
