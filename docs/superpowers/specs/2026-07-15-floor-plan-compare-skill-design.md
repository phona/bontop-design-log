# Floor Plan Compare Skill Design

**Date:** 2026-07-15  
**Status:** Design approved, awaiting spec review  
**Scope:** A reusable opencode skill that automatically watches `model-geometry.yaml` / `overlay.yaml` and triggers a visual comparison between the live browser floor-plan view and a developer-provided baseline image.

## 1. Purpose

When iterating on a 3D floor-plan layout, geometry changes should be validated quickly against the intended developer rendering. This skill automates that check:

- Detect changes to `config/layout/model-geometry.yaml` or `config/layout/overlay.yaml`.
- Capture a top-down, orthographic floor-plan screenshot from the running browser view.
- Compare the screenshot with a fixed baseline image.
- Report deviations and an accept/reject verdict.
- The skill is **read-only** — it never edits geometry files or overlay files.

## 2. Trigger

Automatic file watch:

- Watched files: `config/layout/model-geometry.yaml`, `config/layout/overlay.yaml`.
- Debounce: 500 ms after the last write before triggering.
- The watcher runs as a persistent background process while the user is iterating.
- Manual trigger is not required; the user simply edits YAMLs and the skill reacts.

## 3. Baseline Reference

- **File:** `assets/baseline/floor-plan-developer.jpg`
- This is the developer-provided floor-plan rendering. The user places it once and treats it as the fixed baseline.
- Differences caused by rendering style, color, material, or decorative furniture are ignored; only geometric layout matters.

## 4. Files and Scripts

| Path | Purpose |
|------|---------|
| `assets/baseline/floor-plan-developer.jpg` | Baseline floor-plan image (user-provided, not tracked by git unless requested). |
| `scripts/capture_floor_plan_screenshot.py` | Python helper that connects to Windows Chromium CDP and calls `window.__app.captureFloorPlan()`. |
| `scripts/watch_floor_plan_and_compare.py` | File watcher that monitors the two YAMLs, debounces, verifies reachability, and orchestrates capture + event logging. |
| `screenshots/floor-plan-YYYY-MM-DD-HHMMSS.png` | Timestamped output of each capture. |
| `docs/superpowers/specs/2026-07-15-floor-plan-compare-skill-design.md` | This design document. |

### 4.1 `capture_floor_plan_screenshot.py`

Responsibilities:

1. Connect to the CDP endpoint at `http://<windows-ip>:9222/json`.
2. Find the page whose URL is `http://localhost:5173` and retrieve its `webSocketDebuggerUrl`.
3. Open a WebSocket to that page.
4. Send `Page.reload` and wait for the page load to complete, then wait for `window.__app.captureFloorPlan` to be available.
5. Evaluate `window.__app.captureFloorPlan()`.
6. Receive the returned PNG data URL, save it to `--output`, and return the absolute path of the written PNG.

Inputs:

- `--cdp-host` (default: `localhost` when running Chrome on the same machine; otherwise the Windows host IP reachable from WSL, often set via the `FLOOR_PLAN_CDP_HOST` environment variable)
- `--cdp-port` (default: `9222`)
- `--app-url` (default: `http://localhost:5173`)
- `--output` (PNG path)

Outputs:

- Absolute path to the saved PNG on success.
- Non-zero exit code and stderr message on failure.

### 4.2 `watch_floor_plan_and_compare.py`

Responsibilities:

1. Watch `config/layout/model-geometry.yaml` and `config/layout/overlay.yaml`.
2. Debounce writes by 500 ms.
3. Verify the baseline image exists.
4. Verify the dev server is reachable (HTTP HEAD on `http://localhost:5173`) and the CDP endpoint is reachable (GET on `http://<cdp-host>:9222/json`).
5. Call `capture_floor_plan_screenshot.py` to produce `screenshots/floor-plan-YYYY-MM-DD-HHMMSS.png`.
6. Append the event to `scripts/logs/floor-plan-compare-events.jsonl` and, if `--log` is provided, to the optional log file.
7. The skill reads the event log and dispatches a subagent with the current screenshot, baseline image, and optionally the YAMLs.

Inputs:

- `--cdp-host`, `--cdp-port`, `--app-url` (passed through to capture script; `FLOOR_PLAN_CDP_HOST` env variable is the preferred way to set the host from WSL)
- `--baseline` (default: `assets/baseline/floor-plan-developer.jpg`)
- `--watch-dir` (default: `config/layout`)
- `--log` (optional log file path)

## 5. Browser Capture Mode

