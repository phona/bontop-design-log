import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { load } from 'js-yaml';
import { buildScene } from '../../shared/render/SceneBuilder.js';
import { parseOverlay, mergeSceneElements } from '../../server/overlay-merge.js';
import { resolveLayout } from '../../server/layout-resolver.js';

// 踢脚线常显条带（DEC-2026-10-28-R02）。四道防线：
//  ① overlay 声明能过 schema 校验，且高度是可调数据（24 段高度全等、落在 R01 区间内，
//     但测试不把数值钉死在 0.08——区间内调锚点不用改测试）；
//  ② buildScene 真的建出常显（visible=true）网格，门洞处实扣断开；
//  ③ 选材方案里有 skirting 项且跟墙砖 default 相等（跟随规则，换选不同步即卡点失败）；
//  ④ SCH-135-01 是 GATE-135-COMPLETE 的放行卡点，且 pass 条件含 3D 审计面 ready。

const MG: any = load(readFileSync('config/layout/model-geometry.yaml', 'utf8'));
const OV: any = load(readFileSync('config/layout/overlay.yaml', 'utf8'));
const RESOLVED: any = resolveLayout(MG);
const parsed: any = parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8'));
const skirt: any[] = (parsed.elements ?? []).filter((e: any) => e.type === 'skirting_region');

function wallLength(wallId: string): number {
  const w: any = RESOLVED.walls.find((x: any) => x.id === wallId);
  assert.ok(w, `skirting 引用的墙 ${wallId} 必须存在`);
  const segments = w.segments?.length
    ? w.segments
    : [{ x1: w.x1, z1: w.z1, x2: w.x2, z2: w.z2 }];
  return segments.reduce((sum: number, s: any) => sum + Math.hypot(s.x2 - s.x1, s.z2 - s.z1), 0);
}

test('skirting_region declarations: 24 segments, uniform adjustable height, paint faces only', () => {
  assert.equal(skirt.length, 24, '24 段 = 非卫浴漆面 paint_region 逐段跟随，两卫漆面段不在此列');
  const heights = [...new Set(skirt.map((s: any) => s.height))];
  assert.equal(heights.length, 1, `高度必须全屋统一、单点可调，实测 ${heights.join(',')}`);
  assert.ok(heights[0] >= 0.08 && heights[0] <= 0.10, `高度现值必须在 R01 区间 80–100mm 内，实测 ${heights[0]}m（区间内调整不用改测试，超区间须新 DEC）`);
  for (const s of skirt) {
    assert.equal(s.bottom, 0, `${s.id} bottom 必须为 0（贴地）`);
    assert.ok(!['guest_bath', 'master_bath', 'kitchen', 'balcony', 'entry_garden', 'elevator_shaft'].includes(s.room), `${s.id} 房间 ${s.room} 不应有踢脚线（卫浴/厨房/阳台/入户花园/井道排除）`);
    assert.ok(s.along[1] > s.along[0], `${s.id} along 区间必须为正`);
    assert.ok(s.along[1] <= wallLength(s.wall) + 1e-6, `${s.id} along 越界：墙 ${s.wall} 长 ${wallLength(s.wall)}`);
  }
  // 段清单与漆面声明逐段对应（墙+房间+沿墙区间一致），不允许手抄漂移。
  const paint: any[] = (parsed.elements ?? []).filter((e: any) => e.type === 'paint_region' && !['guest_bath', 'master_bath'].includes(e.room));
  assert.equal(paint.length, 24, '非卫浴漆面段也应为 24 段，与踢脚线一一对应');
  for (const s of skirt) {
    const match = paint.find((p: any) => p.wall === s.wall && p.room === s.room && p.along[0] === s.along[0] && p.along[1] === s.along[1]);
    assert.ok(match, `${s.id} 必须逐段跟随一条非卫浴 paint_region（墙/房间/沿墙区间一致）`);
  }
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

test('buildScene renders skirting as visible opaque strips, door-split', () => {
  const walls: any[] = RESOLVED.walls.map((w: any) => ({
    id: w.id, x1: w.x1, z1: w.z1, x2: w.x2, z2: w.z2, height: w.height ?? 2.8,
    ...(w.segments ? { segments: w.segments } : {}),
    ...(w.openings ? { openings: w.openings } : {}),
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
