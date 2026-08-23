import base64
import json
import tempfile
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import pytest

MODULE_PATH = Path(__file__).with_name('export-web-glb.py')
SPEC = spec_from_file_location('export_web_glb', MODULE_PATH)
assert SPEC and SPEC.loader
export_web_glb = module_from_spec(SPEC)
SPEC.loader.exec_module(export_web_glb)


class FakeWs:
    def __init__(self, responses):
        self.responses = list(responses)
        self.sent = []
        self.closed = False

    def send(self, payload):
        self.sent.append(json.loads(payload))

    def recv(self):
        return json.dumps(self.responses.pop(0))

    def close(self):
        self.closed = True


def test_parse_args_defaults_and_required_output():
    args = export_web_glb.parse_args(['--output', 'out.glb'])
    assert args.output == 'out.glb'
    assert args.cdp_host == 'localhost'
    assert args.cdp_port == 9222
    assert args.app_url == 'http://localhost:5173'
    assert args.timeout_seconds == 120
    with pytest.raises(SystemExit):
        export_web_glb.parse_args([])


def test_decode_glb_data_url_is_strict():
    encoded = base64.b64encode(b'glTF').decode('ascii')
    assert export_web_glb.decode_glb_data_url(f'{export_web_glb.DATA_URL_PREFIX}{encoded}') == b'glTF'
    with pytest.raises(ValueError, match='GLB data URL'):
        export_web_glb.decode_glb_data_url('data:image/png;base64,AAAA')
    with pytest.raises(ValueError, match='base64 无效'):
        export_web_glb.decode_glb_data_url(f'{export_web_glb.DATA_URL_PREFIX}not-base64!')
    with pytest.raises(ValueError, match='为空'):
        export_web_glb.decode_glb_data_url(export_web_glb.DATA_URL_PREFIX)


def test_save_glb_data_url_creates_parent_and_writes_bytes():
    data_url = export_web_glb.DATA_URL_PREFIX + base64.b64encode(b'glTF-data').decode('ascii')
    with tempfile.TemporaryDirectory() as temp_dir:
        output = Path(temp_dir) / 'nested' / 'scene.glb'
        assert export_web_glb.save_glb_data_url(data_url, str(output)) == output
        assert output.read_bytes() == b'glTF-data'


def test_wait_for_exporter_ready_checks_export_glb_function(monkeypatch):
    fake = FakeWs([
        {'id': 1, 'result': {'result': {'value': False}}},
        {'id': 2, 'result': {'result': {'value': True}}},
    ])
    ids = iter([1, 2])
    monkeypatch.setattr(export_web_glb, '_next_check_id', lambda: next(ids))
    export_web_glb.wait_for_exporter_ready(fake, 1)
    expression = fake.sent[0]['params']['expression']
    assert 'exportGlbDataUrl' in expression
    assert 'traverse' in expression
    assert 'objectId' in expression
    assert 'floor' in expression
    assert 'children?.length' not in expression


def test_export_web_glb_waits_for_load_before_export(monkeypatch):
    fake = FakeWs([
        {'id': 1, 'result': {}},
        {'id': 2, 'result': {}},
        {'method': 'Page.loadEventFired'},
        {'id': 3, 'result': {'result': {'value': True}}},
        {'id': 4, 'result': {'result': {'value': {'dataUrl': 'data:model/gltf-binary;base64,Z2xURg=='}}}},
    ])
    ids = iter([1, 2, 3, 4])
    monkeypatch.setattr(export_web_glb, 'create_connection', lambda *_args, **_kwargs: fake)
    monkeypatch.setattr(export_web_glb, '_next_check_id', lambda: next(ids))

    assert export_web_glb.export_web_glb('ws://test', 1) == 'data:model/gltf-binary;base64,Z2xURg=='
    assert [payload['method'] for payload in fake.sent] == [
        'Page.enable', 'Page.reload', 'Runtime.evaluate', 'Runtime.evaluate',
    ]
    assert fake.closed


def test_result_value_reports_javascript_exception():
    with pytest.raises(RuntimeError, match='JavaScript 执行失败'):
        export_web_glb._result_value({'result': {'exceptionDetails': {'text': 'bad'}}})


def test_main_rejects_non_positive_timeout(capsys):
    assert export_web_glb.main(['--output', 'out.glb', '--timeout-seconds', '0']) == 2
    assert '--timeout-seconds 必须大于 0' in capsys.readouterr().err
