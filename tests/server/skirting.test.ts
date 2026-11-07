import { parseOverlayFiles } from '../../server/overlay-merge.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { load } from 'js-yaml';
import { buildScene } from '../../shared/render/SceneBuilder.js';
import { parseOverlay, mergeSceneElements } from '../../server/overlay-merge.js';
import { resolveLayout } from '../../server/layout-resolver.js';
import { deriveSkirtingRegions } from '../../shared/skirting-derivation.js';

// 踢脚线常显条带（DEC-2026-10-28-R01/R02）。S5（2026-11-07）起 24 段声明已删，改由墙特征
// finish.paint_bands[] 派生。四道防线：
//  ① **逐段等价**（验收铁律）：派生结果与原 24 段声明逐字段相等——原声明冻结在下面
//     ORIGINAL_DECLARATIONS（删声明前的 finish-surfaces.yaml，锚点已解析为字面值）；
//  ② §6.1 配对方法固化：全部 paint × skirting 按 (wall, room, along[0], along[1]) 四元组
//     配对 24/24 命中，缺的 7 段正是两卫湿区（wet_room_ids 里的 guest_bath 5 + master_bath 2）；
//  ③ buildScene 真的建出常显（visible=true）网格，门洞处实扣断开，高度取自锚点而非代码默认；
//  ④ 选材方案里有 skirting 项且跟墙砖 default 相等；SCH-135-01 是放行卡点。

const MG: any = load(readFileSync('config/layout/model-geometry.yaml', 'utf8'));
const TILE: any = load(readFileSync('config/tile-comparison.yaml', 'utf8'));
const RESOLVED: any = resolveLayout(MG);
const parsed: any = parseOverlayFiles();
const skirt: any[] = (parsed.elements ?? []).filter((e: any) => e.type === 'skirting_region');
const wetRoomIds: string[] = TILE.wet_room_ids ?? [];

/** 冻结基线的一条原声明（reason 是散文，不参与逐字段比对，单独断言指向性）。 */
interface OriginalSkirtingDeclaration {
  id: string;
  type: 'skirting_region';
  wall: string;
  room: string;
  along: [number, number];
  bottom: number;
  height: number;
  color: string;
}

/**
 * 删声明前的 24 段原样冻结（S5 前 config/model/envelope/finish-surfaces.yaml，YAML 锚点
 * &skirting_height 0.08 / &skirting_color '#e5e2db' 已解析为字面值）。顺序按原声明序
 * （客餐厅之前曾手写排布），派生序是按墙归组——集合逐一对应，见下方断言。
 */
