import tempfile
import unittest
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from software_factory_x10.factory import SoftwareFactory
from software_factory_x10.validation import validate_name, validate_source, ValidationError

GOOD = "def run(data):\n    return list(data)\n"
class FakeRunner:
    def run_smoke_test(self, path, contract=None):
        compile(path.read_text("utf-8"), str(path), "exec")
    def run_module(self, path, value):
        return {"received": value}

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
    def test_run_uses_hash_verified_active_module_and_sandbox_runner(self):
        self.factory.create("processor", GOOD)
        result = self.factory.run("processor", {"items": [1, 2]})
        self.assertEqual(result["name"], "processor")
        self.assertEqual(result["version"], 1)
        self.assertEqual(result["result"], {"received": {"items": [1, 2]}})

    def test_run_blocks_legacy_modules_without_approved_source_review(self):
        self.factory.create("processor", GOOD)
        metadata = self.factory.registry.list()["processor"]
        metadata.pop("sourceReview", None)
        for entry in metadata["versions"]:
            entry.pop("sourceReview", None)
        self.factory.registry.put("processor", metadata)
        with self.assertRaisesRegex(RuntimeError, "MODULE_REVIEW_REQUIRED"):
            self.factory.run("processor", [1, 2, 3])

    def test_run_rejects_tampered_active_module_before_runner(self):
        self.factory.create("processor", GOOD)
        target = Path(self.tmp.name) / "modules/processor.py"
        target.chmod(0o600)
        target.write_text("def run(data): return data")
        with self.assertRaisesRegex(RuntimeError, "MODULE_HASH_MISMATCH"):
            self.factory.run("processor", [1, 2])

    def test_never_overwrites_existing(self):
        self.factory.create("processor", GOOD)
        with self.assertRaises(FileExistsError):
            self.factory.create("processor", GOOD)

    def test_contract_is_persisted_per_version_and_restored_on_rollback(self):
        contract_v1 = {"cases": [{"input": [1, 2], "expected": [2, 4]}]}
        contract_v2 = {"cases": [{"input": [1, 2], "expected": [3, 6]}]}
        source_v1 = GOOD.replace("return list(data)", "return [x * 2 for x in data]")
        source_v2 = "\n".join(["def run(data):", "    return [x * 3 for x in data]", ""])
        first = self.factory.create("processor", source_v1, contract_v1)
        second = self.factory.promote("processor", source_v2, contract_v2)
        self.assertEqual(first["contract"], contract_v1)
        self.assertEqual(second["contract"], contract_v2)
        self.assertEqual(second["versions"][0]["contract"], contract_v1)
        self.assertEqual(second["versions"][1]["contract"], contract_v2)
        restored = self.factory.rollback("processor")
        self.assertEqual(restored["contract"], contract_v1)

    def test_contract_only_change_creates_new_version(self):
        contract_v1 = {"cases": [{"input": [1], "expected": [1]}]}
        contract_v2 = {"cases": [{"input": [2], "expected": [2]}]}
        first = self.factory.create("processor", GOOD, contract_v1)
        second = self.factory.promote("processor", GOOD, contract_v2)
        self.assertEqual(first["sha256"], second["sha256"])
        self.assertEqual(second["version"], 2)
        self.assertEqual(second["contract"], contract_v2)
        self.assertEqual(len(second["versions"]), 2)
        restored = self.factory.rollback("processor")
        self.assertEqual(restored["version"], 1)
        self.assertEqual(restored["contract"], contract_v1)

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
            module.write_text("\n".join(["def run(data):", "    return [x * 2 for x in data]", ""]))
            contract = {
                "cases": [
                    {"input": [1, 2], "expected": [2, 4]},
                    {"input": [-3, 0], "expected": [-6, 0]},
                ]
            }
            DockerSandboxRunner(timeout=15).run_smoke_test(module, contract)

    def test_factory_promote_and_rollback_runs_real_docker(self):
        from software_factory_x10.runner import DockerSandboxRunner
        with tempfile.TemporaryDirectory() as tmp:
            factory = SoftwareFactory(tmp, runner=DockerSandboxRunner(timeout=15))
            source_v1 = "\n".join(["def run(data):", "    return [x * 2 for x in data]", ""])
            source_v2 = "\n".join(["def run(data):", "    return [x * 3 for x in data]", ""])
            contract_v1 = {"cases": [{"input": [2, 4], "expected": [4, 8]}]}
            contract_v2 = {"cases": [{"input": [2, 4], "expected": [6, 12]}]}
            first = factory.create("release_candidate", source_v1, contract_v1)
            second = factory.promote("release_candidate", source_v2, contract_v2)
            self.assertEqual(second["version"], 2)
            self.assertEqual(second["contract"], contract_v2)
            rolled = factory.rollback("release_candidate")
            self.assertEqual(rolled["sha256"], first["sha256"])
            self.assertEqual(rolled["contract"], contract_v1)
            self.assertTrue(factory.destroy("release_candidate"))

    def test_real_docker_runner_invokes_active_module_with_json_input(self):
        from software_factory_x10.runner import DockerSandboxRunner
        with tempfile.TemporaryDirectory() as tmp:
            factory = SoftwareFactory(tmp, runner=DockerSandboxRunner(timeout=15))
            source = "\n".join(["def run(data):", "    return [x * 2 for x in data]", ""])
            contract = {"cases": [{"input": [1, 2], "expected": [2, 4]}]}
            factory.create("runtime_processor", source, contract)
            result = factory.run("runtime_processor", [3, 4])
            self.assertEqual(result, {"name": "runtime_processor", "version": 1, "result": [6, 8]})
            self.assertTrue(factory.destroy("runtime_processor"))

    def test_contract_only_promotion_runs_real_docker(self):
        from software_factory_x10.runner import DockerSandboxRunner
        with tempfile.TemporaryDirectory() as tmp:
            factory = SoftwareFactory(tmp, runner=DockerSandboxRunner(timeout=15))
            contract_v1 = {"cases": [{"input": [1, 2], "expected": [1, 2]}]}
            contract_v2 = {"cases": [{"input": [5, 6], "expected": [5, 6]}]}
            first = factory.create("same_source_module", GOOD, contract_v1)
            second = factory.promote("same_source_module", GOOD, contract_v2)
            self.assertEqual(first["sha256"], second["sha256"])
            self.assertEqual(second["version"], 2)
            self.assertEqual(second["contract"], contract_v2)
            restored = factory.rollback("same_source_module")
            self.assertEqual(restored["contract"], contract_v1)
            self.assertTrue(factory.destroy("same_source_module"))

    def test_contract_mismatch_rejects_module_before_publication(self):
        from software_factory_x10.runner import DockerSandboxRunner
        with tempfile.TemporaryDirectory() as tmp:
            factory = SoftwareFactory(tmp, runner=DockerSandboxRunner(timeout=15))
            wrong_contract = {"cases": [{"input": [1], "expected": [999]}]}
            with self.assertRaisesRegex(RuntimeError, "SANDBOX_TEST_FAILED"):
                factory.create("wrong_contract_module", GOOD, wrong_contract)
            self.assertNotIn("wrong_contract_module", factory.registry.list())
            self.assertFalse((Path(tmp) / "modules/wrong_contract_module.py").exists())

    def test_run_returns_controlled_code_for_module_exceptions(self):
        from software_factory_x10.runner import DockerSandboxRunner
        with tempfile.TemporaryDirectory() as tmp:
            factory = SoftwareFactory(tmp, runner=DockerSandboxRunner(timeout=15))
            source = "\n".join([
                "def run(data):",
                "    if data == 'boom':",
                "        raise RuntimeError('private internal detail')",
                "    return list(data)",
                ""
            ])
            factory.create("runtime_exception_module", source)
            with self.assertRaisesRegex(RuntimeError, "MODULE_EXECUTION_FAILED_RUNTIMEERROR"):
                factory.run("runtime_exception_module", "boom")
            self.assertTrue(factory.destroy("runtime_exception_module"))

    def test_run_rejects_output_over_32k(self):
        from software_factory_x10.runner import DockerSandboxRunner
        with tempfile.TemporaryDirectory() as tmp:
            factory = SoftwareFactory(tmp, runner=DockerSandboxRunner(timeout=15))
            source = "\n".join([
                "def run(data):",
                "    if data == 'large':",
                "        return 'x' * 40000",
                "    return list(data)",
                ""
            ])
            factory.create("large_output_module", source)
            with self.assertRaisesRegex(RuntimeError, "MODULE_OUTPUT_TOO_LARGE"):
                factory.run("large_output_module", "large")
            self.assertTrue(factory.destroy("large_output_module"))

    def test_run_rejects_non_json_result(self):
        from software_factory_x10.runner import DockerSandboxRunner
        with tempfile.TemporaryDirectory() as tmp:
            factory = SoftwareFactory(tmp, runner=DockerSandboxRunner(timeout=15))
            source = "\n".join([
                "def run(data):",
                "    if data == 'nan':",
                "        return float('nan')",
                "    return list(data)",
                ""
            ])
            factory.create("non_json_module", source)
            with self.assertRaisesRegex(RuntimeError, "MODULE_OUTPUT_INVALID"):
                factory.run("non_json_module", "nan")
            self.assertTrue(factory.destroy("non_json_module"))

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
