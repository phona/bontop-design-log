#!/usr/bin/env python3
"""Run the Taobao detail extractor against sanitized local HTML fixtures."""

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


def extract(fixture: str, item_id: str = "744983869996") -> dict:
    browser("open", (FIXTURES / fixture).as_uri())
    browser("wait", "--load", "domcontentloaded")
    js = subprocess.run([sys.executable, str(ROOT / "scripts" / "extract.py"), item_id], text=True, capture_output=True, check=True).stdout
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
        assert detail["id"] == "744983869996"
        assert detail["title"] == "脱敏商品标题"
        assert detail["price"]["amount"] == 129.9
        assert detail["price"]["originalAmount"] == 159.9
        assert detail["skuResolved"] is False
        assert detail["skuGroups"][0]["options"][0]["label"] == "黑色"
        assert detail["attributes"]["品牌"] == "脱敏品牌"
        assert detail["shippingText"] == "运费：免运费"

        auth = extract("authentication.html")
        assert auth["status"] == "authentication_required"
        assert auth["skuResolved"] is False

        changed = extract("layout-changed.html")
        assert changed["status"] == "layout_changed"
        print("taobao-product-detail contract: ok")
    finally:
        subprocess.run(["agent-browser", "--session", SESSION, "close"], capture_output=True, text=True, env=BROWSER_ENV)


if __name__ == "__main__":
    main()