const ORIGINAL_DECLARATIONS: OriginalSkirtingDeclaration[] = [
  { id: 'skirt_bedroom_nw_w_balc_west', type: 'skirting_region', wall: 'w_balc_west', room: 'bedroom_nw', along: [0.10, 1.20], bottom: 0, height: 0.08, color: '#e5e2db' },
  { id: 'skirt_bedroom_nw_w_gbath_west', type: 'skirting_region', wall: 'w_gbath_west', room: 'bedroom_nw', along: [0.00, 1.35], bottom: 0, height: 0.08, color: '#e5e2db' },
  { id: 'skirt_bedroom_nw_w_gbath_west_open_vanity', type: 'skirting_region', wall: 'w_gbath_west_open_vanity', room: 'bedroom_nw', along: [0.00, 0.75], bottom: 0, height: 0.08, color: '#e5e2db' },
  { id: 'skirt_bedroom_nw_w_mbath_east', type: 'skirting_region', wall: 'w_mbath_east', room: 'bedroom_nw', along: [0.00, 3.20], bottom: 0, height: 0.08, color: '#e5e2db' },
  { id: 'skirt_bedroom_nw_w_nw_south', type: 'skirting_region', wall: 'w_nw_south', room: 'bedroom_nw', along: [0.00, 3.00], bottom: 0, height: 0.08, color: '#e5e2db' },
  { id: 'skirt_bedroom_se_w_be_north', type: 'skirting_region', wall: 'w_be_north', room: 'bedroom_se', along: [0.00, 3.00], bottom: 0, height: 0.08, color: '#e5e2db' },
  { id: 'skirt_bedroom_se_w_be_west', type: 'skirting_region', wall: 'w_be_west', room: 'bedroom_se', along: [0.00, 3.15], bottom: 0, height: 0.08, color: '#e5e2db' },
  { id: 'skirt_bedroom_se_w_east_upper', type: 'skirting_region', wall: 'w_east_upper', room: 'bedroom_se', along: [0.00, 3.15], bottom: 0, height: 0.08, color: '#e5e2db' },
  { id: 'skirt_living_dining_w_be_west', type: 'skirting_region', wall: 'w_be_west', room: 'living_dining', along: [0.00, 4.25], bottom: 0, height: 0.08, color: '#e5e2db' },
  { id: 'skirt_living_dining_w_ent_south_w', type: 'skirting_region', wall: 'w_ent_south_w', room: 'living_dining', along: [0.00, 1.97], bottom: 0, height: 0.08, color: '#e5e2db' },
  { id: 'skirt_living_dining_w_ent_west', type: 'skirting_region', wall: 'w_ent_west', room: 'living_dining', along: [0.00, 0.60], bottom: 0, height: 0.08, color: '#e5e2db' },
  { id: 'skirt_living_dining_w_cent_south', type: 'skirting_region', wall: 'w_cent_south', room: 'living_dining', along: [0.00, 1.82], bottom: 0, height: 0.08, color: '#e5e2db' },
  { id: 'skirt_living_dining_w_st_east', type: 'skirting_region', wall: 'w_st_east', room: 'living_dining', along: [0.00, 4.25], bottom: 0, height: 0.08, color: '#e5e2db' },
  { id: 'skirt_main_corridor_w_strip_east', type: 'skirting_region', wall: 'w_strip_east', room: 'main_corridor', along: [0.00, 1.25], bottom: 0, height: 0.08, color: '#e5e2db' },
  { id: 'skirt_main_corridor_w_st_north', type: 'skirting_region', wall: 'w_st_north', room: 'main_corridor', along: [0.00, 3.00], bottom: 0, height: 0.08, color: '#e5e2db' },
  { id: 'skirt_main_corridor_w_nw_south', type: 'skirting_region', wall: 'w_nw_south', room: 'main_corridor', along: [1.60, 3.00], bottom: 0, height: 0.08, color: '#e5e2db' },
  { id: 'skirt_master_bedroom_w_mb_east', type: 'skirting_region', wall: 'w_mb_east', room: 'master_bedroom', along: [0.00, 4.25], bottom: 0, height: 0.08, color: '#e5e2db' },
  { id: 'skirt_master_bedroom_w_mbath_east', type: 'skirting_region', wall: 'w_mbath_east', room: 'master_bedroom', along: [1.76, 3.20], bottom: 0, height: 0.08, color: '#e5e2db' },
  { id: 'skirt_master_bedroom_w_mbath_south', type: 'skirting_region', wall: 'w_mbath_south', room: 'master_bedroom', along: [0.00, 2.60], bottom: 0, height: 0.08, color: '#e5e2db' },
  { id: 'skirt_master_bedroom_w_nw_south', type: 'skirting_region', wall: 'w_nw_south', room: 'master_bedroom', along: [0.00, 1.60], bottom: 0, height: 0.08, color: '#e5e2db' },
  { id: 'skirt_master_bedroom_w_strip_east', type: 'skirting_region', wall: 'w_strip_east', room: 'master_bedroom', along: [0.00, 1.25], bottom: 0, height: 0.08, color: '#e5e2db' },
  { id: 'skirt_study_w_mb_east', type: 'skirting_region', wall: 'w_mb_east', room: 'study', along: [0.00, 4.25], bottom: 0, height: 0.08, color: '#e5e2db' },
  { id: 'skirt_study_w_st_east', type: 'skirting_region', wall: 'w_st_east', room: 'study', along: [0.00, 4.25], bottom: 0, height: 0.08, color: '#e5e2db' },
  { id: 'skirt_study_w_st_north', type: 'skirting_region', wall: 'w_st_north', room: 'study', along: [0.00, 3.00], bottom: 0, height: 0.08, color: '#e5e2db' },
];

