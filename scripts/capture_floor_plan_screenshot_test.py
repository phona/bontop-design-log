import tempfile
from pathlib import Path
import pytest
from capture_floor_plan_screenshot import build_cdp_url, parse_args, save_data_url


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


def test_save_data_url_writes_png():
    data_url = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    with tempfile.TemporaryDirectory() as tmpdir:
        path = Path(tmpdir) / 'out.png'
        result = save_data_url(data_url, str(path))
        assert result == path
        assert path.exists()
        assert path.read_bytes()[:8] == b'\x89PNG\r\n\x1a\n'
