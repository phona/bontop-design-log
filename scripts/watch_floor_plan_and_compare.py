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