The frontend must expose a `captureFloorPlan()` method on the global app object. The method creates an independent orthographic camera and render target, so it does not need to enter the top-down view mode or wait for camera transitions:

- Camera: directly above the unit, looking down (negative Y axis).
- Projection: orthographic so walls are parallel and dimensions are preserved.
- Hidden elements: roof, ceiling, furniture, decorative objects.
- Visible elements: exterior walls, interior walls, doors, windows, curtain walls, room labels if present.
- North is at the top of the image, matching the baseline.
- Output: PNG with a fixed size large enough for comparison (e.g., 1920 x 1920).

This method is added to `app/src/main.ts` or `app/src/App.ts` and registered on `(window as any).__app` alongside the existing `captureOrthographic()`.

## 6. Subagent Comparison

The skill reads the latest event from `scripts/logs/floor-plan-compare-events.jsonl` and dispatches a general-purpose subagent with this context:

- **Current screenshot:** `screenshots/floor-plan-YYYY-MM-DD-HHMMSS.png`
- **Baseline image:** `assets/baseline/floor-plan-developer.jpg`
- **Geometry source:** `config/layout/model-geometry.yaml` (read-only for detail checks)
- **Overlay source:** `config/layout/overlay.yaml` (read-only for detail checks)

Skill prompt instructs it to:

1. Compare the two images visually.
2. Focus on: room count, room positions, exterior silhouette, entry garden protrusion, glass curtain wall, balcony placement.
3. If a visual discrepancy is found, optionally read the YAMLs to quantify the exact dimension or room name.
4. Ignore differences in color, texture, furniture, and lighting.
5. Do not modify any files.
6. Return a structured report:

```markdown
### 1. Overall verdict
[一致 / 基本一致 / 不一致]

### 2. Deviations (sorted by severity)
| # | Area | Severity | Observation | Quantified value (if available) |

### 3. Acceptable? 可接受 / 不可接受

### 4. Reason summary
```

## 7. Error Handling

| Scenario | Behavior |
|----------|----------|
| Baseline image missing | Stop and print: "缺少基线图，请放置 assets/baseline/floor-plan-developer.jpg" |
| Dev server not running | Print: "请先在 app/ 运行 npm run dev" |
| CDP unreachable on port 9222 | Print: "无法连接 Windows Chrome 调试端口，请确认已启动 --remote-debugging-port=9222" |
| Capture script fails | Stop, do not dispatch subagent, print the script error |
| Subagent fails | Print failure reason; watcher continues monitoring |
| Skill's own outputs touch YAMLs | Not applicable; the skill never writes YAMLs |

## 8. Workflow Summary

```
User edits model-geometry.yaml or overlay.yaml
            ↓
watch_floor_plan_and_compare.py detects change (debounced)
            ↓
Verify baseline image + dev server + CDP
            ↓
capture_floor_plan_screenshot.py reloads the app page and waits for it to be ready
            ↓
capture_floor_plan_screenshot.py calls `window.__app.captureFloorPlan()` → screenshots/floor-plan-*.png
            ↓
Event appended to scripts/logs/floor-plan-compare-events.jsonl
            ↓
floor-plan-compare skill reads the event and dispatches a subagent
            ↓
Subagent compares screenshot + baseline + YAMLs
            ↓
Report printed to stdout / log file
            ↓
User decides next edit
```

## 9. Testing

- **Script test:** Run `capture_floor_plan_screenshot.py` manually and confirm a PNG is produced.
- **Watcher test:** Touch a YAML file and confirm exactly one comparison event is appended within 1 second.
- **Subagent test:** Use a deliberately wrong layout and confirm the subagent reports the deviation.
- **Baseline-missing test:** Rename the baseline image, trigger a change, and confirm the Chinese error message.
- **Reachability test:** Stop the dev server or CDP and confirm the watcher prints the corresponding Chinese error without launching the capture script.

## 10. Open Questions

None at design time. All decisions were confirmed with the user.

## 11. Decisions

| Topic | Decision |
|-------|----------|
| Trigger | File watcher with 500 ms debounce |
| Baseline | `assets/baseline/floor-plan-developer.jpg` |
| Comparison | Primarily visual; YAMLs used only for quantifying discrepancies |
| Action | Read-only reporting; no automatic edits |
| Capture | New `captureFloorPlan()` method, top-down orthographic |
| Orchestration | Python CDP + WebSocket + subagent dispatch |
| Screenshot storage | `screenshots/floor-plan-YYYY-MM-DD-HHMMSS.png` (untracked) |