function wallLength(wallId: string): number {
  const w: any = RESOLVED.walls.find((x: any) => x.id === wallId);
  assert.ok(w, `skirting 引用的墙 ${wallId} 必须存在`);
  const segments = w.segments?.length
    ? w.segments
    : [{ x1: w.x1, z1: w.z1, x2: w.x2, z2: w.z2 }];
  return segments.reduce((sum: number, s: any) => sum + Math.hypot(s.x2 - s.x1, s.z2 - s.z1), 0);
}

/** 全部墙特征涂漆带（S4 起 paint_region 的住址），附宿主墙 id。 */
function allPaintBands(): Array<any & { wall: string }> {
  return (MG.walls ?? []).flatMap((w: any) =>
    (w.finish?.paint_bands ?? []).map((b: any) => ({ ...b, wall: w.id })),
  );
}

test('skirting 派生 ≡ 原 24 段声明（逐字段相等，id/type/wall/room/along/bottom/height/color）', () => {
  assert.equal(skirt.length, 24, '派生段数必须等于原声明数 24');
  assert.equal(ORIGINAL_DECLARATIONS.length, 24, '冻结基线必须是 24 段');
  const byKey = new Map(skirt.map((s: any) => [[s.wall, s.room, s.along[0], s.along[1]].join('|'), s]));
  for (const original of ORIGINAL_DECLARATIONS) {
    const key = [original.wall, original.room, original.along[0], original.along[1]].join('|');
    const derived: any = byKey.get(key);
    assert.ok(derived, `原声明 ${original.id}（${key}）必须有派生段逐一对应——派生规则漂移即本断言红`);
    // 逐字段相等（reason 是散文：单独断言它指向所跟随的漆面带与 DEC 编号）。
    for (const field of ['id', 'type', 'wall', 'room', 'bottom', 'height', 'color'] as const) {
      assert.deepEqual(derived[field], (original as any)[field], `${original.id} 字段 ${field} 必须与原声明相等`);
    }
    assert.deepEqual(derived.along, original.along, `${original.id} along 必须与原声明相等`);
    assert.ok(typeof derived.reason === 'string' && derived.reason.length > 0, `${original.id} reason 不得为空`);
    assert.ok(derived.reason.includes('DEC-2026-10-28-R02'), `${original.id} reason 必须带 DEC 编号`);
    assert.ok(derived.reason.includes(derived.id.replace(/^skirt_/, 'paint_')), `${original.id} reason 必须指向所跟随的漆面带`);
  }
  // 零增：派生集合不得含原声明之外的段。
  const originalKeys = new Set(ORIGINAL_DECLARATIONS.map((o) => [o.wall, o.room, o.along[0], o.along[1]].join('|')));
  for (const s of skirt) {
    assert.ok(originalKeys.has([s.wall, s.room, s.along[0], s.along[1]].join('|')), `派生段 ${s.id} 不在原 24 段声明内——零增被破坏`);
  }
});

