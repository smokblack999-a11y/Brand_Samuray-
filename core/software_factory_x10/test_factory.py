import tempfile
import unittest
import threading
from concurrent.futures import ThreadPoolExecutor
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
        self.assertEqual(result["sourceReview"]["decision"], "APPROVED")
        self.assertEqual(result["versions"][0]["sourceReview"]["decision"], "APPROVED")
        self.assertIn("processor", self.factory.registry.list())
        self.assertTrue(self.factory.destroy("processor"))
    def test_never_overwrites_existing(self):
        self.factory.create("processor", GOOD)
        with self.assertRaises(FileExistsError):
            self.factory.create("processor", GOOD)

    def test_promote_creates_immutable_version_and_keeps_history(self):
        source_v2 = "def run(data):\n    return data[:]\n"
        first = self.factory.create("processor", GOOD)
        second = self.factory.promote("processor", source_v2)
        self.assertEqual(second["version"], 2)
        self.assertEqual(second["sourceReview"]["decision"], "APPROVED")
        self.assertEqual(second["versions"][1]["sourceReview"]["decision"], "APPROVED")
        self.assertEqual(len(second["versions"]), 2)
        self.assertEqual(self.factory.registry.list()["processor"]["sha256"], second["sha256"])
        version_dir = Path(self.tmp.name) / "versions/processor"
        self.assertEqual(len(list(version_dir.glob("v*.py"))), 2)
        self.assertTrue((Path(self.tmp.name) / "modules/processor.py").is_file())
        self.assertNotEqual(first["sha256"], second["sha256"])

    def test_rollback_restores_previous_version(self):
        source_v2 = "def run(data):\n    return list(reversed(list(reversed(data))))\n"
        first = self.factory.create("processor", GOOD)
        self.factory.promote("processor", source_v2)
        restored = self.factory.rollback("processor")
        self.assertTrue(restored["rolledBack"])
        self.assertEqual(restored["version"], 1)
        self.assertEqual(restored["sha256"], first["sha256"])
        self.assertEqual(restored["sourceReview"], first["sourceReview"])
        self.assertEqual(self.factory._hash(Path(self.tmp.name) / "modules/processor.py"), first["sha256"])

    def test_promote_refuses_tampered_active_file(self):
        self.factory.create("processor", GOOD)
        target = Path(self.tmp.name) / "modules/processor.py"
        target.chmod(0o600)
        target.write_text("def run(data): return data")
        with self.assertRaises(RuntimeError):
            self.factory.promote("processor", "def run(data):\n    return data[:]\n")

    def test_destroy_removes_version_history(self):
        self.factory.create("processor", GOOD)
        self.factory.promote("processor", "def run(data):\n    return data[:]\n")
        self.assertTrue(self.factory.destroy("processor"))
        self.assertFalse((Path(self.tmp.name) / "modules/processor.py").exists())
        self.assertFalse((Path(self.tmp.name) / "versions/processor").exists())

    def test_runner_rejects_mutable_image_tag(self):
        from software_factory_x10.runner import DockerSandboxRunner
        with self.assertRaisesRegex(ValueError, "SANDBOX_IMAGE_DIGEST_REQUIRED"):
            DockerSandboxRunner(image="python:3.12-slim")

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

    def test_parallel_create_same_name_preserves_single_registry_entry(self):
        root = self.tmp.name
        first_factory = SoftwareFactory(root, runner=FakeRunner())
        second_factory = SoftwareFactory(root, runner=FakeRunner())
        barrier = threading.Barrier(2)
        def attempt(factory, source):
            barrier.wait()
            try:
                return factory.create("contended", source)
            except FileExistsError:
                return None
        source_a = GOOD
        source_b = GOOD.replace("return list(data)", "return data[:]")
        with ThreadPoolExecutor(max_workers=2) as pool:
            a = pool.submit(attempt, first_factory, source_a)
            b = pool.submit(attempt, second_factory, source_b)
            results = [a.result(), b.result()]
        successes = [item for item in results if item is not None]
        self.assertEqual(len(successes), 1)
        metadata = first_factory.registry.list()["contended"]
        target = Path(root) / "modules/contended.py"
        self.assertEqual(first_factory._hash(target), metadata["sha256"])

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


    def test_factory_promote_and_rollback_runs_real_docker(self):
        from software_factory_x10.runner import DockerSandboxRunner
        with tempfile.TemporaryDirectory() as tmp:
            factory = SoftwareFactory(tmp, runner=DockerSandboxRunner(timeout=15))
            first = factory.create("release_candidate", GOOD)
            second = factory.promote("release_candidate", "def run(data):\n    return data[:]\n")
            self.assertEqual(second["version"], 2)
            rolled = factory.rollback("release_candidate")
            self.assertEqual(rolled["sha256"], first["sha256"])
            self.assertTrue(factory.destroy("release_candidate"))

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

    def test_real_docker_runner_stops_timed_out_container(self):
        import subprocess
        from software_factory_x10.runner import DockerSandboxRunner
        with tempfile.TemporaryDirectory() as tmp:
            module = Path(tmp) / "module.py"
            module.write_text("import time\ndef run(data):\n    time.sleep(20)\n    return data\n")
            with self.assertRaisesRegex(RuntimeError, "SANDBOX_TIMEOUT"):
                DockerSandboxRunner(timeout=3).run_smoke_test(module)
        result = subprocess.run(
            ["docker", "ps", "-aq", "--filter", "label=com.samurai.factory.sandbox=true"],
            check=True, capture_output=True, text=True, timeout=5
        )
        self.assertEqual(result.stdout.strip(), "")

    def test_real_docker_runner_rejects_wrong_output(self):
        from software_factory_x10.runner import DockerSandboxRunner
        with tempfile.TemporaryDirectory() as tmp:
            module = Path(tmp) / "module.py"
            module.write_text("def run(data):\n    return ['wrong']\n")
            with self.assertRaises(RuntimeError):
                DockerSandboxRunner(timeout=15).run_smoke_test(module)
