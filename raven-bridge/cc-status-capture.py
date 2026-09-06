#!/usr/bin/env python3
"""Capture safe Claude Code statusLine fields for raven-bridge.

Deploy this file as ~/bin/cc-status-capture.py. It never reads credentials or
conversation text; Claude Code supplies the status JSON on stdin.
"""

import json
import os
import sys
import tempfile
import time


OUTPUT = os.path.expanduser("~/.claude/rate_limits_latest.json")


def window(value):
    if not isinstance(value, dict):
        return None
    return {
        "used_percent": value.get("used_percentage"),
        "reset_at": value.get("resets_at"),
    }


def main():
    source = json.load(sys.stdin)
    context = source.get("context_window") or {}
    limits = source.get("rate_limits") or {}
    model = source.get("model") or {}
    cost = source.get("cost") or {}
    snapshot = {
        "available": True,
        "updated_at": int(time.time()),
        "model": model.get("id") or model.get("display_name") or "",
        "five_hour": window(limits.get("five_hour")),
        "seven_day": window(limits.get("seven_day")),
        "context_used_percent": context.get("used_percentage"),
        "context_window_size": context.get("context_window_size"),
        "session_cost_usd": cost.get("total_cost_usd"),
        "prompt_cache": source.get("prompt_cache"),
    }

    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix="rate_limits_", suffix=".json", dir=os.path.dirname(OUTPUT))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(snapshot, handle, ensure_ascii=False, separators=(",", ":"))
        os.replace(temporary, OUTPUT)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

    pct = context.get("used_percentage")
    name = model.get("display_name") or model.get("id") or "Claude"
    print(f"[{name}] {round(pct)}% context" if isinstance(pct, (int, float)) else f"[{name}]")


if __name__ == "__main__":
    main()
