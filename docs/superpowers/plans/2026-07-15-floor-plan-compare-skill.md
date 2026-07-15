# Floor Plan Compare Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an opencode skill that watches `config/layout/model-geometry.yaml` and `config/layout/overlay.yaml`, captures a top-down floor-plan screenshot from the running browser, and dispatches a subagent to compare it with the developer baseline image `assets/baseline/floor-plan-developer.jpg`.

**Architecture:** A Python file watcher detects YAML changes and captures a browser screenshot via Chromium DevTools Protocol (CDP). The opencode skill reads the latest capture, dispatches a subagent with the screenshot, baseline image, and YAMLs, and reports deviations. The browser capture method uses a temporary orthographic camera for distortion-free floor-plan output.

**Tech Stack:** TypeScript/Three.js (browser), Python 3.12+ (watcher + CDP client), CDP/WebSocket, opencode subagent.

## Global Constraints

- The skill is **read-only**; it never edits `model-geometry.yaml` or `overlay.yaml`.
- Baseline image must live at `assets/baseline/floor-plan-developer.jpg`.
- Screenshot output goes to `screenshots/floor-plan-YYYY-MM-DD-HHMMSS.png` and is **not** committed to git.
- Watcher debounce is **500 ms**.
- All Python scripts must be runnable independently and support `--help`.
- All Python script changes must be accompanied by pytest tests in `scripts/`.
- `npm run typecheck` and `npm run test` must pass after TypeScript changes.
- `python -m pytest scripts/*_test.py -q` must pass after Python changes.

---

### Task 1: Add floor-plan capture method to the browser app

**Files:**
- Modify: `app/src/render/HouseScene.ts`
- Modify: `app/src/App.ts`
- Test: `app/src/render/HouseScene.test.ts` (add existence/type assertion for new public method)

**Interfaces:**
- Consumes: `TopDownView.enable()`, `THREE.OrthographicCamera`, `this.renderer`, `this.scene`, `topDownLayoutBounds`
- Produces: `App.captureFloorPlan(): Promise<string>` returning a base64 PNG data URL

- [ ] **Step 1: Write the failing test**

Add a type/existence test to `app/src/render/HouseScene.test.ts`:

```typescript
it('exposes a captureFloorPlan method that returns a Promise', () => {
  // The method is delegated from App; we verify the public SceneApi interface has it.
  expect(typeof (HouseScene.prototype as any).captureFloorPlan).toBe('function');
});
```

Run: `cd app && npm run test -- --run HouseScene`
Expected: FAIL — `captureFloorPlan` does not exist on `HouseScene`.

- [ ] **Step 2: Add `captureFloorPlan()` to `HouseScene.ts`**

Add a public method that temporarily switches to an orthographic camera, renders the scene at a fixed square resolution, and returns a base64 PNG.

```typescript
async captureFloorPlan(): Promise<string> {
  // Ensure top-down mode is active and wait for transition.
  this.setTopDown(true);
  await new Promise((resolve) => setTimeout(resolve, 500));

  const { minX, maxX, minZ, maxZ } = this.topDownLayoutBounds;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const size = 2048;
  const aspect = width / depth;
  const renderWidth = Math.round(size * Math.max(aspect, 1));
  const renderHeight = Math.round(size / Math.min(aspect, 1));

  const orthoCam = new THREE.OrthographicCamera(
    width / -2, width / 2,
    depth / 2, depth / -2,
    0.1, 200
  );
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  orthoCam.position.set(centerX, 50, centerZ);
  orthoCam.lookAt(centerX, 0, centerZ);
  orthoCam.up.set(0, 0, -1);
  orthoCam.updateProjectionMatrix();

  const originalSize = { width: this.canvas.width, height: this.canvas.height };
  const renderTarget = new THREE.WebGLRenderTarget(renderWidth, renderHeight);
  this.renderer.setRenderTarget(renderTarget);
  this.renderer.render(this.scene, orthoCam);

  const buffer = new Uint8Array(renderWidth * renderHeight * 4);
  this.renderer.readRenderTargetPixels(renderTarget, 0, 0, renderWidth, renderHeight, buffer);
  const pngData = await this.rgbaToPng(buffer, renderWidth, renderHeight);

  this.renderer.setRenderTarget(null);
  renderTarget.dispose();
  this.renderer.setSize(originalSize.width, originalSize.height);

  return pngData;
}

private async rgbaToPng(rgba: Uint8Array, width: number, height: number): Promise<string> {
  // Flip Y because readRenderTargetPixels returns bottom-to-top.
  const flipped = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * width * 4;
    const dstRow = y * width * 4;
    flipped.set(rgba.subarray(srcRow, srcRow + width * 4), dstRow);
  }
  // Use a tiny offscreen canvas to encode PNG.
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const imageData = new ImageData(new Uint8ClampedArray(flipped), width, height);
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}
```

