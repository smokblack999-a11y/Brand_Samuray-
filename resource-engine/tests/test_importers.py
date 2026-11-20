import json
import tempfile
import unittest
from pathlib import Path

from samurai_resource_engine.importers import import_chatgpt_export
from samurai_resource_engine.store import ResourceStore


class ImporterTests(unittest.TestCase):
    def test_chatgpt_export_import_and_dedup(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            export = root / "conversations.json"
            db = root / "resource.sqlite3"
            payload = [{
                "id": "conv-1",
                "title": "Test project",
                "mapping": {
                    "node-1": {
                        "message": {
                            "id": "msg-1",
                            "author": {"role": "user"},
                            "create_time": 1000,
                            "content": {"content_type": "text", "parts": ["Hello SAMURAI"]},
                        }
                    },
                    "node-2": {
                        "message": {
                            "id": "msg-2",
                            "author": {"role": "assistant"},
                            "create_time": 1001,
                            "content": {"content_type": "text", "parts": ["Audit started"]},
                        }
                    },
                },
            }]
            export.write_text(json.dumps(payload), encoding="utf-8")
            store = ResourceStore(db)

            first = import_chatgpt_export(export, store)
            second = import_chatgpt_export(export, store)

            self.assertEqual(first["seen"], 2)
            self.assertEqual(first["inserted"], 2)
            self.assertEqual(second["inserted"], 0)
            self.assertEqual(second["duplicates"], 2)
            self.assertEqual(store.stats()["objects"], 2)
            self.assertEqual(store.stats()["pending_sync"], 2)
            self.assertEqual(len(store.list_objects()), 2)


if __name__ == "__main__":
    unittest.main()
