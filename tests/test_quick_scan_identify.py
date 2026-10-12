import importlib.util
import io
import json
import subprocess
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
    def test_serial_queue_runs_scan_then_continuation_then_identify(self):
        path = "/stash/one"
        calls = []
        queue = []
        status = "READY"

        def graphql(_connection, query, variables=None):
            calls.append((query, variables))
            if query == quick_scan_identify.IDENTIFY_DEFAULTS_QUERY:
                return {"configuration": {
                    "defaults": {"identify": None},
                    "general": {"stashBoxes": [{"endpoint": "https://stash.example/graphql"}]},
                }}
            if query == quick_scan_identify.SCAN_DEFAULTS_QUERY:
                return {"configuration": {"ui": "{}"}}
            if query == quick_scan_identify.SCAN_MUTATION:
                queue.append(("scan", variables))
                return {"metadataScan": "scan-id"}
            if query == quick_scan_identify.CONTINUATION_MUTATION:
                queue.append(("continuation", variables["args"]))
                return {"runPluginTask": "continuation-id"}
            if query == quick_scan_identify.IDENTIFY_MUTATION:
                self.assertEqual(status, "FINISHED")
                queue.append(("identify", variables))
                return {"metadataIdentify": "identify-id"}
            self.assertEqual(query, quick_scan_identify.JOB_STATUS_QUERY)
            self.assertEqual(variables, {"jobId": "scan-id"})
            return {"findJob": {"status": status}}

        with patch.object(quick_scan_identify, "_graphql", side_effect=graphql):
            quick_scan_identify.run_scan_and_identify({}, path)
            self.assertEqual([job[0] for job in queue], ["scan", "continuation"])
            self.assertNotIn(quick_scan_identify.JOB_STATUS_QUERY, [q for q, _ in calls])
            queue.pop(0)
            status = "FINISHED"
            continuation = queue.pop(0)[1]
            with patch.object(quick_scan_identify.sys, "stdin", io.StringIO(json.dumps({
                "server_connection": {},
                "args": continuation,
            }))):
                self.assertEqual(quick_scan_identify.main(), 0)
            self.assertEqual([job[0] for job in queue], ["identify"])

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
        self.assertEqual(
            mutation_calls[1][1]["input"]["sources"],
            [{"source": {"stash_box_endpoint": "https://stash.example/graphql"}}],
        )
        self.assertEqual(sum(q == quick_scan_identify.JOB_STATUS_QUERY for q, _ in calls), 1)

    def test_unsuccessful_or_missing_scan_does_not_start_identify(self):
        for status in ("FAILED", "CANCELLED", "READY", "RUNNING", None):
            with self.subTest(status=status):
                response = {"findJob": {"status": status}} if status else {"findJob": None}
                with patch.object(quick_scan_identify, "_graphql", return_value=response) as graphql:
                    with self.assertRaisesRegex(RuntimeError, "identify skipped"):
                        quick_scan_identify._identify_after_scan({}, {
                            "scanJobId": "scan-id",
                            "identifyInput": {"paths": ["/stash/one"], "sources": []},
                        })
                graphql.assert_called_once_with(
                    {}, quick_scan_identify.JOB_STATUS_QUERY, {"jobId": "scan-id"}
                )

    def test_identify_input_preserves_saved_sources_and_options(self):
        defaults = {
            "sources": [
                {"source": {"scraper_id": "custom"}, "options": {"setCoverImage": False}},
                {"source": {"stash_box_endpoint": "https://stash.example/graphql"}},
            ],
            "options": {"fieldOptions": [{"field": "title", "strategy": "IGNORE"}]},
        }
        response = {"configuration": {"defaults": {"identify": defaults}}}
        with patch.object(quick_scan_identify, "_graphql", return_value=response):
            identify_input = quick_scan_identify._identify_input({}, "/stash/one")
        self.assertEqual(identify_input, {"paths": ["/stash/one"], **defaults})

    def test_older_stash_retries_with_legacy_identify_options(self):
        defaults = {
            "sources": [{"source": {"scraper_id": "custom"}}],
            "options": {"includeMalePerformers": False},
        }
        with patch.object(quick_scan_identify, "_graphql", side_effect=[
            RuntimeError('Stash GraphQL error: Cannot query field "performerGenders" '
                         'on type "IdentifyMetadataOptions".'),
            {"configuration": {"defaults": {"identify": defaults}}},
        ]) as graphql:
            self.assertEqual(
                quick_scan_identify._identify_input({}, "/stash/one"),
                {"paths": ["/stash/one"], **defaults},
            )
        self.assertEqual(graphql.call_args_list[1].args[1],
                         quick_scan_identify.LEGACY_IDENTIFY_DEFAULTS_QUERY)
        self.assertNotIn("performerGenders", quick_scan_identify.LEGACY_IDENTIFY_DEFAULTS_QUERY)
        self.assertIn("includeMalePerformers", quick_scan_identify.LEGACY_IDENTIFY_DEFAULTS_QUERY)

    def test_unrelated_identify_errors_are_not_retried(self):
        with patch.object(quick_scan_identify, "_graphql",
                          side_effect=RuntimeError("Could not reach Stash GraphQL")) as graphql:
            with self.assertRaisesRegex(RuntimeError, "Could not reach"):
                quick_scan_identify._identify_input({}, "/stash/one")
        graphql.assert_called_once()

    def test_http_schema_error_retries_legacy_identify_query(self):
        defaults = {
            "sources": [{"source": {"scraper_id": "custom"}}],
            "options": {"includeMalePerformers": False},
        }
        error_body = json.dumps({"errors": [{
            "message": 'Cannot query field "performerGenders" on type "IdentifyMetadataOptions".',
        }]}).encode("utf-8")
        error = quick_scan_identify.urllib.error.HTTPError(
            "http://localhost:9999/graphql", 422, "Unprocessable Entity", {},
            io.BytesIO(error_body),
        )
        response = io.BytesIO(json.dumps({
            "data": {"configuration": {"defaults": {"identify": defaults}}},
        }).encode("utf-8"))
        with patch.object(quick_scan_identify.urllib.request, "urlopen",
                          side_effect=[error, response]) as urlopen:
            self.assertEqual(
                quick_scan_identify._identify_input({}, "/stash/one"),
                {"paths": ["/stash/one"], **defaults},
            )
        request = urlopen.call_args_list[1].args[0]
        self.assertEqual(json.loads(request.data)["query"],
                         quick_scan_identify.LEGACY_IDENTIFY_DEFAULTS_QUERY)

    def test_non_graphql_http_errors_keep_status(self):
        for body in (b"Bad gateway", b"{}", b"[]"):
            with self.subTest(body=body):
                error = quick_scan_identify.urllib.error.HTTPError(
                    "http://localhost:9999/graphql", 502, "Bad Gateway", {}, io.BytesIO(body),
                )
                with patch.object(quick_scan_identify.urllib.request, "urlopen",
                                  side_effect=error):
                    with self.assertRaisesRegex(RuntimeError, "HTTP 502"):
                        quick_scan_identify._graphql({}, "query Test { configuration { ui } }")

    def test_operations_return_json_success_or_error(self):
        for mode in ("directory_a", "directory_b"):
            for error in (None, ValueError("Configure Identify sources")):
                with self.subTest(mode=mode, error=error):
                    stdout = io.StringIO()
                    payload = {"args": {"mode": mode}}
                    with patch.object(quick_scan_identify.sys, "stdin",
                                      io.StringIO(json.dumps(payload))), \
                         patch.object(quick_scan_identify.sys, "stdout", stdout), \
                         patch.object(quick_scan_identify.sys, "stderr", io.StringIO()), \
                         patch.object(quick_scan_identify, "_configured_path",
                                      return_value="/stash/one"), \
                         patch.object(quick_scan_identify, "run_scan_and_identify",
                                      side_effect=error) as run:
                        self.assertEqual(quick_scan_identify.main(), 1 if error else 0)
                    run.assert_called_once_with({}, "/stash/one")
                    result = json.loads(stdout.getvalue())
                    if error:
                        self.assertEqual(result, {"error": str(error)})
                    else:
                        self.assertEqual(result, {"output": "Scan and identify continuation queued."})

    def test_navbar_buttons_launch_named_plugin_tasks_without_popups_and_show_errors(self):
        result = subprocess.run(
            ["node", "-e", r"""
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
class Element {
  constructor() { this.children = []; this.dataset = {}; this.style = {}; this.attrs = {}; }
  set innerHTML(value) {
    this.link = new Element();
    this.link.id = value.match(/id="([^"]+)"/)[1];
  }
  querySelector() { return this.link; }
  appendChild(child) { this.children.push(child); }
  setAttribute(key, value) { this.attrs[key] = value; }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(name, callback) { this[name] = callback; }
}
const nav = new Element();
const document = {
  readyState: "complete", body: {},
  querySelector: () => nav,
  getElementById: id => nav.children.find(child => child.link.id === id),
  createElement: () => new Element()
};
const calls = [];
let response = { data: { runPluginTask: "task-job-id" } };
let httpOk = true;
vm.runInNewContext(fs.readFileSync(process.argv[1], "utf8"), {
  document,
  MutationObserver: class { observe() {} },
  console: { error() {} },
  window: { alert() { assert.fail("No popup should be shown"); } },
  fetch: async (url, options) => {
    assert.equal(url, "/graphql");
    calls.push(JSON.parse(options.body));
    return { ok: httpOk, status: 503, json: async () => response };
  }
});
(async () => {
  assert.equal(nav.children.length, 2);
  const taskNames = fs.readFileSync(process.argv[2], "utf8")
    .split("\n").filter(line => line.startsWith("  - name: "))
    .map(line => line.slice("  - name: ".length).trim());
  assert.equal(taskNames.length, 2);
  for (const [index, taskName] of taskNames.entries()) {
    const container = nav.children[index];
    await container.link.click({ preventDefault() {} });
    const request = calls.at(-1);
    assert.match(request.query, /runPluginTask\(/);
    assert.match(request.query, /task_name: \$task_name/);
    assert.doesNotMatch(request.query, /runPluginOperation|metadataScan|metadataIdentify/);
    assert.deepEqual(request.variables, {
      plugin_id: "quickScanIdentify", task_name: taskName
    });
    assert.equal(container.children[0].textContent, "Scan & Identify queued.");
    assert.equal(container.link.dataset.running, undefined);
  }
  const container = nav.children[0];
  for (const [body, message] of [
    [{ errors: [{ message: "Plugin disabled" }] }, "Plugin disabled"],
    [{ data: { runPluginTask: null }, errors: [{ message: "Task not found" }] }, "Task not found"],
    [{ data: { runPluginTask: null } }, "Stash did not queue the task."]
  ]) {
    response = body;
    await container.link.click({ preventDefault() {} });
    assert.equal(container.children[0].textContent, "Could not start: " + message);
    assert.equal(container.link.attrs["aria-disabled"], undefined);
    assert.equal(container.link.style.opacity, "");
  }
  httpOk = false;
  await container.link.click({ preventDefault() {} });
  assert.match(container.children[0].textContent, /HTTP 503/);
  httpOk = true;
  response = { data: { runPluginTask: "task-job-id" } };
  const count = calls.length;
  const pending = container.link.click({ preventDefault() {} });
  await container.link.click({ preventDefault() {} });
  await pending;
  assert.equal(calls.length, count + 1);
  assert.equal(container.children[0].textContent, "Scan & Identify queued.");
})().catch(error => { console.error(error); process.exitCode = 1; });
""", str(PLUGIN_PATH.with_suffix(".js")), str(PLUGIN_PATH.with_suffix(".yml"))],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_missing_sources_fail_before_queuing_scan(self):
        for defaults in (None, {"sources": []}):
            with self.subTest(defaults=defaults):
                response = {"configuration": {
                    "defaults": {"identify": defaults},
                    "general": {"stashBoxes": []},
                }}
                with patch.object(quick_scan_identify, "_graphql", return_value=response) as graphql:
                    with self.assertRaisesRegex(ValueError, "Configure Identify sources"):
                        quick_scan_identify.run_scan_and_identify({}, "/stash/one")
                graphql.assert_called_once_with({}, quick_scan_identify.IDENTIFY_DEFAULTS_QUERY)

    def test_missing_job_ids_report_errors_without_polling(self):
        for responses, message in (
            ([{}], "job ID for the scan"),
            ([{"metadataScan": "scan-id"}, {}], "continuation was not queued"),
        ):
            with self.subTest(message=message):
                with patch.object(quick_scan_identify, "_identify_input", return_value={}), \
                     patch.object(quick_scan_identify, "_scan_input", return_value={}), \
                     patch.object(quick_scan_identify, "_graphql", side_effect=responses):
                    with self.assertRaisesRegex(RuntimeError, message):
                        quick_scan_identify.run_scan_and_identify({}, "/stash/one")

    def test_continuation_requires_arguments_and_identify_job_id(self):
        with self.assertRaisesRegex(ValueError, "Missing scan job ID"):
            quick_scan_identify._identify_after_scan({}, {})
        with patch.object(quick_scan_identify, "_graphql", side_effect=[
            {"findJob": {"status": "FINISHED"}}, {},
        ]):
            with self.assertRaisesRegex(RuntimeError, "job ID for identify"):
                quick_scan_identify._identify_after_scan({}, {
                    "scanJobId": "scan-id", "identifyInput": {},
                })

    def test_directory_modes_resolve_their_own_setting(self):
        for mode, setting in (("directory_a", "directoryA"), ("directory_b", "directoryB")):
            with self.subTest(mode=mode):
                payload = {"server_connection": {"Port": 9999}, "args": {"mode": mode}}
                with patch.object(quick_scan_identify.sys, "stdin", io.StringIO(json.dumps(payload))), \
                     patch.object(quick_scan_identify, "_configured_path", return_value="/stash/one") as configured, \
                     patch.object(quick_scan_identify, "run_scan_and_identify") as run:
                    self.assertEqual(quick_scan_identify.main(), 0)
                configured.assert_called_once_with(payload["server_connection"], setting)
                run.assert_called_once_with(payload["server_connection"], "/stash/one")

    def test_empty_path_does_not_call_graphql(self):
        with patch.object(quick_scan_identify, "_graphql") as graphql:
            with self.assertRaisesRegex(ValueError, "must not be empty"):
                quick_scan_identify.run_scan_and_identify({}, " ")
            graphql.assert_not_called()

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
