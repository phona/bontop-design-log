"""curtain_projection 单测：命名契约解析、.NNN 后缀剥离与 duplicate 判定、
validate 的 missing/unexpected/unknown/duplicate。纯 Python，可直接 pytest。"""
import hashlib
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from curtain_projection import (  # noqa: E402
    curtain_projection_from_facts,
    parse_curtain_node_name,
    validate_curtain_nodes,
)


def _projection(curtain_id='curtain_living_south', expected=None, state='privacy'):
    projection = {
        'source': {'default': state, 'roomOverrides': {}},
        'effectiveByRoom': {'living_dining': state},
        'curtains': [{
            'id': curtain_id,
            'roomId': 'living_dining',
            'kind': 'sheer_blackout',
            'state': state,
            'expectedVisibleNodes': expected if expected is not None else [
                f'{curtain_id}:sheer:deployed',
                f'{curtain_id}:blackout:gathered:left',
                f'{curtain_id}:blackout:gathered:right',
            ],
        }],
    }
    canonical = json.dumps(projection, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    projection['snapshotSha256'] = hashlib.sha256(canonical.encode('utf-8')).hexdigest()
    return projection


# ---- parse_curtain_node_name：全 layer/variant/segment 组合 ----

def test_parse_deployed_all_layers():
    for layer in ('sheer', 'blackout', 'blinds'):
        p = parse_curtain_node_name(f'curtain_x:{layer}:deployed')
        assert p == {'curtainId': 'curtain_x', 'layer': layer, 'variant': 'deployed',
                     'segment': None, 'canonical': f'curtain_x:{layer}:deployed', 'renamed': False}


def test_parse_gathered_segments():
    p = parse_curtain_node_name('curtain_x:sheer:gathered:left')
    assert p['segment'] == 'left' and p['variant'] == 'gathered'
    p = parse_curtain_node_name('curtain_x:blackout:gathered:right')
    assert p['segment'] == 'right'
    # blinds:gathered 无 segment
    p = parse_curtain_node_name('curtain_x:blinds:gathered')
    assert p['variant'] == 'gathered' and p['segment'] is None


def test_parse_strips_blender_duplicate_suffix():
    p = parse_curtain_node_name('curtain_x:sheer:deployed.001')
    assert p is not None
    assert p['canonical'] == 'curtain_x:sheer:deployed'
    assert p['renamed'] is True


def test_parse_rejects_invalid_names():
    assert parse_curtain_node_name('curtain_x:sheer') is None            # 段数不足
    assert parse_curtain_node_name('curtain_x:velvet:deployed') is None  # 未知 layer
    assert parse_curtain_node_name('curtain_x:sheer:half') is None       # 未知 variant
    assert parse_curtain_node_name('curtain_x:sheer:gathered:middle') is None  # 未知 segment
    assert parse_curtain_node_name('curtain_x:sheer:deployed:left') is None    # deployed 不允许 segment
    assert parse_curtain_node_name('curtain_x:sheer:deployed:extra:more') is None
    assert parse_curtain_node_name(':sheer:deployed') is None            # 空 curtainId
    assert parse_curtain_node_name('floor:living_dining') is None        # 非窗帘节点
    assert parse_curtain_node_name('west_curtain') is None


# ---- validate_curtain_nodes ----

def test_validate_exact_match_passes():
    proj = _projection()
    names = [o for c in proj['curtains'] for o in c['expectedVisibleNodes']] + ['floor:living_dining', 'wall:seg:1']
    assert validate_curtain_nodes(names, proj) == []


def test_validate_missing():
    proj = _projection()
    errors = validate_curtain_nodes(['curtain_living_south:sheer:deployed'], proj)
    assert any(e.startswith('missing:') and 'blackout:gathered:left' in e for e in errors)
    assert any(e.startswith('missing:') and 'blackout:gathered:right' in e for e in errors)


def test_validate_unexpected():
    proj = _projection()
    names = _projection()['curtains'][0]['expectedVisibleNodes'] + ['curtain_living_south:blackout:deployed']
    errors = validate_curtain_nodes(names, proj)
    assert any(e.startswith('unexpected:') and 'blackout:deployed' in e for e in errors)


def test_validate_open_state_expects_no_nodes():
    proj = _projection(expected=[], state='open')
    assert validate_curtain_nodes([], proj) == []
    errors = validate_curtain_nodes(['curtain_living_south:sheer:deployed'], proj)
    assert any(e.startswith('unexpected:') for e in errors)


def test_validate_unknown_curtain_id():
    proj = _projection()
    errors = validate_curtain_nodes(['curtain_mystery:sheer:deployed'], proj)
    assert any(e.startswith('unknown:') and 'curtain_mystery' in e for e in errors)


def test_validate_malformed_layer_name_is_unknown():
    proj = _projection()
    # 第二段是窗帘 layer 但不符合契约（deployed 带 segment）
    errors = validate_curtain_nodes(['curtain_living_south:sheer:deployed:left'], proj)
    assert any(e.startswith('unknown:') and 'malformed' in e for e in errors)
    # 第二段非窗帘 layer 的节点不参与窗帘校验
    assert validate_curtain_nodes(['wall:seg:3:room=kitchen', 'asset:rug:living'], proj) == [
        e for e in validate_curtain_nodes([], proj)]


def test_validate_duplicate_via_rename_suffix_fails():
    proj = _projection(expected=['curtain_living_south:sheer:deployed'])
    # 剥 .NNN 后才匹配 canonical → duplicate（新 bundle 不允许依赖自动重名）
    errors = validate_curtain_nodes(['curtain_living_south:sheer:deployed.001'], proj)
    assert any(e.startswith('duplicate:') for e in errors)


def test_validate_duplicate_same_canonical_twice_fails():
    proj = _projection(expected=['curtain_living_south:sheer:deployed'])
    errors = validate_curtain_nodes(
        ['curtain_living_south:sheer:deployed', 'curtain_living_south:sheer:deployed.001'], proj)
    assert any(e.startswith('duplicate:') for e in errors)


# ---- curtain_projection_from_facts：legacy facts 明确报错 ----

def test_facts_missing_curtains_raises():
    with pytest.raises(RuntimeError, match='presentation.curtains'):
        curtain_projection_from_facts({})
    with pytest.raises(RuntimeError, match='presentation.curtains'):
        curtain_projection_from_facts({'presentation': {}})


def test_facts_ok():
    proj = _projection()
    assert curtain_projection_from_facts({'presentation': {'curtains': proj}}) is proj


if __name__ == '__main__':
    sys.exit(pytest.main([__file__, '-q']))
