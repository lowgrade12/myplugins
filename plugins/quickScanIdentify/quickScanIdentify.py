"""Queue a selective Stash scan and identify for a configured path."""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

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

CONTINUATION_MUTATION = """
mutation ContinueAfterScan($args: Map!) {
  runPluginTask(
    plugin_id: "quickScanIdentify"
    args_map: $args
    description: "Quick Scan & Identify: identify after scan"
  )
}
"""

IDENTIFY_DEFAULTS_QUERY = """
fragment IdentifyOptions on IdentifyMetadataOptions {
  fieldOptions { field strategy createMissing }
  setCoverImage
  setOrganized
  performerGenders
  skipMultipleMatches
  skipMultipleMatchTag
  skipSingleNamePerformers
  skipSingleNamePerformerTag
}
query IdentifyDefaults {
  configuration {
    defaults {
      identify {
        sources {
          source { scraper_id stash_box_endpoint stash_box_index }
          options { ...IdentifyOptions }
        }
        options { ...IdentifyOptions }
      }
    }
    general { stashBoxes { endpoint } }
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


def _identify_input(server_connection: dict, path: str) -> dict:
    configuration = _graphql(server_connection, IDENTIFY_DEFAULTS_QUERY)["configuration"]
    defaults = configuration.get("defaults", {}).get("identify")
    if isinstance(defaults, dict):
        sources = defaults.get("sources")
        options = defaults.get("options")
    else:
        boxes = configuration.get("general", {}).get("stashBoxes", [])
        sources = [
            {"source": {"stash_box_endpoint": boxes[0]["endpoint"]}}
        ] if boxes else []
        options = {
            "setCoverImage": True,
            "setOrganized": False,
            "skipMultipleMatches": True,
            "skipSingleNamePerformers": True,
        }
    if not sources:
        raise ValueError(
            "Configure Identify sources in Stash's Identify dialog and click Set as default, "
            "or configure a Stash-box endpoint before running this task."
        )
    return {"paths": [path], "sources": sources, "options": options}


def _identify_after_scan(server_connection: dict, args: dict) -> None:
    scan_job_id = args.get("scanJobId")
    identify_input = args.get("identifyInput")
    if not scan_job_id or not isinstance(identify_input, dict):
        raise ValueError("Missing scan job ID or identify input for continuation.")
    data = _graphql(server_connection, JOB_STATUS_QUERY, {"jobId": str(scan_job_id)})
    job = data.get("findJob")
    if not isinstance(job, dict) or not job.get("status"):
        raise RuntimeError(f"Could not read status for Scan job {scan_job_id}; identify skipped.")
    if job["status"] != "FINISHED":
        raise RuntimeError(
            f"Scan job {scan_job_id} ended with status {job['status']}; identify skipped."
        )
    identify_data = _graphql(server_connection, IDENTIFY_MUTATION, {"input": identify_input})
    identify_job_id = identify_data.get("metadataIdentify")
    if not identify_job_id:
        raise RuntimeError("Stash did not return a job ID for identify.")
    print(f"[QuickScanIdentify] Queued Identify job {identify_job_id}.", flush=True)


def run_scan_and_identify(server_connection: dict, path: str) -> None:
    if not isinstance(path, str) or not path.strip():
        raise ValueError("The directory path must not be empty.")
    path = path.strip()
    identify_input = _identify_input(server_connection, path)

    print(f"[QuickScanIdentify] Starting selective scan for {path}.", flush=True)
    scan_data = _graphql(
        server_connection,
        SCAN_MUTATION,
        {"input": _scan_input(server_connection, path)},
    )
    scan_job_id = scan_data.get("metadataScan")
    if not scan_job_id:
        raise RuntimeError("Stash did not return a job ID for the scan.")
    # Stash runs jobs serially: waiting here would block the scan behind this task.
    continuation_data = _graphql(
        server_connection,
        CONTINUATION_MUTATION,
        {"args": {
            "mode": "after_scan",
            "scanJobId": str(scan_job_id),
            "identifyInput": identify_input,
        }},
    )
    if not continuation_data.get("runPluginTask"):
        raise RuntimeError(f"Scan job {scan_job_id} queued, but identify continuation was not queued.")
    print(
        f"[QuickScanIdentify] Queued Scan job {scan_job_id} and identify continuation for {path}.",
        flush=True,
    )


def main() -> int:
    try:
        raw_input = sys.stdin.read()
        payload = json.loads(raw_input) if raw_input.strip() else {}
        server_connection = payload.get("server_connection", {})
        args = payload.get("args", {})
        mode = args.get("mode")
        if mode == "after_scan":
            _identify_after_scan(server_connection, args)
            return 0
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
