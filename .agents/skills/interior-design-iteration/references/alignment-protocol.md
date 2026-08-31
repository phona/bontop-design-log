---
name: alignment-protocol
description: Mandatory user-alignment protocol for every result-affecting ambiguity in interior design.
---

# Alignment Protocol

## Hard gate

Any ambiguity affecting the outcome enters `alignment_required`: stop edits and use `AskUserQuestion`. This includes object/part boundary and owner; wall material, structure, wall side, drillability, or glass/suppressed status; plan/elevation/section axes, origin, direction, and viewing side; total/net/clear/length/width/depth/height/along semantics; position, length, orientation, rotation; functional priority; storage versus beauty; HVAC/electrical/plumbing interfaces; and inspection, installation, maintenance, property, or construction conditions.

User observations outrank Agent guesses but still require verification. “在左边” is not a coordinate; “这里不对” is a fact lead, not permission to tune numbers.

## Procedure

1. Read `fact-table.yaml`; list relevant `confirmed`, `inferred`, `user_decision`, and `site_pending` entries with source refs.
2. State the unresolved variable and exactly what result it can change.
3. Call `AskUserQuestion` with 2–4 fact-based options. Each option must include benefit, cost, affected object/space, construction/maintenance consequence, and verification method. Include `暂不决定`.
4. No answer means pause: do not write design configuration, code, or generated output.
5. Convert custom prose into a verifiable `user_decision`; if it still has ambiguity, ask again and stay paused. Never supply a default.
6. Write the original answer, normalized decision, affected fact/datum/object refs, exceptions, and evidence refs into alignment and the decision brief.
7. Confirm priority, allowed scope, forbidden scope, open-question handling, and acceptance. Only then set `frozen: true`.

## Required question format

```text
已知事实：
- ... (source ref)

用户观察/冲突：
- ... (source ref; verification still required)

关键未知：
- ...

问题：请选择一个方案，或提供可验证的自定义决定；未决定则流程暂停。
A. ...（收益；代价；影响对象/空间；施工/维护；验证方式）
B. ...（收益；代价；影响对象/空间；施工/维护；验证方式）
C. ...（收益；代价；影响对象/空间；施工/维护；验证方式）
D. 暂不决定（保持 site_pending/blocked，不修改设计）
用户自定义：...（必须规范化并核验）
```

Do not conclude with “通常”, “大概率”, or “最合理”. Site conditions remain `site_pending`; never fill a value merely because the implementation needs one.

## Mandatory ambiguity checklist

Before implementation and at every iteration, explicitly check:

- What is the object boundary? Which parts are independent, and who owns each?
- Is the target wall solid, structurally suitable, drillable, and on the intended side? Is it a curtain run or suppressed wall?
- Which axis/origin/viewing side defines plan, elevation, and section?
- Is every dimension labeled overall/net/clear/length/width/depth/height/along/offset, with units?
- What is the functional priority and the accepted storage/beauty trade-off?
- What are HVAC, electrical, plumbing, inspection, installation, maintenance, property, and construction constraints?
- What exact views and evidence prove the acceptance criteria?

## During implementation

Immediately return to `alignment_required` when a new critical unknown, fact/model/screenshot conflict, wall or MEP risk, unclear object boundary, scope change, or aesthetic/functional conflict appears. Preserve current state and evidence first; do not make a “temporary” edit to see what happens.

## Freeze record

Each freeze records `alignment_id`, question/options, user’s original response, normalized `user_decision`, fact/datum/object refs, allowed and forbidden scope, acceptance, confirmation time, and remaining site-pending items. Never overwrite a historical decision. Any change sets `frozen: false` and requires a new alignment record.

## Discussion-only rule

If the user says “先讨论”, only clarify facts, options, risks, and acceptance. Do not edit any file, source configuration, code, render output, or generated artifact until the user explicitly authorizes implementation and the brief is frozen.
