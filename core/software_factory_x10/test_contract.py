import math
import unittest

from software_factory_x10.contract import (
    DEFAULT_CONTRACT,
    MAX_CONTRACT_BYTES,
    MAX_TEST_CASES,
    validate_contract,
)


class ContractValidationTests(unittest.TestCase):
    def test_default_contract_is_backward_compatible(self):
        self.assertEqual(validate_contract(), DEFAULT_CONTRACT)

    def test_accepts_multiple_json_input_expected_cases(self):
        contract = {
            "cases": [
                {"input": [1, 2], "expected": [2, 4]},
                {"input": [-3, 0], "expected": [-6, 0]},
            ]
        }
        self.assertEqual(validate_contract(contract), contract)

    def test_rejects_empty_cases(self):
        with self.assertRaisesRegex(ValueError, "CONTRACT_CASES_REQUIRED"):
            validate_contract({"cases": []})

    def test_rejects_more_than_maximum_cases(self):
        contract = {"cases": [{"input": [1], "expected": [1]} for _ in range(MAX_TEST_CASES + 1)]}
        with self.assertRaisesRegex(ValueError, "CONTRACT_CASE_LIMIT"):
            validate_contract(contract)

    def test_rejects_case_with_extra_or_missing_keys(self):
        with self.assertRaisesRegex(ValueError, "CONTRACT_CASE_INVALID"):
            validate_contract({"cases": [{"input": [1], "expected": [1], "code": "print(1)"}]})
        with self.assertRaisesRegex(ValueError, "CONTRACT_CASE_INVALID"):
            validate_contract({"cases": [{"input": [1]}]})

    def test_rejects_nan_and_non_json_values(self):
        with self.assertRaisesRegex(ValueError, "CONTRACT_INVALID"):
            validate_contract({"cases": [{"input": math.nan, "expected": None}]})
        with self.assertRaisesRegex(ValueError, "CONTRACT_INVALID"):
            validate_contract({"cases": [{"input": b"binary", "expected": None}]})

    def test_rejects_contract_larger_than_limit(self):
        contract = {"cases": [{"input": "x" * MAX_CONTRACT_BYTES, "expected": "x"}]}
        with self.assertRaisesRegex(ValueError, "CONTRACT_TOO_LARGE"):
            validate_contract(contract)

    def test_rejects_unknown_top_level_fields(self):
        with self.assertRaisesRegex(ValueError, "CONTRACT_INVALID"):
            validate_contract({"cases": [{"input": 1, "expected": 1}], "setup": "ignored"})


if __name__ == "__main__":
    unittest.main()
