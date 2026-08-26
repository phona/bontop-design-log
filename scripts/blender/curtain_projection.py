"""GLB 窗帘节点命名契约的解析与校验（纯 Python，不 import bpy，可脱离 Blender 单测）。

命名契约（GLB 导出即此格式，active-only，只含可见节点）：
  <curtainId>:<layer>:<variant>[:segment]
  layer   ∈ {sheer, blackout, blinds}
  variant ∈ {deployed, gathered}
  segment ∈ {left, right}（仅 gathered 允许；blinds:gathered 无 segment）

可见性由导出快照决定，Blender 端不做任何按状态的显隐推断；本模块只做解析与
与 presentation.curtains 投影（expectedVisibleNodes）的一致性校验。
"""
import hashlib
import json
import re

CURTAIN_LAYERS = ('sheer', 'blackout', 'blinds')
CURTAIN_VARIANTS = ('deployed', 'gathered')
CURTAIN_SEGMENTS = ('left', 'right')

# Blender 导入重名自动加 .NNN 后缀；解析时剥离以便识别
_DUP_SUFFIX_RE = re.compile(r'\.\d{3}$')


def strip_blender_duplicate_suffix(name: str) -> tuple[str, bool]:
    """剥离 Blender 自动重名 .NNN 后缀，返回 (原名, 是否剥离过)。"""
    stripped = _DUP_SUFFIX_RE.sub('', name)
    return stripped, stripped != name


def parse_curtain_node_name(name: str) -> dict | None:
    """严格按 <id>:<layer>:<variant>[:segment] 解析；不合法返回 None。

    返回 {'curtainId', 'layer', 'variant', 'segment', 'canonical', 'renamed'}：
    canonical = 剥离 .NNN 后缀后的契约名；renamed = 是否剥过后缀。
    """
    if not isinstance(name, str):
        return None
    base, renamed = strip_blender_duplicate_suffix(name)
    parts = base.split(':')
    if len(parts) == 3:
        curtain_id, layer, variant = parts
        segment = None
    elif len(parts) == 4:
        curtain_id, layer, variant, segment = parts
    else:
        return None
    if not curtain_id:
        return None
    if layer not in CURTAIN_LAYERS or variant not in CURTAIN_VARIANTS:
        return None
    if segment is not None and segment not in CURTAIN_SEGMENTS:
        return None
    # sheer/blackout gathered 必须有唯一 left/right；blinds gathered 不分段。
    if segment is not None and variant != 'gathered':
        return None
    if variant == 'gathered' and layer != 'blinds' and segment is None:
        return None
    if layer == 'blinds' and segment is not None:
        return None
    return {
        'curtainId': curtain_id,
        'layer': layer,
        'variant': variant,
        'segment': segment,
        'canonical': base,
        'renamed': renamed,
    }


def _derived_nodes(item: dict) -> list[str]:
    curtain_id, kind, state = item.get('id'), item.get('kind'), item.get('state')
    if state == 'open':
        return []
    if kind == 'blinds':
        return [f'{curtain_id}:blinds:deployed']
    if state == 'privacy':
        return [f'{curtain_id}:sheer:deployed', f'{curtain_id}:blackout:gathered:left', f'{curtain_id}:blackout:gathered:right']
    return [f'{curtain_id}:sheer:deployed', f'{curtain_id}:blackout:deployed']


def _projection_errors(projection: dict) -> list[str]:
    errors = []
    expected_ids = []
    for item in projection.get('curtains', []):
        derived = _derived_nodes(item)
        declared = item.get('expectedVisibleNodes')
        if declared != derived:
            errors.append(f'projection: expectedVisibleNodes drift for {item.get("id")!r}')
        expected_ids.extend(declared or [])
    semantic = {
        'source': {
            'default': projection.get('source', {}).get('default'),
            'roomOverrides': projection.get('source', {}).get('roomOverrides', {}),
        },
        'effectiveByRoom': projection.get('effectiveByRoom', {}),
        'curtains': projection.get('curtains', []),
    }
    canonical = json.dumps(semantic, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    actual_hash = hashlib.sha256(canonical.encode('utf-8')).hexdigest()
    if actual_hash != projection.get('snapshotSha256'):
        errors.append('projection: snapshotSha256 does not match semantic content')
    if len(expected_ids) != len(set(expected_ids)):
        errors.append('projection: duplicate expected curtain node id')
    return errors


def _expected_node_ids(projection: dict) -> set[str]:
    return {node for item in projection.get('curtains', []) for node in item.get('expectedVisibleNodes', []) or []}


def validate_curtain_nodes(node_names, projection: dict) -> list[str]:
    """把导入场景的窗帘节点名与 presentation.curtains 投影比对。

    node_names: 场景中全部对象名（迭代器/list）。
    projection: facts.presentation.curtains（CurtainRenderProjection）。
    返回错误列表（空 = 通过）；错误类别：
      missing    投影期望可见但 GLB 没有
      unexpected GLB 有但投影未期望（含未知 curtainId 的窗帘形节点、投影外节点）
      duplicate  剥离 .NNN 重名后缀后才匹配（新 bundle 不允许依赖自动重名）
    """
    known_ids = {c.get('id') for c in projection.get('curtains', []) if isinstance(c.get('id'), str)}
    expected = _expected_node_ids(projection)

    errors: list[str] = _projection_errors(projection)
    seen: dict[str, str] = {}  # canonical → 首个实际对象名
    actual: set[str] = set()
    for name in node_names:
        if not isinstance(name, str) or ':' not in name:
            continue
        parsed = parse_curtain_node_name(name)
        if parsed is None:
            # 含 ':' 且第二段是窗帘 layer 但不符合契约 → unknown（如层名拼错/段数错）
            parts = name.split(':')
            if len(parts) >= 2 and parts[1] in CURTAIN_LAYERS:
                errors.append(f'unknown: malformed curtain node {name!r}')
            continue
        if parsed['curtainId'] not in known_ids:
            errors.append(f'unknown: curtain node {name!r} has unknown curtain id {parsed["curtainId"]!r}')
            continue
        canonical = parsed['canonical']
        first = seen.get(canonical)
        if first is not None:
            errors.append(f'duplicate: {name!r} duplicates {first!r} (canonical {canonical!r})')
            continue
        if parsed['renamed']:
            errors.append(f'duplicate: {name!r} relies on Blender auto-rename (.NNN suffix) for canonical {canonical!r}')
            continue
        seen[canonical] = name
        actual.add(canonical)

    for node in sorted(expected - actual):
        errors.append(f'missing: expected visible curtain node {node!r} not found in GLB')
    for node in sorted(actual - expected):
        errors.append(f'unexpected: curtain node {node!r} present in GLB but not expected by projection')
    return errors


def curtain_projection_from_facts(facts: dict) -> dict:
    """从 render-config 的 facts 取 presentation.curtains 投影；缺失（legacy facts）即报错。"""
    presentation = facts.get('presentation') if isinstance(facts, dict) else None
    curtains = presentation.get('curtains') if isinstance(presentation, dict) else None
    if not isinstance(curtains, dict) or not isinstance(curtains.get('curtains'), list):
        raise RuntimeError(
            'BLOCKED: render-config facts missing presentation.curtains '
            '(legacy facts v1); 重新生成 project-render-facts.json / render-config.json'
        )
    return curtains
