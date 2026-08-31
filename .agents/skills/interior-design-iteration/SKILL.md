---
name: interior-design-iteration
description: Formal, reusable interior-design iteration protocol that prevents Agent guesswork, misaligned schemes, and half-finished delivery through facts, user alignment, frozen baselines, verification, evidence, and independent aesthetic/functional review.
---

# Formal Interior Design Iteration Skill

## Purpose and trigger conditions

This Skill applies to every interior-design scenario: furniture, loose styling, wall features, kitchens, bathrooms, ceilings/HVAC, lighting, doors/circulation, materials, and cross-discipline work. Its job is to **阻止 Agent 交付半成品、错位方案或未经确认的猜测**. “基本完成” is not a status and must never hide a blocking issue. This is a formal reusable protocol, not a description of a 半成品 workflow.

Trigger it before or during any request to add, move, rotate, scale, select, split, replace, delete, render, inspect, explain, or revise an object or relationship that can affect geometry, function, construction, maintenance, or aesthetics. Trigger it again when the user says a position, length, direction, relation, screenshot, or function is wrong.

If the user says “先讨论”/“discuss first”, do not edit files, configuration, code, or generated output. Discuss and align only.

## Non-negotiable gates

1. Facts precede proposals; explicit user decisions precede Agent preference. User observations have priority over Agent guesses, but must be verified against authority data, measurements, photos, runtime objects, or other evidence.
2. Any ambiguity that can change the result is a hard stop: **禁止猜测**. Do not guess dimensions, direction, coordinates, rotation, wall, material, object boundary, priority, or interface.
3. A missing answer, unresolved custom answer, or pending site condition keeps the work `blocked` or `incomplete`.
4. Passing schema, configuration, scripts, or tests does not prove geometry, function, aesthetics, construction, or delivery.
5. No generated file, temporary render, screenshot, or pixel impression may replace its declared source authority.
6. A reviewer conflict returns to user alignment; majority vote cannot resolve a design trade-off.
7. Work-area changes by another person must be attributed and impact-checked before continuing.

## State machine

```text
intake -> fact_investigation -> alignment_required -> decision_brief_frozen
       -> implementation -> verification -> evidence_review -> delivery_ready

any state -> blocked | incomplete
implementation/verification/evidence_review -> alignment_required
  (new critical unknown, conflict, scope change, or fact mismatch)
evidence_review -> implementation (only approved blocking changes within frozen scope)
evidence_review -> retrospective (trigger fires; stop tuning numbers)
retrospective -> alignment_required | decision_brief_frozen
```

Record the current state in the review manifest and work record. State gates:

- `intake`: capture user goal, subject, space, target views, scope, and expected deliverable. If object boundaries are unclear, do not implement.
- `fact_investigation`: read the project adapter first, then authorities, mirror fields, existing intent, MEP/construction constraints, existing objects, and verification/browser entry points. Fill `fact-table.yaml`.
- `alignment_required`: stop design edits. Use `AskUserQuestion` with 2–4 fact-based options, trade-offs, and “暂不决定”. Unanswered or still-ambiguous custom answers remain blocked.
- `decision_brief_frozen`: freeze `decision-brief.yaml` only after goal, priority, allowed/forbidden scope, open-question handling, and acceptance are confirmed. `frozen: true` is the implementation gate.
- `implementation`: write/update design datum and object manifest first; implement only inside allowed scope. A new critical unknown immediately returns to alignment.
- `verification`: run all checks relevant to the approved scope; classify configuration/schema, geometry/topology, consistency, furniture/MEP/collision, application/service, and type checks separately.
- `evidence_review`: obtain valid, version-bound agent-browser evidence for every required view, then run independent aesthetic and functional reviews.
- `delivery_ready`: allowed only when all completion conditions below hold; never use “基本完成” as a substitute.
- `blocked`: unresolved fact/question, failed check, invalid evidence, environment failure, or reviewer block. State the cause and recovery condition.
- `incomplete`: scope, implementation, object responsibility, evidence, or review does not cover acceptance.
- `retrospective`: stop numeric tuning, preserve failure evidence, re-check authority, and rebuild baselines.

## Executable protocol

### 1. Facts before design

Read the adapter before project files. Build `fact-table.yaml`; every entry is one of:

- `confirmed`: directly supported by authority config, measurement, photo, log, runtime query, or explicit user confirmation.
- `inferred`: derived from confirmed facts, with basis and confidence; never silently promote to confirmed.
- `user_decision`: explicit user goal, preference, priority, trade-off, exception, or accepted limitation.
- `site_pending`: requires site measurement or verification of material, structure, utilities, access, inspection, property, or construction conditions.

Record source refs, impact, affected views/objects, owner, verification method, and status. User statements such as “这里不对” or “长度仍然错” are evidence leads: verify them; do not reverse-engineer coordinates from screenshot pixels or intuition.

### 2. Ambiguity gate and mandatory AskUserQuestion

Stop and enter `alignment_required` if any of these is unclear: object/part boundary; wall material, structure, drillability, or wall side; plan/elevation/section axis, origin, direction, or viewing side; whether a dimension is overall/net/length/width/depth/height/along/clearance; position/length/orientation/rotation; functional priority; storage versus beauty; HVAC/electrical/plumbing interfaces; inspection, installation, maintenance, property, or construction conditions.

`AskUserQuestion` must state known facts and the unresolved variable, offer 2–4 options based on facts, describe benefit, cost, affected object/space, construction/maintenance consequence, and verification method, and include `暂不决定`. Do not use “通常”, “大概率”, or “最合理猜测”. If no answer arrives, or a custom answer is not verifiable, pause without editing.