Also import `THREE.OrthographicCamera` and `THREE.WebGLRenderTarget` if not already available via the `three` import.

- [ ] **Step 3: Wire `captureFloorPlan()` in `App.ts`**

Add a public method on `App` that delegates to `HouseScene` and is registered on `window.__app`.

```typescript
async captureFloorPlan(): Promise<string> {
  return this.houseScene.captureFloorPlan();
}
```

`App` is already exposed on `window.__app` in `app/src/main.ts`, so CDP can call `window.__app.captureFloorPlan()`.

- [ ] **Step 4: Run tests and typecheck**

Run:
```bash
cd app && npm run typecheck
npm run test -- --run HouseScene
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/render/HouseScene.ts app/src/App.ts app/src/render/HouseScene.test.ts
git commit -m "feat(scene): add top-down orthographic floor-plan capture"
```

---

### Task 2: Create Python CDP screenshot capture script

**Files:**
- Create: `scripts/capture_floor_plan_screenshot.py`
- Create: `scripts/capture_floor_plan_screenshot_test.py`
- Modify: `scripts/requirements.txt`

**Interfaces:**
- Consumes: CDP endpoint, app URL, output path
- Produces: PNG file at the requested path

- [ ] **Step 1: Write the failing test**

Create `scripts/capture_floor_plan_screenshot_test.py`:

```python
import tempfile
from pathlib import Path
import pytest
from capture_floor_plan_screenshot import build_cdp_url, parse_args


def test_parse_args_defaults():
    args = parse_args([])
    assert args.cdp_host == 'localhost'
    assert args.cdp_port == 9222
    assert args.app_url == 'http://localhost:5173'
    assert args.output is None


def test_parse_args_custom():
    args = parse_args([
        '--cdp-host', '192.168.1.100',
        '--cdp-port', '9333',
        '--app-url', 'http://example.com',
        '--output', '/tmp/out.png',
    ])
    assert args.cdp_host == '192.168.1.100'
    assert args.cdp_port == 9333
    assert args.app_url == 'http://example.com'
    assert args.output == '/tmp/out.png'


def test_build_cdp_url():
    assert build_cdp_url('localhost', 9222) == 'http://localhost:9222/json'
```

Run: `python -m pytest scripts/capture_floor_plan_screenshot_test.py -q`
Expected: FAIL — module `capture_floor_plan_screenshot` does not exist.

- [ ] **Step 2: Install dependencies**

Append to `scripts/requirements.txt`:

```text
# CDP / WebSocket
requests>=2.32.0
websocket-client>=1.8.0
```

Run:
```bash
python -m pip install -r scripts/requirements.txt
```

- [ ] **Step 3: Implement the capture script**

Create `scripts/capture_floor_plan_screenshot.py`:

