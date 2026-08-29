import json
import tempfile
import time
from pathlib import Path
import pytest
import requests
from capture_floor_plan_screenshot import (
    _send_and_wait,
    _wait_for_app_ready,
    _wait_for_load_event,
    build_cdp_url,
    find_page_ws_url,
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


def test_find_page_ws_url_raises_chinese_on_cdp_unreachable(monkeypatch):
    def mock_get(*args, **kwargs):
        raise requests.ConnectionError('Connection refused')
    monkeypatch.setattr(requests, 'get', mock_get)
    with pytest.raises(RuntimeError, match='无法连接 CDP'):
        find_page_ws_url('http://localhost:9222/json', 'http://localhost:5173')


def test_find_page_ws_url_raises_chinese_on_page_not_found(monkeypatch):
    class MockResp:
        def json(self):
            return [{'type': 'page', 'url': 'http://other/'}]
        def raise_for_status(self):
            pass
    monkeypatch.setattr(requests, 'get', lambda *a, **k: MockResp())
    with pytest.raises(RuntimeError, match='未在 CDP 页面列表中找到'):
        find_page_ws_url('http://localhost:9222/json', 'http://localhost:5173')


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


def test_wait_for_load_event_raises_on_reload_error():
    ws = FakeWs([
        {'id': 2, 'error': {'code': -32000, 'message': 'Cannot navigate to invalid URL'}},
    ])
    with pytest.raises(RuntimeError, match='CDP Page.reload 失败'):
        _wait_for_load_event(ws, 2, timeout=0.5)


def test_wait_for_load_event_raises_on_cdp_error():
    ws = FakeWs([
        {'id': 2, 'result': {}},
        {'error': {'code': -32000, 'message': 'Something went wrong'}},
    ])
    with pytest.raises(RuntimeError, match='CDP 发生错误'):
        _wait_for_load_event(ws, 2, timeout=0.5)


def test_wait_for_load_event_timeout_message_is_chinese(monkeypatch):
    ws = FakeWs([])
    counter = [0.0]
    def fake_monotonic():
        counter[0] += 1.0
        return counter[0]
    monkeypatch.setattr(time, 'monotonic', fake_monotonic)
    with pytest.raises(TimeoutError, match='等待页面加载超时'):
        _wait_for_load_event(ws, 2, timeout=0.01)


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
    with pytest.raises(TimeoutError, match=r'window\.__APP_READY__|window\.__APP__\.captureFloorPlan'):
        _wait_for_app_ready(ws, timeout=0.01)


def test_save_data_url_error_message_is_chinese():
    with pytest.raises(ValueError, match='应为 PNG base64 data URL'):
        save_data_url('data:image/jpeg;base64,xxx', '/tmp/out.png')


def test_save_data_url():
    data_url = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    with tempfile.TemporaryDirectory() as tmpdir:
        path = Path(tmpdir) / 'out.png'
        result = save_data_url(data_url, str(path))
        assert result == path
        assert path.exists()
        assert path.read_bytes()[:8] == b'\x89PNG\r\n\x1a\n'
