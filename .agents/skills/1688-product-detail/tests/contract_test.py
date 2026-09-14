#!/usr/bin/env python3
"""Run the 1688 detail extractor against sanitized local HTML fixtures."""

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


def extract(fixture: str, offer_id: str = "4001") -> dict:
    browser("open", (FIXTURES / fixture).as_uri())
    browser("wait", "--load", "domcontentloaded")
    js = subprocess.run([sys.executable, str(ROOT / "scripts" / "extract.py"), offer_id], text=True, capture_output=True, check=True).stdout
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
        detail = extract("detail.html")
        assert detail["status"] == "ok"
        assert detail["platform"] == "1688"
        assert detail["id"] == "4001"
        assert detail["price"]["tiers"][0]["minQty"] == 30
        assert detail["price"]["tiers"][1]["amount"] == 7.5
        assert detail["price"]["moq"] == {"raw": "30件", "amount": 30}
        assert detail["price"]["unit"] == "件"
        assert detail["platformData"]["skuCount"] == 1
        assert detail["skuResolved"] is False
        assert detail["attributes"]["材质"] == "脱敏TPU"
        assert "满100减5" in detail["promotions"]

        auth = extract("authentication.html")
        assert auth["status"] == "authentication_required"
        changed = extract("layout-changed.html")
        assert changed["status"] == "layout_changed"
        print("1688-product-detail contract: ok")
    finally:
        subprocess.run(["agent-browser", "--session", SESSION, "close"], capture_output=True, text=True, env=BROWSER_ENV)


if __name__ == "__main__":
    main()
