import tempfile
import unittest
from pathlib import Path

from software_factory_x10.worker import handle_request, error_code
from software_factory_x10.validation import ValidationError


GOOD = "\n".join(["def run(data):", "    return list(data)", ""])


class FakeRunner:
    def run_smoke_test(self, path, contract=None):
        compile(path.read_text("utf-8"), str(path), "exec")


class WorkerProtocolTests(unittest.TestCase):
    def test_list_empty_registry(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = handle_request({"action": "list"}, tmp, runner=FakeRunner())
            self.assertEqual(result, {"modules": {}})

    def test_create_list_promote_rollback_destroy(self):
        with tempfile.TemporaryDirectory() as tmp:
            contract_v1 = {"cases": [{"input": [1, 2], "expected": [2, 4]}]}
            contract_v2 = {"cases": [{"input": [1, 2], "expected": [3, 6]}]}
            source_v1 = "\n".join(["def run(data):", "    return [x * 2 for x in data]", ""])
            created = handle_request(
                {"action": "create", "name": "processor", "source": source_v1, "contract": contract_v1},
                tmp, runner=FakeRunner()
            )
            self.assertEqual(created["module"]["version"], 1)
            self.assertEqual(created["module"]["contract"], contract_v1)
            self.assertIn("processor", handle_request({"action": "list"}, tmp)["modules"])

            source_v2 = "\n".join(["def run(data):", "    return [x * 3 for x in data]", ""])
            promoted = handle_request(
                {"action": "promote", "name": "processor", "source": source_v2, "contract": contract_v2},
                tmp, runner=FakeRunner()
            )
            self.assertEqual(promoted["module"]["version"], 2)
            self.assertEqual(promoted["module"]["contract"], contract_v2)

            rolled = handle_request(
                {"action": "rollback", "name": "processor"},
                tmp, runner=FakeRunner()
            )
            self.assertEqual(rolled["module"]["version"], 1)
            self.assertTrue(rolled["module"]["rolledBack"])
            self.assertEqual(rolled["module"]["contract"], contract_v1)

            deleted = handle_request({"action": "destroy", "name": "processor"}, tmp, runner=FakeRunner())
            self.assertTrue(deleted["deleted"])
            self.assertEqual(handle_request({"action": "list"}, tmp)["modules"], {})

    def test_run_action_invokes_active_module(self):
        with tempfile.TemporaryDirectory() as tmp:
            handle_request({"action": "create", "name": "processor", "source": GOOD}, tmp, runner=FakeRunner())
            result = handle_request({"action": "run", "name": "processor", "input": [3, 4]}, tmp, runner=FakeRunner())
            self.assertEqual(result["module"]["result"], {"received": [3, 4]})
            self.assertEqual(result["module"]["version"], 1)

    def test_run_action_requires_input_field(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError, "RUN_INPUT_REQUIRED"):
                handle_request({"action": "run", "name": "processor"}, tmp, runner=FakeRunner())

    def test_rejects_unknown_action(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError, "ACTION_INVALID"):
                handle_request({"action": "shell"}, tmp, runner=FakeRunner())

    def test_rejects_invalid_source_without_paths_in_error_code(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValidationError) as caught:
                handle_request({"action": "create", "name": "processor", "source": "def broken("}, tmp, runner=FakeRunner())
            self.assertEqual(error_code(caught.exception), "SOURCE_SYNTAX_INVALID")


if __name__ == "__main__":
    unittest.main()
