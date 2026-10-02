import unittest
from policy import evaluate

class PolicyTests(unittest.TestCase):
    def test_normal_patch_allowed_to_sandbox(self):
        result=evaluate(["src/fix.py"],"@@\n+value = 2","POLICY_CHECKING","SANDBOX_PENDING","github://Brand_Samuray-@abc1234")
        self.assertEqual(result["decision"],"ALLOW")

    def test_dangerous_patch_blocked(self):
        result=evaluate(["src/fix.py"],"+rm -rf /","POLICY_CHECKING","SANDBOX_PENDING","github://Brand_Samuray-@abc1234")
        self.assertEqual(result["decision"],"BLOCK")
        self.assertIn("recursive_delete",result["dangerous_findings"])

    def test_workflow_injection_blocked(self):
        workflow_expr = "$" + "{{ github.event.pull_request.title }}"
        result=evaluate([".github/workflows/ci.yml"],"+run: echo " + workflow_expr,"POLICY_CHECKING","SANDBOX_PENDING","github://Brand_Samuray-@abc1234")
        self.assertEqual(result["decision"],"BLOCK")

if __name__=="__main__":
    unittest.main()
