import unittest

from software_factory_x10.critic import review_source, require_approved_source
from software_factory_x10.validation import ValidationError


def source(*lines):
    return "\n".join([*lines, ""])


class FactoryCriticTests(unittest.TestCase):
    def test_approves_simple_module(self):
        report = review_source(source("def run(data):", "    return list(data)"))
        self.assertEqual(report["decision"], "APPROVED")
        self.assertEqual(report["findings"], [])
        self.assertEqual(report["policyVersion"], "factory-source-critic-v1")

    def test_blocks_import_time_execution(self):
        report = review_source(source("print('must not run at import time')", "def run(data):", "    return list(data)"))
        self.assertEqual(report["decision"], "BLOCKED")
        self.assertIn("TOP_LEVEL_EXECUTION", {item["code"] for item in report["findings"]})

    def test_blocks_operating_system_process_calls(self):
        report = review_source(source("import os", "def run(data):", "    os.system('id')", "    return list(data)"))
        self.assertIn("FORBIDDEN_OS_PROCESS_CALL", {item["code"] for item in report["findings"]})

    def test_blocks_aliased_dangerous_import(self):
        report = review_source(source("from os import system as launch", "def run(data):", "    launch('id')", "    return list(data)"))
        self.assertIn("FORBIDDEN_IMPORT", {item["code"] for item in report["findings"]})

    def test_blocks_os_file_writes(self):
        report = review_source(source("import os", "def run(data):", "    os.open('/tmp/payload', os.O_CREAT)", "    return list(data)"))
        self.assertIn("FORBIDDEN_OS_PROCESS_CALL", {item["code"] for item in report["findings"]})

    def test_blocks_pathlib_file_writes(self):
        report = review_source(source("from pathlib import Path", "def run(data):", "    Path('/tmp/payload').write_text('x')", "    return list(data)"))
        self.assertIn("FORBIDDEN_PATH_WRITE", {item["code"] for item in report["findings"]})

    def test_blocks_async_run_function(self):
        report = review_source(source("async def run(data):", "    return list(data)"))
        self.assertIn("ASYNC_RUN_NOT_SUPPORTED", {item["code"] for item in report["findings"]})

    def test_blocks_decorators_that_execute_at_import(self):
        report = review_source(source("@some_decorator", "def run(data):", "    return list(data)"))
        self.assertIn("IMPORT_TIME_DECORATOR", {item["code"] for item in report["findings"]})

    def test_factory_gate_raises_validation_error_for_blocked_source(self):
        with self.assertRaises(ValidationError):
            require_approved_source(source("print('side effect')", "def run(data):", "    return list(data)"))


if __name__ == "__main__":
    unittest.main()
