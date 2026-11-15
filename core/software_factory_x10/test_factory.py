import tempfile
import unittest
from pathlib import Path
from software_factory_x10.factory import SoftwareFactory
from software_factory_x10.validation import validate_name, validate_source, ValidationError

GOOD = "def run(data):\n    return list(data)\n"
class FakeRunner:
    def run_smoke_test(self, path):
        compile(path.read_text("utf-8"), str(path), "exec")

class FactoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.factory = SoftwareFactory(self.tmp.name, runner=FakeRunner())
    def tearDown(self):
        self.tmp.cleanup()
    def test_create_and_register_metadata(self):
        result = self.factory.create("processor", GOOD)
        self.assertEqual(result["status"], "validated")
        self.assertIn("processor", self.factory.registry.list())
        self.assertTrue(self.factory.destroy("processor"))
    def test_never_overwrites_existing(self):
        self.factory.create("processor", GOOD)
        with self.assertRaises(FileExistsError):
            self.factory.create("processor", GOOD)
    def test_rejects_path_traversal(self):
        with self.assertRaises(ValidationError):
            validate_name("../escape")
    def test_rejects_dynamic_exec(self):
        with self.assertRaises(ValidationError):
            validate_source("def run(data):\n    return eval('1')\n")
    def test_rejects_forbidden_import(self):
        with self.assertRaises(ValidationError):
            validate_source("import socket\ndef run(data):\n    return data\n")
    def test_destroy_refuses_tampered_file(self):
        self.factory.create("processor", GOOD)
        (Path(self.tmp.name) / "modules/processor.py").write_text("def run(x): return 0")
        with self.assertRaises(RuntimeError):
            self.factory.destroy("processor")
if __name__ == "__main__":
    unittest.main()