test('skirting 派生规则：§6.1 四元组配对 24/24，缺的 7 段正是两卫湿区', () => {
  const paint = allPaintBands();
  assert.equal(paint.length, 31, '全屋漆面带应为 31 段（派生基数的全集）');
  // 配对方法（迁移设计 §6.1）：按 (wall, room, along[0], along[1]) 四元组对全部
  // paint × skirting 配对。24/24 命中 = 每条非湿区漆面带恰好派生一条踢脚带。
  const skirtKeys = new Set(skirt.map((s: any) => [s.wall, s.room, s.along[0], s.along[1]].join('|')));
  const matched = paint.filter((p: any) => skirtKeys.has([p.wall, p.room, p.along[0], p.along[1]].join('|')));
  assert.equal(matched.length, 24, `24/24 配对必须全部命中，实测 ${matched.length}/31`);
  const unmatched = paint.filter((p: any) => !skirtKeys.has([p.wall, p.room, p.along[0], p.along[1]].join('|')));
  assert.equal(unmatched.length, 7, `未配踢脚的漆面带必须恰为 7 段（两卫湿区），实测 ${unmatched.length}`);
  const byRoom: Record<string, number> = {};
  for (const p of unmatched) byRoom[p.room] = (byRoom[p.room] ?? 0) + 1;
  assert.deepEqual(byRoom, { guest_bath: 5, master_bath: 2 }, '缺的 7 段必须正是 guest_bath 5 + master_bath 2');
  // 湿区判定唯一源：config/tile-comparison.yaml 的 wet_room_ids（不另列房间表）。
  assert.deepEqual([...wetRoomIds].sort(), ['guest_bath', 'master_bath'], '湿区表必须正是两卫');
  for (const p of unmatched) assert.ok(wetRoomIds.includes(p.room), `${p.id} 未配踢脚但房间不在湿区表——规则解释不通，按停止条件处理`);
  // 纯函数层同结论：直接喂墙特征 + 湿区表，得到与装配一致的 24 段。
  const direct = deriveSkirtingRegions(MG.walls ?? [], { height: 0.08, color: '#e5e2db' }, new Set(wetRoomIds));
  assert.equal(direct.length, 24, '纯函数派生也必须是 24 段');
});

test('skirting 派生段：高度/颜色取 finish-defaults 锚点，湿区房间一律不生成', () => {
  const heights = [...new Set(skirt.map((s: any) => s.height))];
  assert.equal(heights.length, 1, `高度必须全屋统一、单点可调，实测 ${heights.join(',')}`);
  assert.ok(heights[0] >= 0.08 && heights[0] <= 0.10, `高度现值必须在 R01 区间 80–100mm 内，实测 ${heights[0]}m（区间内调整不用改测试，超区间须新 DEC）`);
  const colors = [...new Set(skirt.map((s: any) => s.color))];
  assert.deepEqual(colors, ['#e5e2db'], `颜色必须全屋统一取锚点值，实测 ${colors.join(',')}`);
  for (const s of skirt) {
    assert.equal(s.bottom, 0, `${s.id} bottom 必须为 0（贴地）`);
    assert.ok(!wetRoomIds.includes(s.room), `${s.id} 房间 ${s.room} 是湿区，不得有踢脚线（DEC-2026-10-28-R01）`);
    assert.ok(!['kitchen', 'balcony', 'entry_garden', 'elevator_shaft'].includes(s.room), `${s.id} 房间 ${s.room} 不应有踢脚线（无漆面带即不派生）`);
    assert.ok(s.along[1] > s.along[0], `${s.id} along 区间必须为正`);
    assert.ok(s.along[1] <= wallLength(s.wall) + 1e-6, `${s.id} along 越界：墙 ${s.wall} 长 ${wallLength(s.wall)}`);
  }
  // 锚点值必须真的来自 finish-defaults.yaml（改声明即改派生，代码无默认值）。
  const defaults: any = load(readFileSync('config/model/envelope/finish-defaults.yaml', 'utf8'));
  assert.equal(skirt[0].height, defaults.skirting.height, '派生高度必须等于 finish-defaults 锚点');
  assert.equal(skirt[0].color, defaults.skirting.color, '派生颜色必须等于 finish-defaults 锚点');
});