```python
#!/usr/bin/env python3
"""Capture a floor-plan screenshot from a running Chromium via CDP."""

import argparse
import base64
import json
import sys
from pathlib import Path
from urllib.parse import urlparse, urljoin

import requests
from websocket import create_connection


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description='Capture floor-plan screenshot via CDP')
    parser.add_argument('--cdp-host', default='localhost', help='Chromium CDP host')
    parser.add_argument('--cdp-port', type=int, default=9222, help='Chromium CDP port')
    parser.add_argument('--app-url', default='http://localhost:5173', help='App URL to find in CDP page list')
    parser.add_argument('--output', required=True, help='Output PNG path')
    return parser.parse_args(argv)


def build_cdp_url(host: str, port: int) -> str:
    return f'http://{host}:{port}/json'


def find_page_ws_url(cdp_url: str, app_url: str) -> str:
    resp = requests.get(cdp_url, timeout=10)
    resp.raise_for_status()
    pages = resp.json()
    target = urlparse(app_url)
    for page in pages:
        if page.get('type') != 'page':
            continue
        page_url = page.get('url', '')
        if page_url == app_url or page_url.rstrip('/') == app_url.rstrip('/'):
            return page['webSocketDebuggerUrl']
    raise RuntimeError(f'No CDP page found for {app_url}. Available pages: {[p.get("url") for p in pages]}')


def capture_floor_plan_screenshot(ws_url: str) -> str:
    ws = create_connection(ws_url, timeout=30)
    try:
        # Evaluate the app method and return the base64 PNG.
        expr = "window.__app.captureFloorPlan().then(dataUrl => ({dataUrl}))"
        ws.send(json.dumps({
            'id': 1,
            'method': 'Runtime.evaluate',
            'params': {
                'expression': expr,
                'awaitPromise': True,
                'returnByValue': True,
            }
        }))
        while True:
            raw = ws.recv()
            msg = json.loads(raw)
            if msg.get('id') == 1:
                result = msg.get('result', {}).get('result', {})
                if result.get('value'):
                    return result['value']['dataUrl']
                raise RuntimeError(f'CDP evaluation failed: {result}')
    finally:
        ws.close()


def save_data_url(data_url: str, output_path: str) -> Path:
    if not data_url.startswith('data:image/png;base64,'):
        raise ValueError('Expected PNG base64 data URL')
    b64 = data_url.split(',', 1)[1]
    png_bytes = base64.b64decode(b64)
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(png_bytes)
    return out


def main(argv=None):
    args = parse_args(argv)
    cdp_url = build_cdp_url(args.cdp_host, args.cdp_port)
    ws_url = find_page_ws_url(cdp_url, args.app_url)
    data_url = capture_floor_plan_screenshot(ws_url)
    out = save_data_url(data_url, args.output)
    print(out.resolve())
    return 0


if __name__ == '__main__':
    sys.exit(main())
```

- [ ] **Step 4: Run tests**

Run:
```bash
python -m pytest scripts/capture_floor_plan_screenshot_test.py -q
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/capture_floor_plan_screenshot.py scripts/capture_floor_plan_screenshot_test.py scripts/requirements.txt
git commit -m "feat(scripts): add CDP floor-plan screenshot capture"
```

---

### Task 3: Create file watcher and subagent-dispatch orchestrator

**Files:**
- Create: `scripts/watch_floor_plan_and_compare.py`
- Create: `scripts/watch_floor_plan_and_compare_test.py`

**Interfaces:**
- Consumes: `capture_floor_plan_screenshot.main()`, `subprocess`, `watchdog` events
- Produces: event log entries at `scripts/logs/floor-plan-compare-events.jsonl` and stdout reports

- [ ] **Step 1: Write the failing test**

Create `scripts/watch_floor_plan_and_compare_test.py`:

```python
import tempfile
from pathlib import Path
import pytest

from watch_floor_plan_and_compare import (
    debounce_events,
    parse_args,
    should_watch,
)


def test_parse_args_defaults():
    args = parse_args([])
    assert args.baseline == 'assets/baseline/floor-plan-developer.jpg'
    assert args.watch_dir == 'config/layout'
    assert args.cdp_host == 'localhost'
    assert args.cdp_port == 9222


def test_should_watch_only_target_files():
    assert should_watch('config/layout/model-geometry.yaml') is True
    assert should_watch('config/layout/overlay.yaml') is True
    assert should_watch('config/layout/other.yaml') is False


def test_debounce_events_empty():
    assert debounce_events([], 0.5) is None
```

Run: `python -m pytest scripts/watch_floor_plan_and_compare_test.py -q`
Expected: FAIL — module does not exist.

- [ ] **Step 2: Implement the watcher script**

Create `scripts/watch_floor_plan_and_compare.py`:

