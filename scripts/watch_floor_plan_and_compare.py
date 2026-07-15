#!/usr/bin/env python3
"""Watch floor-plan YAMLs and trigger a screenshot + subagent-ready event log."""

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from threading import Event, Lock

import requests
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

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
    parser.add_argument('--log', default=None, help='Optional additional log file path')
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


class FloorPlanWatcher:
    def __init__(self, args):
        self.args = args
        self.pending_events = []
        self.lock = Lock()
        self.stop_event = Event()

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
            latest_time, latest_path = max(self.pending_events, key=lambda x: x[0])
            if time.monotonic() - latest_time < 0.5:
                return
            self.pending_events.clear()

        try:
            self.capture_once(source=str(latest_path))
        except Exception as e:
            print(f'捕获失败: {e}', file=sys.stderr)

    def verify_reachability(self):
        try:
            resp = requests.head(self.args.app_url, timeout=5, allow_redirects=True)
            if not resp.ok:
                raise RuntimeError(f'状态码 {resp.status_code}')
        except requests.RequestException as e:
            raise RuntimeError(f'请先在 app/ 运行 npm run dev: {e}')

        cdp_url = f'http://{self.args.cdp_host}:{self.args.cdp_port}/json'
        try:
            resp = requests.get(cdp_url, timeout=5)
            if not resp.ok:
                raise RuntimeError(f'状态码 {resp.status_code}')
        except requests.RequestException as e:
            raise RuntimeError(
                f'无法连接 Windows Chrome 调试端口，请确认已启动 --remote-debugging-port=9222: {e}'
            )

    def capture_once(self, source: str = 'manual'):
        self.ensure_log_dir()
        baseline = Path(self.args.baseline)
        if not baseline.exists():
            raise FileNotFoundError(f'缺少基线图，请放置 {baseline}')

        self.verify_reachability()

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
        if self.args.log:
            log_path = Path(self.args.log)
            log_path.parent.mkdir(parents=True, exist_ok=True)
            with open(log_path, 'a', encoding='utf-8') as f:
                f.write(json.dumps(event, ensure_ascii=False) + '\n')
        print(json.dumps(event, ensure_ascii=False))


def main(argv=None):
    args = parse_args(argv)
    watcher = FloorPlanWatcher(args)
    watcher.run()
    return 0


if __name__ == '__main__':
    sys.exit(main())
