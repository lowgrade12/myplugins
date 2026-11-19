"""Restash's process entry point (restash.yml exec).

Restash registers Scene.Update.Post so a scene is scored once it is marked
organized (Identify fills in performers, tags and studio, then sets organized).
Stash starts a plugin process for every scene update, though, including the
hundreds of score writes Restash makes on each refresh. This file decides
whether an event matters using only the standard library, so the uninteresting
ones cost an interpreter start and exit before restash.py pulls in stashapi.
"""
import json
import sys


def wanted(payload: dict) -> bool:
    """False only for a Scene.Update.Post that did not set organized to true."""
    ctx = (payload.get("args") or {}).get("hookContext")
    if not ctx or ctx.get("type") != "Scene.Update.Post":
        return True
    fields = ctx.get("inputFields") or []
    organized = (ctx.get("input") or {}).get("organized") is True
    return organized and (not fields or "organized" in fields)


def main(stream=None) -> int:
    raw = (stream or sys.stdin).read()
    payload = json.loads(raw) if raw.strip() else {}
    if not wanted(payload):
        return 0
    import restash
    return restash.run(payload)


if __name__ == "__main__":
    sys.exit(main())