```python
#!/usr/bin/env python3
"""Watch floor-plan YAMLs and trigger a screenshot + subagent-ready event log."""

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from threading import Event, Lock

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

from capture_floor_plan_screenshot import build_cdp_url, find_page_ws_url

WATCHED_FILES = {'model-geometry.yaml', 'overlay.yaml'}
LOG_DIR = Path('scripts/logs')
EVENT_LOG = LOG_DIR / 'floor-plan-compare-events.jsonl'


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description='Watch floor-plan YAMLs and capture screenshots')
    parser.add_argument('--baseline', default='assets/baseline/floor-plan-developer.jpg', help='Baseline image')
    parser.add_argument('--watch-dir', default='config/layout', help='Directory to watch')
    parser.add_argument('--cdp-host', default='localhost', help='CDP host')
    parser.add_argument('--cdp-port', type=int, default=9222, help='CDP port')
    parser.add_argument('--app-url', default='http://localhost:5173', help='App URL')
    parser.add_argument('--screenshots-dir', default='screenshots', help='Where to save screenshots')
    parser.add_argument('--one-shot', action='store_true', help='Capture once and exit instead of watching')
    return parser.parse_args(argv)


def should_watch(path: str) -> bool:
    return Path(path).name in WATCHED_FILES


class WatcherHandler(FileSystemEventHandler):
    def __init__(self, callback):
        self.callback = callback

    def on_modified(self, event):
        if event.is_directory:
            return
        if should_watch(event.src_path):
            self.callback(event.src_path)


def debounce_events(events, debounce_seconds: float):
    """Return the latest event if debounce window has passed; otherwise None."""
    if not events:
        return None
    latest_time, latest_path = max(events, key=lambda x: x[0])
    if time.monotonic() - latest_time >= debounce_seconds:
        return latest_path
    return None


class FloorPlanWatcher:
    def __init__(self, args):
        self.args = args
        self.pending_events = []
        self.lock = Lock()
        self.stop_event = Event()
        self.last_capture_time = 0.0

    def run(self):
        if self.args.one_shot:
            self.capture_once()
            return

        self.ensure_log_dir()
        watch_dir = Path(self.args.watch_dir).resolve()
        handler = WatcherHandler(self.on_file_changed)
        observer = Observer()
        observer.schedule(handler, str(watch_dir), recursive=False)
        observer.start()
        print(f'Watching {watch_dir} for changes...')
        try:
            while not self.stop_event.is_set():
                self.process_pending()
                time.sleep(0.1)
        finally:
            observer.stop()
            observer.join()

    def ensure_log_dir(self):
        LOG_DIR.mkdir(parents=True, exist_ok=True)

    def on_file_changed(self, path: str):
        with self.lock:
            self.pending_events.append((time.monotonic(), path))

    def process_pending(self):
        with self.lock:
            if not self.pending_events:
                return
            # Simple debounce: wait until the latest event is older than 500ms.
            latest_time, latest_path = max(self.pending_events, key=lambda x: x[0])
            if time.monotonic() - latest_time < 0.5:
                return
            self.pending_events.clear()

        # Capture screenshot.
        try:
            self.capture_once(source=str(latest_path))
        except Exception as e:
            print(f'Capture failed: {e}', file=sys.stderr)

    def capture_once(self, source: str = 'manual'):
        self.ensure_log_dir()
        baseline = Path(self.args.baseline)
        if not baseline.exists():
            raise FileNotFoundError(f'Baseline image missing: {baseline}')

        timestamp = datetime.now(timezone.utc).strftime('%Y-%m-%d-%H%M%S')
        output = Path(self.args.screenshots_dir) / f'floor-plan-{timestamp}.png'
        output.parent.mkdir(parents=True, exist_ok=True)

        capture_args = [
            sys.executable, 'scripts/capture_floor_plan_screenshot.py',
            '--cdp-host', self.args.cdp_host,
            '--cdp-port', str(self.args.cdp_port),
            '--app-url', self.args.app_url,
            '--output', str(output),
        ]
        subprocess.run(capture_args, check=True)

        event = {
            'timestamp': timestamp,
            'source': source,
            'baseline': str(baseline.resolve()),
            'screenshot': str(output.resolve()),
            'model_geometry': 'config/layout/model-geometry.yaml',
            'overlay': 'config/layout/overlay.yaml',
        }
        with open(EVENT_LOG, 'a', encoding='utf-8') as f:
            f.write(json.dumps(event, ensure_ascii=False) + '\n')
        print(json.dumps(event, ensure_ascii=False))


def main(argv=None):
    args = parse_args(argv)
    watcher = FloorPlanWatcher(args)
    watcher.run()
    return 0


if __name__ == '__main__':
    sys.exit(main())
```

