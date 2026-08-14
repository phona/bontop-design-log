"""从 materials.yaml 的 appearance 字段生成 Blender 程序化材质（不下载贴图）。

主题映射（scheme selections -> classify() 的 key）：
  floor/paint/wall/curtain/... → floor/wall/ceiling/curtain_fabric/furniture/...
classify() 见 dress_scene.py。
注意：bpy 仅在构建函数内延迟导入，纯逻辑函数（resolve_scheme）可脱离 Blender 单测。
"""
import os


def resolve_scheme(scheme: dict, mats: dict) -> dict[str, str]:
    """把 current-scheme.json 的 selections 映射为 classify key -> material_id。
    仅保留在材质库中存在的条目；无 coverage 的主题不产出。"""
    sel = scheme.get('selections', {})
    alias = {
        'floor': 'floor',
        'paint': 'wall',
        'wall': 'wall',
        'curtain': 'curtain_fabric',
        'cabinet': 'furniture',
        'sofa': 'furniture',
        'bed': 'furniture',
        'dining_table': 'furniture',
        'dining_chair': 'furniture',
        'tv_stand': 'furniture',
        'desk': 'furniture',
        'chair': 'furniture',
        'bookshelf': 'furniture',
        'shoe_cabinet': 'furniture',
        'coffee_table': 'furniture',
        'wardrobe': 'furniture',
    }
    resolved: dict[str, str] = {}
    for topic, v in sel.items():
        mid = v.get('default') if isinstance(v, dict) else v
        if not isinstance(mid, str) or mid not in mats:
            continue
        key = alias.get(topic)
        if key is None:
            continue
        resolved[key] = mid
    return resolved


def build_yaml_materials(mats: dict, resolved: dict, helpers: dict) -> dict:
    """resolved: classify_key -> material_id。返回 classify_key -> bpy material。
    helpers 注入 new_principled/hex_rgb，避免与 dress_scene 循环依赖。"""
    import bpy
    out: dict = {}
    np_ = helpers['new_principled']
    hex_rgb = helpers['hex_rgb']
    for key, mid in resolved.items():
        rec = mats[mid]
        app = rec.get('appearance', {})
        typ = app.get('type', 'solid_color')
        color = hex_rgb(app.get('color', '#bfbfbf'))
        finish = app.get('finish', 'soft')
        rough = {'glossy': 0.15, 'soft': 0.35, 'matte': 0.6}.get(finish, 0.4)
        if key in ('wall', 'ceiling'):
            rough = 0.9
        if typ == 'solid_color':
            mat = np_(f'方案_{mid}', color, rough=rough)
        elif typ == 'wood_plank':
            mat = np_(f'方案_{mid}', color, rough=rough, coat=0.15)
        elif typ == 'ceramic_tile_v2':
            mat = np_(f'方案_{mid}', color, rough=0.2 if finish != 'matte' else 0.5, coat=0.3)
        else:
            mat = np_(f'方案_{mid}', color, rough=rough)
        out[key] = mat
    return out


def load_scheme_materials(engine: str, mats: dict, new_principled, hex_rgb,
                          config_dir: str | None = None) -> dict:
    """从 config/materials.yaml + data/current-scheme.json 生成材质并覆盖同名 key。
    engine 保留供未来贴图/程序化纹理分引擎使用。
    config_dir: 项目根目录（含 config/ 与 data/），缺省回退到脚本上级三级。"""
    import json
    import yaml as pyyaml

    if config_dir is None:
        config_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    mats_path = os.path.join(config_dir, 'config', 'materials.yaml')
    scheme_path = os.path.join(config_dir, 'data', 'current-scheme.json')
    with open(mats_path, 'r', encoding='utf-8') as f:
        mats_yaml = {m['id']: m for m in pyyaml.safe_load(f)['materials']}
    if os.path.exists(scheme_path):
        with open(scheme_path, 'r', encoding='utf-8') as f:
            scheme = json.load(f)
    else:
        scheme = {}
    resolved = resolve_scheme(scheme, mats_yaml)
    helpers = {'new_principled': new_principled, 'hex_rgb': hex_rgb}
    yaml_mats = build_yaml_materials(mats_yaml, resolved, helpers)
    mats.update(yaml_mats)
    return mats
