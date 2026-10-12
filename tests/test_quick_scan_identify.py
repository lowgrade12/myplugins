import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch


PLUGIN_PATH = (
    Path(__file__).resolve().parents[1]
    / "plugins"
    / "quickScanIdentify"
    / "quickScanIdentify.py"
)
SPEC = importlib.util.spec_from_file_location("quick_scan_identify", PLUGIN_PATH)
quick_scan_identify = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(quick_scan_identify)


class QuickScanIdentifyTest(unittest.TestCase):
    def test_scan_completes_before_identify_for_the_same_path(self):
        path = "/stash/one"
        calls = []

        def graphql(_connection, query, variables=None):
            calls.append((query, variables))
            if query == quick_scan_identify.SCAN_DEFAULTS_QUERY:
                return {"configuration": {"ui": "{}"}}
            if query == quick_scan_identify.SCAN_MUTATION:
                return {"metadataScan": "scan-id"}
            if query == quick_scan_identify.IDENTIFY_MUTATION:
                return {"metadataIdentify": "identify-id"}
            return {"findJob": {"status": "FINISHED"}}

        with patch.object(quick_scan_identify, "_graphql", side_effect=graphql):
            quick_scan_identify.run_scan_and_identify({}, path)

        mutation_calls = [call for call in calls if call[0] in (
            quick_scan_identify.SCAN_MUTATION,
            quick_scan_identify.IDENTIFY_MUTATION,
        )]
        self.assertEqual(
            [query for query, _ in mutation_calls],
            [quick_scan_identify.SCAN_MUTATION, quick_scan_identify.IDENTIFY_MUTATION],
        )
        self.assertEqual(mutation_calls[0][1]["input"]["paths"], [path])
        self.assertEqual(mutation_calls[1][1]["input"]["paths"], [path])

    def test_failed_scan_does_not_start_identify(self):
        calls = []

        def graphql(_connection, query, variables=None):
            calls.append(query)
            if query == quick_scan_identify.SCAN_DEFAULTS_QUERY:
                return {"configuration": {"ui": "{}"}}
            if query == quick_scan_identify.SCAN_MUTATION:
                return {"metadataScan": "scan-id"}
            return {"findJob": {"status": "FAILED"}}

        with patch.object(quick_scan_identify, "_graphql", side_effect=graphql):
            with self.assertRaisesRegex(RuntimeError, "status FAILED"):
                quick_scan_identify.run_scan_and_identify({}, "/stash/one")

        self.assertNotIn(quick_scan_identify.IDENTIFY_MUTATION, calls)

    def test_scan_input_preserves_stash_scan_defaults(self):
        def graphql(_connection, query, _variables=None):
            self.assertEqual(query, quick_scan_identify.SCAN_DEFAULTS_QUERY)
            return {
                "configuration": {
                    "ui": {
                        "taskDefaults": {
                            "scan": {
                                "scanGenerateCovers": False,
                                "scanGenerateSprites": True,
                            }
                        }
                    }
                }
            }

        with patch.object(quick_scan_identify, "_graphql", side_effect=graphql):
            scan_input = quick_scan_identify._scan_input({}, "/stash/one")

        self.assertEqual(scan_input["paths"], ["/stash/one"])
        self.assertFalse(scan_input["scanGenerateCovers"])
        self.assertTrue(scan_input["scanGenerateSprites"])


if __name__ == "__main__":
    unittest.main()
