"""Run a selective Stash scan and identify sequentially for a configured path."""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

POLL_INTERVAL_SECONDS = 5
JOB_TIMEOUT_SECONDS = 6 * 60 * 60

PLUGIN_SETTINGS_QUERY = """
query PluginSettings {
  configuration {
    plugins
  }
}
"""

SCAN_DEFAULTS_QUERY = """
query ScanDefaults {
  configuration {
    ui
  }
}
"""

SCAN_MUTATION = """
mutation ScanDirectory($input: ScanMetadataInput!) {
  metadataScan(input: $input)
}
"""

IDENTIFY_MUTATION = """
mutation IdentifyDirectory($input: IdentifyMetadataInput!) {
  metadataIdentify(input: $input)
}
"""

JOB_STATUS_QUERY = """
query JobStatus($jobId: ID!) {
  findJob(input: { id: $jobId }) {
    status
  }
}
"""

SCAN_DEFAULT_FIELDS = (
    "scanGenerateCovers",
    "scanGeneratePreviews",
    "scanGenerateImagePreviews",
    "scanGenerateSprites",
    "scanGeneratePhashes",
    "scanGenerateThumbnails",
    "scanGenerateClipPreviews",
)


def _stash_url(server_connection: dict) -> str:
    host = server_connection.get("Host", "localhost")
    if host == "0.0.0.0":
        host = "localhost"
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    scheme = server_connection.get("Scheme", "http")
    port = server_connection.get("Port", 9999)
    return f"{scheme}://{host}:{port}/graphql"


def _headers(server_connection: dict) -> dict:
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    api_key = server_connection.get("ApiKey")
    if api_key:
        headers["ApiKey"] = api_key
    session_cookie = server_connection.get("SessionCookie")
    if isinstance(session_cookie, dict) and session_cookie.get("Value"):
        cookie_name = session_cookie.get("Name") or "session"
        headers["Cookie"] = f"{cookie_name}={session_cookie['Value']}"
    return headers


def _graphql(server_connection: dict, query: str, variables: dict | None = None) -> dict:
    payload = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    request = urllib.request.Request(
        _stash_url(server_connection),
        data=payload,
        headers=_headers(server_connection),
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Stash GraphQL returned HTTP {exc.code}: {exc.reason}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Could not reach Stash GraphQL: {exc.reason}") from exc
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("Stash returned an invalid GraphQL response.") from exc

    if result.get("errors"):
        raise RuntimeError(f"Stash GraphQL error: {result['errors']}")
    data = result.get("data")
    if not isinstance(data, dict):
        raise RuntimeError("Stash GraphQL response did not contain data.")
    return data


def _configured_path(server_connection: dict, key: str) -> str:
    data = _graphql(server_connection, PLUGIN_SETTINGS_QUERY)
    plugins = data.get("configuration", {}).get("plugins", {})
    settings = plugins.get("quickScanIdentify", {}) if isinstance(plugins, dict) else {}
    path = settings.get(key, "") if isinstance(settings, dict) else ""
    if not isinstance(path, str) or not path.strip():
        raise ValueError(f"Configure a non-empty {key} path in Settings > Plugins.")
    return path.strip()


def _scan_input(server_connection: dict, path: str) -> dict:
    scan_input = {"paths": [path]}
    data = _graphql(server_connection, SCAN_DEFAULTS_QUERY)
    ui_config = data.get("configuration", {}).get("ui", {})
    if isinstance(ui_config, str):
        try:
            ui_config = json.loads(ui_config)
        except json.JSONDecodeError:
            ui_config = {}
    if not isinstance(ui_config, dict):
        return scan_input

    task_defaults = ui_config.get("taskDefaults", {})
    scan_defaults = task_defaults.get("scan", {}) if isinstance(task_defaults, dict) else {}
    if isinstance(scan_defaults, dict):
        scan_input.update(
            {
                field: scan_defaults[field]
                for field in SCAN_DEFAULT_FIELDS
                if field in scan_defaults
            }
        )
    return scan_input


def _wait_for_job(server_connection: dict, job_id: str, label: str) -> None:
    print(f"[QuickScanIdentify] Waiting for {label} job {job_id}.", flush=True)
    deadline = time.monotonic() + JOB_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        data = _graphql(server_connection, JOB_STATUS_QUERY, {"jobId": job_id})
        job = data.get("findJob")
        if not isinstance(job, dict) or not job.get("status"):
            raise RuntimeError(f"Could not read status for {label} job {job_id}.")
        status = job["status"]
        if status == "FINISHED":
            print(f"[QuickScanIdentify] {label} job {job_id} finished.", flush=True)
            return
        if status in ("FAILED", "CANCELLED"):
            raise RuntimeError(f"{label} job {job_id} ended with status {status}.")
        time.sleep(POLL_INTERVAL_SECONDS)
    raise TimeoutError(f"{label} job {job_id} did not finish before the timeout.")


def run_scan_and_identify(server_connection: dict, path: str) -> None:
    if not isinstance(path, str) or not path.strip():
        raise ValueError("The directory path must not be empty.")
    path = path.strip()

    print(f"[QuickScanIdentify] Starting selective scan for {path}.", flush=True)
    scan_data = _graphql(
        server_connection,
        SCAN_MUTATION,
        {"input": _scan_input(server_connection, path)},
    )
    scan_job_id = scan_data.get("metadataScan")
    if not scan_job_id:
        raise RuntimeError("Stash did not return a job ID for the scan.")
    _wait_for_job(server_connection, str(scan_job_id), "Scan")

    print(f"[QuickScanIdentify] Starting identify for {path}.", flush=True)
    identify_data = _graphql(
        server_connection,
        IDENTIFY_MUTATION,
        {"input": {"paths": [path], "options": {}}},
    )
    identify_job_id = identify_data.get("metadataIdentify")
    if not identify_job_id:
        raise RuntimeError("Stash did not return a job ID for identify.")
    _wait_for_job(server_connection, str(identify_job_id), "Identify")
    print(f"[QuickScanIdentify] Scan and identify completed for {path}.", flush=True)


def main() -> int:
    try:
        raw_input = sys.stdin.read()
        payload = json.loads(raw_input) if raw_input.strip() else {}
        server_connection = payload.get("server_connection", {})
        args = payload.get("args", {})
        mode = args.get("mode")
        path_setting = {
            "directory_a": "directoryA",
            "directory_b": "directoryB",
        }.get(mode)
        if not path_setting:
            raise ValueError(f"Unknown task mode: {mode!r}.")
        path = _configured_path(server_connection, path_setting)
        run_scan_and_identify(server_connection, path)
        return 0
    except Exception as exc:
        print(f"[QuickScanIdentify] ERROR: {exc}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