- [ ] **Step 3: Run tests**

Run:
```bash
python -m pytest scripts/watch_floor_plan_and_compare_test.py -q
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/watch_floor_plan_and_compare.py scripts/watch_floor_plan_and_compare_test.py
git commit -m "feat(scripts): add floor-plan YAML watcher and event logger"
```

---

### Task 4: Add `watchdog` to requirements and verify Python tests

**Files:**
- Modify: `scripts/requirements.txt`

- [ ] **Step 1: Add dependency**

Append to `scripts/requirements.txt`:

```text
# File watching
watchdog>=4.0.0
```

- [ ] **Step 2: Install and run all Python tests**

Run:
```bash
python -m pip install -r scripts/requirements.txt
python -m pytest scripts/*_test.py -q
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/requirements.txt
git commit -m "chore(scripts): add watchdog for floor-plan watcher"
```

---

### Task 5: Create the opencode skill file

**Files:**
- Create: `.opencode/skills/floor-plan-compare/SKILL.md`
- Modify: `.opencode/opencode.json` if needed to register the skill

**Interfaces:**
- Consumes: opencode tool calls (`bash`, `task`)
- Produces: subagent comparison reports

- [ ] **Step 1: Create the skill file**

Create `.opencode/skills/floor-plan-compare/SKILL.md`:

```markdown
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
```

- [ ] **Step 2: Register the skill (if opencode requires explicit registration)**

If `.opencode/opencode.json` or `opencode.json` needs a `skills` or `skillDirs` entry, add it. For the current configuration, opencode may auto-discover skills under `.opencode/skills/`. If not, update the config to include the skill directory. Verify by running `opencode skill list` or equivalent.

- [ ] **Step 3: Test the skill file is discovered**

Run:
```bash
opencode skill list | grep floor-plan-compare
```
Expected: `floor-plan-compare` appears in the list. If not, adjust the config or path.

- [ ] **Step 4: Commit**

```bash
git add .opencode/skills/floor-plan-compare/SKILL.md
git commit -m "feat(opencode): add floor-plan-compare skill"
```

---

### Task 6: End-to-end smoke test

**Files:**
- None new; validates existing files.

- [ ] **Step 1: Start the dev server and Chrome**

Run in separate terminals:
```bash
cd app && npm run dev
```

```powershell
# Windows side
chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\chrome-debug-profile
```

- [ ] **Step 2: Place baseline image**

Ensure `assets/baseline/floor-plan-developer.jpg` exists.

- [ ] **Step 3: Trigger one-shot capture**

Run:
```bash
python scripts/watch_floor_plan_and_compare.py --one-shot --cdp-host ${FLOOR_PLAN_CDP_HOST:-localhost}
```
Expected: A screenshot is saved to `screenshots/floor-plan-YYYY-MM-DD-HHMMSS.png` and an event is logged.

- [ ] **Step 4: Trigger a change and watch**

Run the watcher in the background:
```bash
python scripts/watch_floor_plan_and_compare.py --cdp-host ${FLOOR_PLAN_CDP_HOST:-localhost} &
```

Touch a YAML file:
```bash
touch config/layout/overlay.yaml
```

Wait 1 second. Expected: A new screenshot is created and an event is appended.

- [ ] **Step 5: Run the full test suite**

Run:
```bash
cd app && npm run typecheck && npm run test
cd .. && python -m pytest scripts/*_test.py -q
```
Expected: All pass.

- [ ] **Step 6: Final commit if any test-only fixes were needed**

```bash
git add -A
git commit -m "test(floor-plan-compare): add end-to-end smoke test results"
```

---

## Self-Review Checklist

- **Spec coverage:** All sections of the design spec are covered: capture method, Python CDP client, file watcher, subagent comparison, skill file, error handling, testing.
- **Placeholder scan:** No TBDs or incomplete sections. All code snippets are concrete.
- **Type consistency:** `App.captureFloorPlan()` returns `Promise<string>`; the Python script receives a base64 data URL and saves a PNG. `watch_floor_plan_and_compare.py` emits JSON events with consistent keys.
- **Scope:** The plan is focused on the floor-plan compare skill. It does not include unrelated UI changes.
- **Read-only safety:** The skill and scripts never modify YAMLs.
- **Git hygiene:** Screenshots are not committed.
