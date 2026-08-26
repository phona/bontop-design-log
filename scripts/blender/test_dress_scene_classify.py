"""dress_scene.classify 墙段房间归属单测：wall:seg:N:room= 命中湿区 → wall_tile。
bpy 仅在函数体内使用，stub 顶层导入即可脱离 Blender 运行。"""
import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

bpy_stub = types.ModuleType('bpy')
bpy_stub.types = types.SimpleNamespace(Object=object)
sys.modules.setdefault('bpy', bpy_stub)

from dress_scene import classify, floor_room_id, plumbing_by_id, projection_facts  # noqa: E402


def _obj(name):
    return types.SimpleNamespace(name=name, parent=None)


def test_wet_room_wall_gets_tile():
    assert classify(_obj('wall:seg:3:room=kitchen|living_dining')) == 'wall_tile'
    assert classify(_obj('wall:seg:7:room=master_bath')) == 'wall_tile'
    assert classify(_obj('wall:seg:9:room=balcony')) == 'wall_tile'


def test_dry_room_wall_stays_paint():
    assert classify(_obj('wall:seg:1:room=living_dining|study')) == 'wall'
    assert classify(_obj('wall:seg:2')) == 'wall'  # 无归属（旧 GLB）


def test_blender_duplicate_suffix_tolerated():
    # Blender 重名自动加 .NNN：正则只吃到字母数字/_|，后缀不影响解析
    assert classify(_obj('wall:seg:3:room=guest_bath.001')) == 'wall_tile'


def test_other_wall_names_unchanged():
    assert classify(_obj('wall:living_dining:north')) == 'wall'
    assert classify(_obj('molding:living:d01')) == 'wall'


def test_curtain_nodes_classify_by_layer():
    # 契约 <id>:<layer>:<variant>[:segment]：sheer→纱材质，blackout/blinds→布料
    assert classify(_obj('curtain_living_south:sheer:deployed')) == 'sheer'
    assert classify(_obj('curtain_living_south:sheer:gathered:left')) == 'sheer'
    assert classify(_obj('curtain_living_south:blackout:deployed')) == 'curtain_fabric'
    assert classify(_obj('curtain_living_south:blackout:gathered:right')) == 'curtain_fabric'
    assert classify(_obj('curtain_mbath_corner:blinds:deployed')) == 'curtain_fabric'
    assert classify(_obj('curtain_mbath_corner:blinds:gathered')) == 'curtain_fabric'
    # Blender 重名 .NNN 后缀不影响分类
    assert classify(_obj('curtain_living_south:sheer:deployed.001')) == 'sheer'
    # 玻璃幕节点（无冒号、含 curtain 字样）不受影响
    assert classify(_obj('west_curtain')) == 'glass'
    assert classify(_obj('living_south_curtain')) == 'glass'


def test_floor_room_id_requires_stable_export_tag():
    assert floor_room_id('floor:master_bath') == 'master_bath'
    assert floor_room_id('floor:guest_bath.001') == 'guest_bath'
    assert floor_room_id('kitchen_floor') is None
    assert floor_room_id('floor:master_bath:fragment') is None


def test_projection_facts_and_plumbing_reject_missing_or_invalid_points():
    assert projection_facts({}) == {}
    facts = projection_facts({'facts': {'plumbing': [
        {'id': 'faucet_mbath_vanity', 'x': 2.6, 'z': 2.8},
        {'id': 'toilet_mbath', 'x': 'bad', 'z': 1.5},
    ]}})
    assert plumbing_by_id(facts) == {'faucet_mbath_vanity': {'id': 'faucet_mbath_vanity', 'x': 2.6, 'z': 2.8}}


if __name__ == '__main__':
    test_wet_room_wall_gets_tile()
    test_dry_room_wall_stays_paint()
    test_blender_duplicate_suffix_tolerated()
    test_other_wall_names_unchanged()
    test_floor_room_id_requires_stable_export_tag()
    test_projection_facts_and_plumbing_reject_missing_or_invalid_points()
    test_curtain_nodes_classify_by_layer()
    print('OK')
