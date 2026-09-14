#!/usr/bin/env python3
"""Run the Taobao search extractor against sanitized local HTML fixtures."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"
SESSION = f"cn-shopping-skills-{uuid.uuid4().hex[:12]}"
BROWSER_ENV = {**os.environ, "XDG_RUNTIME_DIR": tempfile.mkdtemp(prefix="cn-shopping-skills-runtime-", dir="/tmp")}


def run_browser(*args: str, stdin: str | None = None) -> str:
    result = subprocess.run(
        ["agent-browser", "--session", SESSION, *args],
        input=stdin,
        text=True,
        capture_output=True,
        check=False,
        env=BROWSER_ENV,
    )
    if result.returncode:
        raise AssertionError(f"agent-browser failed: {result.stderr or result.stdout}")
    return result.stdout


def result_object(output: str) -> dict:
    def find(value):
        if isinstance(value, dict):
            if "status" in value and "platform" in value:
                return value
            for child in value.values():
                found = find(child)
                if found is not None:
                    return found
        elif isinstance(value, list):
            for child in value:
                found = find(child)
                if found is not None:
                    return found
        return None

    candidates = [output.strip()]
    candidates.extend(reversed([line.strip() for line in output.splitlines() if line.strip()]))
    for candidate in candidates:
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        found = find(value)
        if found is not None:
            return found
    raise AssertionError(f"could not find extractor JSON in: {output[-1000:]}")


def extract(fixture: str) -> dict:
    run_browser("open", (FIXTURES / fixture).as_uri())
    run_browser("wait", "--load", "domcontentloaded")
    js = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "extract.py"), "脱敏词", "--page", "1"],
        text=True,
        capture_output=True,
        check=True,
    ).stdout
    return result_object(run_browser("eval", "--stdin", "--json", stdin=js))


def main() -> None:
    try:
        success = extract("search.html")
        assert success["status"] == "ok"
        assert success["platform"] == "taobao"
        assert success["items"][0]["id"] == "1001"
        assert success["items"][0]["price"] == {"raw": "￥79.90 券后价", "amount": 79.9, "kind": "after_coupon"}
        assert success["items"][1]["sponsored"] is True
        assert success["items"][1]["price"]["kind"] == "starting"

        empty = extract("no-results.html")
        assert empty["status"] == "no_results"
        assert empty["items"] == []

        auth = extract("authentication.html")
        assert auth["status"] == "authentication_required"
        assert auth["items"] == []
        print("taobao-keyword-search contract: ok")
    finally:
        subprocess.run(["agent-browser", "--session", SESSION, "close"], capture_output=True, text=True, env=BROWSER_ENV)


if __name__ == "__main__":
    main()
