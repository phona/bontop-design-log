---
name: retrospective-triggers
description: Stop-tuning triggers and re-baselining protocol for repeated interior-design failures.
---

# Retrospective Triggers / 复盘触发器

## Trigger means stop tuning

On any trigger, preserve the current failure evidence and last change, set `retrospective` or `blocked`, and stop adjusting x/z/rotation, length, height, or camera. **Two consecutive same-kind FAILs always require stopping numeric tuning and retrospective.**

Required triggers include:

- plan/elevation/section axis, origin, viewing side, or north-direction confusion;
- `along`, wall distance, length, and height semantics mixed up;
- x/z/rotation guessed to choose a wall, especially without material or wall-side confirmation;
- old element/object type semantics contaminating a new requirement;
- one object mixing furniture with HVAC, lighting, structure, inspection, or another discipline;
- independent objects becoming a visual scatter board because shared datum, spacing, hierarchy, or relation is missing;
- low cabinet, PVC/backboard, floating panel, support, and front/back/up/down relationships wrong;
- user repeatedly says position, length, or direction is still wrong while Agent only changes numbers;
- overview, blank, loading, wrong-camera, wrong-version, or error-banner screenshot;
- screenshot cannot prove the target object or relation;
- aesthetic and functional reviewers conflict;
- scripts pass but the screenshot is visibly ugly, disproportionate, incoherent, or fails the aesthetic target;
- workspace contains another person’s or unowned change affecting the same source, scope, or acceptance;
- facts disagree with configuration, runtime objects, screenshots, or review records;
- type, dimension, coordinate, mirror field, owner, or responsibility boundary drifts;
- frozen scope is exceeded or `site_pending` is silently treated as confirmed;
- static verification and runtime disagree, or required evidence/checks are not reproducible.

## Required retrospective actions

1. Preserve screenshots, snapshots, runtime queries, review JSON, command output, source version, and last change; never overwrite old evidence.
2. Re-read the authority and mirror rules; re-check user observation, coordinates, dimensions, object types, material/wall side, and pending site facts.
3. Classify root cause as assumption, datum, object split, relationship, implementation, evidence, environment, or external-workspace error. Unconfirmed causes stay `inferred`.
4. Rebuild `fact-table.yaml`, `design-datum.yaml`, and `object-manifest.yaml`; do not “try one more number”.
5. If preference, priority, direction, wall material, function trade-off, or reviewer conflict is involved, call `AskUserQuestion` with 2–4 fact-based options and `暂不决定`.
6. Update and re-freeze the decision brief only after user confirmation.
7. Rerun affected validation and the full browser evidence lifecycle; old screenshots cannot cover the new version.

## Minimum retrospective record

Record `trigger_id`, trigger text, iteration/rerun number, failure evidence refs, last change, authority/fact check, root cause and confidence, new facts, user decision, rebuilt datum, rebuilt object manifest, validation results, remaining risks, workspace attribution, and whether recovery returned to `implementation`. Until complete, status is `blocked` or `incomplete`, never `delivery_ready`.
