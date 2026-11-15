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

    def test_registry_failure_rolls_back_published_module(self):
        original_put = self.factory.registry.put
        def fail_put(name, metadata):
            raise OSError("simulated registry failure")
        self.factory.registry.put = fail_put
        try:
            with self.assertRaises(OSError):
                self.factory.create("processor", GOOD)
            self.assertFalse((Path(self.tmp.name) / "modules/processor.py").exists())
        finally:
            self.factory.registry.put = original_put

    def test_rejects_symlinked_module_workspace(self):
        import os
        base = Path(self.tmp.name)
        external = base / "external"
        external.mkdir()
        link_root = base / "linked-root"
        link_root.mkdir()
        (link_root / "modules").symlink_to(external, target_is_directory=True)
        with self.assertRaises(ValueError):
            SoftwareFactory(link_root, runner=FakeRunner())

    def test_destroy_refuses_tampered_file(self):
        self.factory.create("processor", GOOD)
        target = Path(self.tmp.name) / "modules/processor.py"
        target.chmod(0o600)
        target.write_text("def run(x): return 0")
        with self.assertRaises(RuntimeError):
            self.factory.destroy("processor")
if __name__ == "__main__":
    unittest.main()


class DockerRunnerIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import shutil
        if not shutil.which("docker"):
            raise unittest.SkipTest("Docker is not installed")
        import subprocess
        try:
            subprocess.run(["docker", "info"], check=True, capture_output=True, timeout=5)
        except Exception:
            raise unittest.SkipTest("Docker daemon is unavailable")

    def test_real_docker_runner_executes_valid_module(self):
        from software_factory_x10.runner import DockerSandboxRunner
        with tempfile.TemporaryDirectory() as tmp:
            module = Path(tmp) / "module.py"
            module.write_text("def run(data):\n    return list(data)\n")
            DockerSandboxRunner(timeout=15).run_smoke_test(module)

    def test_real_docker_runner_denies_network(self):
        from software_factory_x10.runner import DockerSandboxRunner
        source = (
            "import socket\n"
            "def run(data):\n"
            "    try:\n"
            "        socket.create_connection(('1.1.1.1', 80), timeout=1)\n"
            "    except OSError:\n"
            "        return data\n"
            "    raise AssertionError('NETWORK_AVAILABLE')\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            module = Path(tmp) / "module.py"
            module.write_text(source)
            DockerSandboxRunner(timeout=15).run_smoke_test(module)


    def test_full_factory_lifecycle_uses_real_docker(self):
        from software_factory_x10.runner import DockerSandboxRunner
        with tempfile.TemporaryDirectory() as tmp:
            factory = SoftwareFactory(tmp, runner=DockerSandboxRunner(timeout=15))
            result = factory.create("e2e_processor", GOOD)
            self.assertEqual(result["status"], "validated")
            self.assertIn("e2e_processor", factory.registry.list())
            self.assertTrue(factory.destroy("e2e_processor"))
            self.assertNotIn("e2e_processor", factory.registry.list())

    def test_failed_docker_smoke_test_never_publishes_module(self):
        from software_factory_x10.runner import DockerSandboxRunner
        bad = "def run(data):\n    return ['incorrect']\n"
        with tempfile.TemporaryDirectory() as tmp:
            factory = SoftwareFactory(tmp, runner=DockerSandboxRunner(timeout=15))
            with self.assertRaisesRegex(RuntimeError, "SANDBOX_TEST_FAILED"):
                factory.create("rejected_processor", bad)
            self.assertFalse((Path(tmp) / "modules/rejected_processor.py").exists())
            self.assertNotIn("rejected_processor", factory.registry.list())

    def test_real_docker_runner_rejects_wrong_output(self):
        from software_factory_x10.runner import DockerSandboxRunner
        with tempfile.TemporaryDirectory() as tmp:
            module = Path(tmp) / "module.py"
            module.write_text("def run(data):\n    return ['wrong']\n")
            with self.assertRaises(RuntimeError):
                DockerSandboxRunner(timeout=15).run_smoke_test(module)
