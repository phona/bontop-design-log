import os
import sys
import time
from pathlib import Path
from unittest.mock import patch

import pytest

from watch_floor_plan_and_compare import (
    FloorPlanWatcher,
    parse_args,
    should_watch,
)


def test_parse_args_defaults():
    args = parse_args([])
    assert args.baseline == 'assets/baseline/floor-plan-developer.jpg'
    assert args.watch_dir == 'config/layout'
    assert args.cdp_host == 'localhost'
    assert args.cdp_port == 9222
    assert args.log is None


def test_parse_args_log():
    args = parse_args(['--log', 'custom.jsonl'])
    assert args.log == 'custom.jsonl'


def test_should_watch_only_target_files():
    assert should_watch('config/layout/model-geometry.yaml') is True
    assert should_watch('config/layout/overlay.yaml') is True
    assert should_watch('config/layout/other.yaml') is False


class FakeArgs:
    def __init__(self, force=False):
        self.force = force


def _patch_pid_paths(tmp_path, monkeypatch):
    pid_file = tmp_path / 'watcher.pid'
    monkeypatch.setattr('watch_floor_plan_and_compare.LOG_DIR', tmp_path)
    monkeypatch.setattr('watch_floor_plan_and_compare.PID_FILE', pid_file)
    return pid_file


def test_acquire_pid_with_stale_file(tmp_path, monkeypatch):
    pid_file = _patch_pid_paths(tmp_path, monkeypatch)
    watcher = FloorPlanWatcher(FakeArgs(force=False))
    watcher._is_pid_alive = lambda pid: False
    pid_file.write_text('99999')

    watcher.acquire_pid()

    assert pid_file.read_text().strip() == str(os.getpid())
    assert watcher._pid_acquired is True


def test_acquire_pid_with_running_watcher_exits(tmp_path, monkeypatch):
    pid_file = _patch_pid_paths(tmp_path, monkeypatch)
    watcher = FloorPlanWatcher(FakeArgs(force=False))
    watcher._is_pid_alive = lambda pid: True
    pid_file.write_text('12345')

    with pytest.raises(SystemExit) as exc_info:
        watcher.acquire_pid()

    assert exc_info.value.code == 1
    assert pid_file.read_text().strip() == '12345'


def test_acquire_pid_with_running_watcher_and_force(tmp_path, monkeypatch):
    pid_file = _patch_pid_paths(tmp_path, monkeypatch)
    watcher = FloorPlanWatcher(FakeArgs(force=True))
    watcher._is_pid_alive = lambda pid: True
    pid_file.write_text('12345')

    watcher.acquire_pid()

    assert pid_file.read_text().strip() == str(os.getpid())


def test_release_pid_only_removes_owned_file(tmp_path, monkeypatch):
    pid_file = _patch_pid_paths(tmp_path, monkeypatch)
    watcher = FloorPlanWatcher(FakeArgs())
    watcher.acquire_pid()
    assert pid_file.exists()

    # Simulate another process wrote a different PID
    pid_file.write_text('99999')
    watcher.release_pid()

    # It should not remove the file because it no longer owns it
    assert pid_file.exists()
    assert pid_file.read_text().strip() == '99999'


def test_release_pid_removes_owned_file(tmp_path, monkeypatch):
    pid_file = _patch_pid_paths(tmp_path, monkeypatch)
    watcher = FloorPlanWatcher(FakeArgs())
    watcher.acquire_pid()

    watcher.release_pid()

    assert not pid_file.exists()
    assert watcher._pid_acquired is False


def test_process_pending_debounce():
    args = parse_args(['--one-shot'])
    watcher = FloorPlanWatcher(args)
    captured = []

    def fake_capture(source):
        captured.append(source)

    watcher.capture_once = fake_capture

    watcher.on_file_changed('config/layout/model-geometry.yaml')
    watcher.process_pending()
    assert len(captured) == 0

    time.sleep(0.6)
    watcher.process_pending()
    assert len(captured) == 1
    assert captured[0] == 'config/layout/model-geometry.yaml'

    # Subsequent calls should have no pending events
    watcher.process_pending()
    assert len(captured) == 1


def test_process_pending_uses_latest_event():
    args = parse_args(['--one-shot'])
    watcher = FloorPlanWatcher(args)
    captured = []

    def fake_capture(source):
        captured.append(source)

    watcher.capture_once = fake_capture

    watcher.on_file_changed('config/layout/model-geometry.yaml')
    time.sleep(0.1)
    watcher.on_file_changed('config/layout/overlay.yaml')
    time.sleep(0.5)
    watcher.process_pending()

    assert len(captured) == 1
    assert captured[0] == 'config/layout/overlay.yaml'
