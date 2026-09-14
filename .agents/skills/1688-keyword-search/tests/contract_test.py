#!/usr/bin/env python3
"""Run the 1688 search extractor against sanitized local HTML fixtures."""

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


def browser(*args: str, stdin: str | None = None) -> str:
    result = subprocess.run(["agent-browser", "--session", SESSION, *args], input=stdin, text=True, capture_output=True, check=False, env=BROWSER_ENV)
    if result.returncode:
        raise AssertionError(result.stderr or result.stdout)
    return result.stdout


def extract(fixture: str) -> dict:
    browser("open", (FIXTURES / fixture).as_uri())
    browser("wait", "--load", "domcontentloaded")
    js = subprocess.run([sys.executable, str(ROOT / "scripts" / "extract.py"), "脱敏词", "--page", "1"], text=True, capture_output=True, check=True).stdout
    output = browser("eval", "--stdin", "--json", stdin=js)
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

    for line in reversed([line.strip() for line in output.splitlines() if line.strip()]):
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        found = find(value)
        if found is not None:
            return found
    raise AssertionError(output)


def main() -> None:
    try:
        result = extract("search.html")
        assert result["status"] == "ok"
        assert result["platform"] == "1688"
        item = result["items"][0]
        assert item["id"] == "3001"
        assert item["price"]["amount"] == 8.5
        assert item["platformData"]["moq"] == {"raw": "30件起订", "amount": 30}
        assert item["platformData"]["tieredPrices"][1]["amount"] == 7.5
        assert item["platformData"]["unit"] == "件"
        assert result["items"][1]["price"]["kind"] == "negotiable"

        empty = extract("no-results.html")
        assert empty["status"] == "no_results"
        auth = extract("authentication.html")
        assert auth["status"] == "authentication_required"
        security = extract("security-verification.html")
        assert security["status"] == "security_verification"
        modern = extract("modern-search.html")
        assert modern["status"] == "ok"
        assert modern["items"][0]["id"] == "1066276573006"
        assert modern["items"][0]["platformData"]["idSource"] in {"href", "data-renderkey"}
        assert modern["items"][0]["url"] == "https://detail.1688.com/offer/1066276573006.html"
        assert modern["items"][1]["id"] == "663322491606"
        assert modern["items"][1]["url"] == "https://detail.1688.com/offer/663322491606.html"
        unknown = modern["items"][2]
        assert unknown["id"] == "unknown"
        assert unknown["url"] is None
        assert unknown["platformData"]["trackingUrl"].startswith("https://dj.1688.com/ci_bb")
        print("1688-keyword-search contract: ok")
    finally:
        subprocess.run(["agent-browser", "--session", SESSION, "close"], capture_output=True, text=True, env=BROWSER_ENV)


if __name__ == "__main__":
    main()