### 3. Freeze the decision brief

Normalize the answer into `decision-brief.yaml`: `priority`, `frozen`, `allowed_scope`, `forbidden`, `open_questions`, `acceptance`, and `alignment`. Record alignment ID, original answer, normalized decision, affected refs, timestamp, and pending site items. Any scope, priority, or acceptance change unfreezes the brief and requires alignment again.

### 4. Establish a design datum

Before geometry edits, fill `design-datum.yaml`. Choose only a declared anchor: `free_position`, `room_anchor`, `wall_anchor`, `ceiling_anchor`, or `service_route`. For each target object explicitly define `plan`, `elevation`, and `section`: axes, origin, direction/viewing side, units, position, dimensions and semantics. `along` is not height; plan coordinates are not elevation height; never guess x/z/rotation to select a wall. Every datum references facts and decisions.

### 5. Split auditable objects

Fill `object-manifest.yaml` before implementation. Split by independent function, owner, material, collision, maintenance, interface, and review responsibility. A furniture object must not absorb HVAC, lighting, structural, or inspection responsibility. Independent objects still require shared visual datum, spacing, stacking/support, concealment, and hierarchy so the result is not a visual scatter board. Record dependencies, interfaces, maintenance boundaries, collision policy, parts, visual relationships, and validation refs.

### 6. Implementation order

1. Confirm authority and mirror rules.
2. Update facts, alignment, and frozen brief.
3. Establish datums and object manifest.
4. Implement upstream space, wall, service, and circulation constraints.
5. Implement object geometry and materials.
6. Implement relationships, collision, MEP, inspection, and maintenance.
7. Modify only approved source files; never generated files.
8. Run verification and record results.

### 7. Verification

Run adapter commands relevant to scope, and record command, version/time, result, and output ref. Separate data/config, geometry/topology, mirror consistency, furniture/MEP/collision, application/service, and type checks. A green command is only one evidence layer; geometry, function, aesthetics, construction, and evidence still require review. Any failure or static/runtime mismatch blocks delivery.

### 8. agent-browser evidence

Use exactly `$HOME/.local/bin/agent-browser`, one stable exclusive session per Agent, and serial `open -> wait --load networkidle -> ready poll -> runtime queries -> snapshot -> screenshot -> validate -> close`. Every target view must record URL, title, real `window.__APP__.isReady()` result, empty config-error banner, target stable objectIds and runtime query, non-overview camera, snapshot, and readable non-empty PNG bound to the same source version. Empty, overview, loading, wrong-version, bannered, missing-object, or otherwise invalid screenshots are diagnostic only and cannot be sent for review or used to finish.

### 9. Independent double review

The aesthetic reviewer checks proportion, scale, hierarchy, material/color/texture, sightlines, composition, light/shadow, and visual cohesion. The functional reviewer checks clearances, opening/flow, collision, ergonomics, maintenance/inspection, MEP, construction, durability, and user goals. Each emits the fixed JSON contract in `references/review-contracts.md`. Any `FAIL` or `BLOCKED` prevents `delivery_ready`; fix only recorded approved blocking issues. Conflict returns to user alignment.

### 10. Retrospective gate

Trigger retrospective for two consecutive same-kind FAILs, a repeated issue, fact/runtime/screenshot mismatch, semantic drift, invalid evidence, scope breach, reviewer conflict, or external workspace change. Stop adjusting x/z/rotation, length, height, or camera. Preserve evidence, re-check authority, rebuild fact table/design datum/object manifest, ask the user again where needed, unfreeze/re-freeze the brief, and rerun affected checks. See `references/retrospective-triggers.md`.

## Stop, blocked, and completion rules

Must remain `blocked`/`incomplete` for any unresolved critical fact/question, guessed dimension/direction/coordinate/rotation/object boundary/material/priority, unfrozen brief, unclear responsibility, furniture/HVAC/structure mixing, failed validation, non-empty error banner, false business ready, missing target object, overview camera, invalid PNG/snapshot, reviewer `FAIL`/`BLOCKED`, unresolved conflict, incomplete retrospective, or unowned workspace change.

Enter `delivery_ready` only when:

1. All five templates are filled and version-linked.
2. All result-affecting ambiguity was resolved via `AskUserQuestion`; brief and datums are frozen.
3. Only approved source files changed; generated files were not edited directly.
4. Applicable verification commands pass and agree with runtime.
5. Every required view has valid, same-version browser evidence.
6. Both reviewers return fixed-contract `PASS`, with no blocking issues.
7. Retrospective checks are clear or fully recorded and rebaselined.
8. Delivery notes list scope, evidence, non-blocking notes, and site-pending follow-up without hiding issues as “基本完成”.

## Scope and git prohibition

Work only within explicit approved scope. Do not expand scope for non-blocking notes. Do not modify generated files, fabricate/reuse invalid evidence, or treat temporary output as source. Do not execute any git operation, including `commit`, `push`, `reset`, `rebase`, `checkout`, `clean`, or other git-state mutation. This Skill itself creates no complex automation scripts. Read the project adapter first; adapter rules supplement but cannot weaken these alignment, no-guessing, evidence, and delivery gates.

References: [alignment protocol](references/alignment-protocol.md), [scene archetypes](references/scene-archetypes.md), [browser evidence](references/browser-evidence.md), [review contracts](references/review-contracts.md), [retrospective triggers](references/retrospective-triggers.md).
