#!/usr/bin/env python3
"""Read-only preflight checks for the shopping-research Skill.

This script only inspects local files, asks agent-browser for its version, and
reads the local CDP /json/version endpoint. It never navigates, logs in,
installs packages, or changes browser state.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


BASE_SKILLS = (
    "taobao-keyword-search",
    "taobao-product-detail",
    "jd-keyword-search",
    "jd-product-detail",
    "1688-keyword-search",
    "1688-product-detail",
)
DEFAULT_CDP_PORT = "9222"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run read-only shopping-research preflight checks.")
    parser.add_argument(
        "--skills-dir",
        type=Path,
        help="Skill installation root to inspect, for example .agents/skills.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print machine-readable JSON instead of human-readable lines.",
    )
    return parser.parse_args()


def unique_paths(paths: list[Path]) -> list[Path]:
    result: list[Path] = []
    seen: set[str] = set()
    for path in paths:
        normalized = str(path.expanduser())
        if normalized in seen:
            continue
        seen.add(normalized)
        result.append(Path(normalized))
    return result


def skill_roots(explicit: Path | None) -> list[Path]:
    roots: list[Path] = []
    if explicit is not None:
        roots.append(explicit)

    # This catches both a repository checkout and a standalone project-level
    # installation at <project>/.agents/skills/<skill>/scripts/preflight.py.
    roots.append(Path(__file__).resolve().parents[2])
    roots.extend(
        (
            Path.cwd() / ".agents" / "skills",
            Path.cwd() / ".codex" / "skills",
            Path.cwd() / "skills",
        )
    )

    codex_home = os.environ.get("CODEX_HOME")
    if codex_home:
        roots.append(Path(codex_home) / "skills")
    roots.extend((Path.home() / ".agents" / "skills", Path.home() / ".codex" / "skills"))
    return unique_paths(roots)


def locate_skill(name: str, roots: list[Path]) -> Path | None:
    for root in roots:
        candidate = root / name
        if candidate.is_dir():
            return candidate
    return None


def valid_skill_metadata(skill_path: Path, name: str) -> bool:
    skill_text = (skill_path / "SKILL.md").read_text(encoding="utf-8")
    lines = skill_text.splitlines()
    if not lines or lines[0] != "---":
        return False
    try:
        end = next(index for index, line in enumerate(lines[1:], 1) if line == "---")
    except StopIteration:
        return False
    frontmatter = "\n".join(lines[1:end])
    return bool(
        re.search(rf"^name:\s*{re.escape(name)}\s*$", frontmatter, re.MULTILINE)
        and re.search(r'^description:\s*".+"\s*$', frontmatter, re.MULTILINE)
    )


def check_base_skill(name: str, roots: list[Path]) -> dict[str, Any]:
    skill_path = locate_skill(name, roots)
    if skill_path is None:
        return {"name": name, "ok": False, "detail": "not found in configured Skill roots"}

    required = ("SKILL.md", "agents/openai.yaml", "scripts/extract.py")
    missing = [relative for relative in required if not (skill_path / relative).is_file()]
    if missing:
        return {
            "name": name,
            "ok": False,
            "path": str(skill_path),
            "detail": "missing " + ", ".join(missing),
        }

    try:
        metadata_ok = valid_skill_metadata(skill_path, name)
    except (OSError, UnicodeError):
        metadata_ok = False
    yaml_text = (skill_path / "agents" / "openai.yaml").read_text(encoding="utf-8")
    yaml_markers = ("interface:", "display_name:", "short_description:", "default_prompt:", "policy:")
    missing_metadata = [marker for marker in yaml_markers if marker not in yaml_text]
    if not metadata_ok:
        missing_metadata.append("valid SKILL.md frontmatter")
    if missing_metadata:
        return {
            "name": name,
            "ok": False,
            "path": str(skill_path),
            "detail": "incomplete metadata: " + ", ".join(missing_metadata),
        }
    return {"name": name, "ok": True, "path": str(skill_path), "detail": "SKILL.md, scripts, and metadata present"}


def check_python() -> dict[str, Any]:
    version = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    ok = sys.version_info >= (3, 9)
    detail = f"{sys.executable} ({version})"
    if not ok:
        detail += "; Python 3.9+ required"
    return {"name": "python", "ok": ok, "detail": detail}


def check_agent_browser() -> dict[str, Any]:
    executable = shutil.which("agent-browser")
    if executable is None:
        return {"name": "agent-browser", "ok": False, "detail": "executable not found on PATH"}
    try:
        result = subprocess.run(
            [executable, "--version"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return {"name": "agent-browser", "ok": False, "detail": f"version check failed: {error}"}
    version = (result.stdout or result.stderr).strip().splitlines()
    detail = version[0] if version else "version output was empty"
    if result.returncode:
        return {"name": "agent-browser", "ok": False, "detail": detail}
    return {"name": "agent-browser", "ok": True, "detail": f"{executable}: {detail}"}


def check_cdp(port: str) -> dict[str, Any]:
    endpoint = f"http://127.0.0.1:{port}/json/version"
    if not port.isdigit() or not 1 <= int(port) <= 65535:
        return {"name": "cdp", "ok": False, "detail": f"invalid AGENT_BROWSER_CDP port: {port!r}"}
    try:
        with urllib.request.urlopen(endpoint, timeout=3) as response:
            payload = response.read(4096)
            if response.status != 200:
                return {"name": "cdp", "ok": False, "detail": f"HTTP {response.status} from {endpoint}"}
    except (OSError, urllib.error.URLError) as error:
        return {"name": "cdp", "ok": False, "detail": f"{endpoint} unavailable: {error}"}

    try:
        version = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        version = None
    if isinstance(version, dict):
        browser = version.get("Browser") or version.get("browser")
        suffix = f" ({browser})" if browser else ""
        return {"name": "cdp", "ok": True, "detail": f"{endpoint} reachable{suffix}"}
    return {"name": "cdp", "ok": True, "detail": f"{endpoint} reachable"}


def render_human(checks: list[dict[str, Any]], port: str, roots: list[Path]) -> None:
    print(f"preflight: AGENT_BROWSER_CDP={port}")
    print("preflight: Skill roots=" + ", ".join(str(root) for root in roots))
    for check in checks:
        state = "ok" if check["ok"] else "failed"
        print(f"preflight {check['name']}: {state} — {check['detail']}")
    print("preflight: ok" if all(check["ok"] for check in checks) else "preflight: failed")


def main() -> int:
    args = parse_args()
    port = os.environ.get("AGENT_BROWSER_CDP", DEFAULT_CDP_PORT).strip() or DEFAULT_CDP_PORT
    roots = skill_roots(args.skills_dir)
    checks = [check_base_skill(name, roots) for name in BASE_SKILLS]
    checks.extend((check_python(), check_agent_browser(), check_cdp(port)))
    ok = all(check["ok"] for check in checks)
    if args.json:
        print(json.dumps({"ok": ok, "cdp": port, "skill_roots": [str(root) for root in roots], "checks": checks}, ensure_ascii=False))
    else:
        render_human(checks, port, roots)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
