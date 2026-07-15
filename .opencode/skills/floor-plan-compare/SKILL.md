---
name: floor-plan-compare
description: Use when config/layout/model-geometry.yaml or config/layout/overlay.yaml changes, or when comparing a captured floor-plan screenshot to the developer baseline.
---

# Skill: floor-plan-compare

**Description:** Watch `config/layout/model-geometry.yaml` and `config/layout/overlay.yaml`, capture a top-down floor-plan screenshot from the running browser, and dispatch a subagent to compare it with the developer baseline image.

**Trigger:** File watcher detects changes to the two YAML files (or user explicitly invokes this skill).

**Prerequisites:**
- `assets/baseline/floor-plan-developer.jpg` must exist.
- `cd app && npm run dev` must be running.
- Windows Chrome must be running with `--remote-debugging-port=9222`.
- `FLOOR_PLAN_CDP_HOST` environment variable should point to the Windows host if running from WSL.

## Workflow

1. Ensure the watcher is running:
   ```bash
   python scripts/watch_floor_plan_and_compare.py --cdp-host ${FLOOR_PLAN_CDP_HOST:-localhost}
   ```
   Run it in the background if needed. If it is already running, skip this step.

2. When a YAML change occurs, the watcher captures a screenshot to `screenshots/floor-plan-YYYY-MM-DD-HHMMSS.png` and appends an event to `scripts/logs/floor-plan-compare-events.jsonl`.

3. Read the latest event from `scripts/logs/floor-plan-compare-events.jsonl`:
   ```bash
   tail -n 1 scripts/logs/floor-plan-compare-events.jsonl
   ```

4. Dispatch a subagent with the following files:
   - The current screenshot (`screenshots/floor-plan-*.png`)
   - The baseline image (`assets/baseline/floor-plan-developer.jpg`)
   - `config/layout/model-geometry.yaml` (for dimension checks)
   - `config/layout/overlay.yaml` (for intent checks)

5. Instruct the subagent to:
   - Compare the screenshot with the baseline visually.
   - Focus on room count, positions, exterior silhouette, entry garden protrusion, glass curtain wall, balconies.
   - Use the YAMLs only to quantify a visual discrepancy.
   - Ignore color, texture, furniture, and lighting differences.
   - Return a structured report with an overall verdict and sorted deviation list.
   - Do not modify any files.

6. Report the subagent's findings to the user. Do not make geometry changes unless the user explicitly asks.

## Safety rules

- This skill is read-only. Never edit `config/layout/model-geometry.yaml` or `config/layout/overlay.yaml`.
- Never commit screenshot files to git.
- If the baseline image is missing, stop and ask the user to place it at `assets/baseline/floor-plan-developer.jpg`.
- If CDP or the dev server is unreachable, report the exact error and stop.