test('skirting scheme item follows wall tile (landing checkpoint)', () => {
  const scheme: any = JSON.parse(readFileSync('data/current-scheme.json', 'utf8'));
  assert.ok(scheme.selections.skirting, '选材方案必须有 skirting 项，否则方案落地清单里没有踢脚线');
  assert.equal(scheme.selections.skirting.default, scheme.selections.wall.default, 'skirting default 必须等于 wall default（跟墙砖走；墙砖换选不同步即卡点失败）');
});

test('SCH-135-01 is the skirting landing gate item', () => {
  const control: any = load(readFileSync('schedule/phase-1/control.yaml', 'utf8'));
  const pkg: any = (control.work_packages ?? []).find((p: any) => p.id === 'PKG-135');
  assert.ok(pkg, 'PKG-135 必须存在');
  assert.equal(pkg.payment_gate, 'GATE-135-COMPLETE');
  const check: any = (pkg.checks ?? []).find((c: any) => c.id === 'SCH-135-01');
  assert.ok(check, 'SCH-135-01 必须存在');
  assert.equal(check.severity, 'major');
  assert.ok(String(check.item).includes('卡点'), 'SCH-135-01 标题必须明示它是方案落地卡点');
  assert.ok(String(check.pass_condition).includes('ready=true'), 'SCH-135-01 通过条件必须含 3D 审计面 ready=true');
});

test('buildScene renders derived skirting as visible opaque strips, door-split', () => {
  const walls: any[] = RESOLVED.walls.map((w: any) => ({
    id: w.id, x1: w.x1, z1: w.z1, x2: w.x2, z2: w.z2, height: w.height ?? 2.8,
    ...(w.segments ? { segments: w.segments } : {}),
    ...(w.openings ? { openings: w.openings } : {}),
    // line_datum 必须随墙透传：完成面偏移由 wallFaceOffset 解析器按它解算（S4 起
    // SceneBuilder 不再有私有偏移常量），缺声明即显形不出网。
    ...(w.line_datum ? { line_datum: w.line_datum } : {}),
    ...(w.finish ? { finish: w.finish } : {}),
  }));
  const merged: any[] = mergeSceneElements(walls, parsed);
  const result: any = buildScene({
    walls,
    rooms: RESOLVED.rooms,
    elements: merged.filter((e: any) => e.type === 'skirting_region'),
    furnishings: {},
  } as any);
  assert.deepEqual(result.report.unsupported, [], `skirting 构建不得有 unsupported：${result.report.unsupported.join('; ')}`);
  const meshes: THREE.Mesh[] = [];
  result.exportRoot.traverse((o: any) => { if (o.userData?.type === 'skirting_region') meshes.push(o as THREE.Mesh); });
  assert.ok(meshes.length >= skirt.length, `网格数不得少于声明段数（门洞/弧墙拆块只会更多），实测 ${meshes.length}`);
  for (const m of meshes) {
    assert.equal(m.visible, true, `${m.userData.objectId} 必须在正常视图里可见（不是检视层）`);
    assert.equal(m.userData.height, skirt[0].height, `${m.userData.objectId} 高度必须等于声明锚点值，不得用代码默认值`);
    assert.ok(Number(m.userData.lengthM) > 0, `${m.userData.objectId} lengthM 必须为正`);
  }
  // 门洞实扣：西北次卧南墙 w_nw_south 的漆面段长 3.00m，门 d_bnw 宽 0.90m，净长应为 2.10m。
  const nw = meshes.filter((m: any) => m.userData.regionId === 'skirt_bedroom_nw_w_nw_south');
  const nwLength = nw.reduce((s: number, m: any) => s + Number(m.userData.lengthM), 0);
  assert.ok(nw.length >= 2, '门洞必须把该段拆成至少两块');
  assert.ok(Math.abs(nwLength - 2.10) < 0.02, `门洞实扣后净长应为 2.10m，实测 ${nwLength.toFixed(3)}m`);
});
