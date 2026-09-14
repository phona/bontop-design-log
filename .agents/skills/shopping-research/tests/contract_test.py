#!/usr/bin/env python3
"""Standalone contract checks for the shopping-research orchestration Skill."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REFERENCES = ROOT / "references"


def main() -> None:
    entrypoint = (ROOT / "SKILL.md").read_text(encoding="utf-8")
    assert entrypoint.startswith("---\nname: shopping-research\n")
    assert "references/exploration-strategy.md" in entrypoint
    assert "references/risk-checklist.md" in entrypoint
    assert "references/report-contract.md" in entrypoint
    assert "owned pinned target" in entrypoint
    assert "不执行任何交易" in entrypoint

    strategy = (REFERENCES / "exploration-strategy.md").read_text(encoding="utf-8")
    risks = (REFERENCES / "risk-checklist.md").read_text(encoding="utf-8")
    report = (REFERENCES / "report-contract.md").read_text(encoding="utf-8")
    all_references = strategy + risks + report
    for marker in ("hardConstraints", "preferences", "budget", "taboos", "unknowns", "observedAt", "status"):
        assert marker in all_references, marker
    for marker in ("信息增益", "结果收敛", "阻塞", "预算耗尽", "头/中/尾", "疑似同款", "不可直接比较", "淘汰"):
        assert marker in strategy or marker in report, marker
    for marker in ("执行摘要", "需求与口径", "探索覆盖", "候选对比", "推荐与备选", "淘汰项", "风险与未知", "用户下一步核验"):
        assert marker in report, marker
    for marker in ("authentication_required", "security_verification", "site_blocked", "layout_changed", "no_results"):
        assert marker in risks and marker in report, marker
    for marker in ("加购", "收藏", "下单", "支付", "自动登录", "绕过", "MCP", "REST API", "Provider", "SDK"):
        assert marker in entrypoint or marker in risks, marker
    assert "reviews" in entrypoint and "未验证" in entrypoint
    assert "固定页数" in entrypoint or "固定候选数" in entrypoint
    preflight = ROOT / "scripts" / "preflight.py"
    assert preflight.is_file()
    preflight_text = preflight.read_text(encoding="utf-8")
    for marker in ("BASE_SKILLS", "AGENT_BROWSER_CDP", "/json/version", "agent-browser", "--version"):
        assert marker in preflight_text, marker
    for forbidden in (" tab new", " tab close", '"open"', "login"):
        assert forbidden not in preflight_text, forbidden
    print("shopping-research contract: ok")


if __name__ == "__main__":
    main()
