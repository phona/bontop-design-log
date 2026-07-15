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
