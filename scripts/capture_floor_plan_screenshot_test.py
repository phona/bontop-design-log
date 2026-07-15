import json
import tempfile
from pathlib import Path
import pytest
from capture_floor_plan_screenshot import (
    _send_and_wait,
    _wait_for_app_ready,
    _wait_for_load_event,
    build_cdp_url,
    parse_args,
    save_data_url,
)


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


class FakeWs:
    def __init__(self, responses):
        self.responses = list(responses)
        self.sent = []

    def send(self, payload):
        self.sent.append(json.loads(payload))

    def recv(self):
        response = self.responses.pop(0)
        if 'id' not in response and 'result' in response and self.sent:
            response = {**response, 'id': self.sent[-1].get('id')}
        return json.dumps(response)


def test_send_and_wait_returns_matching_response():
    ws = FakeWs([{'id': 7, 'result': {'value': 'ok'}}])
    msg = _send_and_wait(ws, 7, {'method': 'Runtime.evaluate'})
    assert msg['result']['value'] == 'ok'
    assert ws.sent[0]['method'] == 'Runtime.evaluate'
    assert ws.sent[0]['id'] == 7


def test_send_and_wait_ignores_unrelated_messages():
    ws = FakeWs([
        {'method': 'Page.loadEventFired'},
        {'id': 7, 'result': {'value': 'ok'}},
    ])
    msg = _send_and_wait(ws, 7, {'method': 'Runtime.evaluate'})
    assert msg['result']['value'] == 'ok'


def test_wait_for_load_event_returns_on_load_event():
    ws = FakeWs([
        {'id': 2, 'result': {}},
        {'method': 'Page.loadEventFired'},
    ])
    _wait_for_load_event(ws, 2)


def test_wait_for_app_ready_succeeds_when_ready():
    ws = FakeWs([
        {'result': {'result': {'value': False}}},
        {'result': {'result': {'value': True}}},
    ])
    _wait_for_app_ready(ws, timeout=0.5)
    assert len(ws.sent) == 2


def test_wait_for_app_ready_raises_on_timeout():
    ws = FakeWs([
        {'result': {'result': {'value': False}}},
    ])
    with pytest.raises(TimeoutError):
        _wait_for_app_ready(ws, timeout=0.01)


def test_save_data_url():
    data_url = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    with tempfile.TemporaryDirectory() as tmpdir:
        path = Path(tmpdir) / 'out.png'
        result = save_data_url(data_url, str(path))
        assert result == path
        assert path.exists()
        assert path.read_bytes()[:8] == b'\x89PNG\r\n\x1a\n'
