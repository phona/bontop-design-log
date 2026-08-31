---
name: review-contracts
description: Fixed JSON contract for independent aesthetic and functional interior-design reviewers.
---

# Review Contracts

The only allowed verdict values are `PASS`, `FAIL`, and `BLOCKED` (固定契约：`PASS|FAIL|BLOCKED`). Each reviewer must emit exactly this top-level JSON shape:

```json
{
  "verdict": "PASS",
  "blocking_issues": [],
  "non_blocking_notes": [],
  "evidence_refs": [],
  "requested_changes": [],
  "assumptions": []
}
```

Field rules:

- `verdict`: `PASS` means the reviewer scope is evidenced and has no blocking issue; `FAIL` means a reproducible blocking issue exists; `BLOCKED` means facts, validation, or evidence are insufficient to judge.
- `blocking_issues`: only issues that prevent this reviewer from passing; identify object, fact, evidence, and required change.
- `non_blocking_notes`: observations that do not prevent this delivery; they do not authorize scope expansion.
- `evidence_refs`: snapshot, PNG, runtime query, validation output, or fact refs.
- `requested_changes`: only approved-scope changes needed for blocking issues.
- `assumptions`: remaining assumptions, classified consistently with the fact table; never disguise them as confirmed.

## Aesthetic reviewer responsibility

Review proportion, scale, hierarchy, material/color/texture, grain direction, sightlines, composition, light, shadow, visual cohesion, and whether independent objects form a coherent whole. Do not substitute scripts for visual judgment and do not judge functional/structural matters as aesthetic PASS.

## Functional reviewer responsibility

Review clearances, opening and circulation, ergonomics, collision, carrying, maintenance/inspection, MEP interfaces, structure/construction risk, durability, and user goals. Do not substitute a good-looking image for functional or construction evidence.

## Overall gate

Configuration, topology, consistency, furniture, collision, runtime, and type results are separate evidence layers, not reviewer PASS. If either reviewer is `FAIL` or `BLOCKED`, overall delivery cannot be `delivery_ready`. If aesthetic and functional results conflict, record both facts and evidence, return to `alignment_required`, and ask the user to choose the trade-off; never use majority vote. A next iteration fixes only recorded, approved blocking issues; old evidence is invalid after a source/version change.
