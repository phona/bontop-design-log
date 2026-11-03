import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProjectDxf, DXF_LAYERS, type ProjectDxfInput } from '../../shared/dxf/project-dxf.js';
import type { SceneElement } from '../../shared/types.js';

const DXF_ENTITY_TYPES = new Set(['LINE', 'CIRCLE', 'ARC', 'TEXT']);

function parseEntities(dxf: string): Array<Record<string, string>> {
  const lines = dxf.split('\n').map((line) => line.trim());
  const pairs: Array<[number, string]> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    pairs.push([Number(lines[i]), lines[i + 1]]);
  }
  const entities: Array<Record<string, string>> = [];
  let inEntities = false;
  let current: Record<string, string> | undefined;
  for (const [code, value] of pairs) {
    if (code === 0) {
      if (value === 'ENDSEC') { inEntities = false; continue; }
      if (inEntities && DXF_ENTITY_TYPES.has(value)) {
        if (current) entities.push(current);
        current = { type: value };
      }
      continue;
    }
    if (code === 2 && value === 'ENTITIES') { inEntities = true; continue; }
    if (!inEntities || !current) continue;
    current[String(code)] = value;
  }
  if (current) entities.push(current);
  return entities;
}

function linesOn(entities: Array<Record<string, string>>, layer: string): Array<Array<number>> {
  return entities
    .filter((e) => e.type === 'LINE' && e['8'] === layer)
    .map((e) => [Number(e['10']), Number(e['20']), Number(e['11']), Number(e['21'])]);
}

/** 测试户型：北墙 y=0 处 4m 墙（x 0→4），中点 0.9m 门洞；南面 2m×2m 房间。 */
const wall: Extract<SceneElement, { type: 'wall' }> = {
  type: 'wall',
  id: 'w_north',
  x1: 0, z1: 0, x2: 4, z2: 0,
  openings: [{ id: 'op_door', type: 'door', x: 2, z: 0, width: 0.9, height: 2.1, swing: 'inward', hinge: 'start' }],
};

function baseInput(): ProjectDxfInput {
  return {
    house: {
      rooms: [{ id: 'living', name: '客厅', x: 2, z: 1, width: 4, depth: 2, height: 2.8, type: 'public' }],
      furnishings: {},
      electrical: [
        { id: 's1', room: 'living', type: 'socket', x: 0.3, z: 0.5 },
        { id: 'sw1', room: 'living', type: 'switch', x: 1, z: 0.2 },
        { id: 'dl1', room: 'living', type: 'downlight', x: 2, z: 1.5 },
      ],
      ceilingZones: [{ id: 'ceil_drop', room: 'living', type: 'drop', thickness: 0.08, area: [0, 0, 4, 2] }],
      sceneElements: [
        // 拷贝模块级 wall：测试会就地改 segments/openings，共享对象会跨测试泄漏
        { ...wall, openings: wall.openings?.map((opening) => ({ ...opening })) },
        { type: 'wall_region', id: 'tile_n', wall: 'w_north', along: [0, 2], bottom: 0, height: 2.4 },
        { type: 'floor_region', id: 'floor_living', points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 2 }, { x: 0, z: 2 }] },
        { type: 'hinged_glass_door', id: 'gd1', points: [{ x: 0, z: 0.8 }, { x: 0, z: 1.6 }], height: 2, swing: 'north', hinge: 'start' },
      ] as SceneElement[],
    },
  };
}

test('project-dxf: 坐标映射唯一口径 local (1,-2)m → DXF (1000,2000)mm', () => {
  const result = buildProjectDxf({
    house: { rooms: [], furnishings: {}, electrical: [], ceilingZones: [], sceneElements: [{ type: 'wall', id: 'w', x1: 1, z1: -2, x2: 2, z2: -2 }] },
  });
  const lines = linesOn(parseEntities(result.dxf), DXF_LAYERS.WALL[0]);
  assert.deepEqual(lines, [[1000, 2000, 2000, 2000]]);
});

test('project-dxf: 墙被门洞切开为两段，洞口封头在 A-OPENING', () => {
  const result = buildProjectDxf(baseInput());
  const entities = parseEntities(result.dxf);
  const wallLines = linesOn(entities, DXF_LAYERS.WALL[0]);
  // 门洞 [1.55, 2.45]，墙切成 [0,1.55] 与 [2.45,4]（local z=0 → y=0）
  assert.deepEqual(wallLines, [[0, 0, 1550, 0], [2450, 0, 4000, 0]]);
  const caps = linesOn(entities, DXF_LAYERS.OPENING[0]);
  // 两个洞口端点、各两条封头线
  assert.equal(caps.length, 4);
  assert.ok(caps.every(([x]) => x === 1550 || x === 2450));
});

test('project-dxf: 电气按 type 分层（socket→E-POWER / switch→E-SWITCH / downlight→E-LIGHT）', () => {
  const result = buildProjectDxf(baseInput());
  assert.equal(result.stats[DXF_LAYERS.E_POWER[0]], 2); // 圆 + 文字
  assert.equal(result.stats[DXF_LAYERS.E_SWITCH[0]], 2);
  assert.equal(result.stats[DXF_LAYERS.E_LIGHT[0]], 2);
});

test('project-dxf: wall_region 沿墙插值出子线段（along [0,2] → x 0~2000mm）', () => {
  const result = buildProjectDxf(baseInput());
  const tileLines = linesOn(parseEntities(result.dxf), DXF_LAYERS.WFIN_TILE[0]);
  assert.deepEqual(tileLines, [[0, 0, 2000, 0]]);
});

test('project-dxf: 饰面标注用声明的顶标高（height 是顶标高不是带高，codex 审 blocking）', () => {
  const input = baseInput();
  (input.house.sceneElements[1] as Extract<SceneElement, { type: 'wall_region' }>).bottom = 0.77;
  (input.house.sceneElements[1] as Extract<SceneElement, { type: 'wall_region' }>).height = 1.10;
  const result = buildProjectDxf(input);
  const texts = parseEntities(result.dxf).filter((e) => e.type === 'TEXT' && e['8'] === DXF_LAYERS.WFIN_TILE[0]);
  assert.ok(texts.some((e) => e['1'] === 'tile_n 0.77~1.10m'), JSON.stringify(texts.map((e) => e['1'])));
});

test('project-dxf: wall_run 实体墙进 A-WALL（开放折线 + 高度标注，codex 审 blocking）', () => {
  const input = baseInput();
  input.house.sceneElements.push({ type: 'wall_run', id: 'vanity_halfwall', points: [{ x: 1, z: 2 }, { x: 1, z: 3 }], height: 1.05 });
  const result = buildProjectDxf(input);
  const entities = parseEntities(result.dxf);
  // 两点 wall_run = 1 条线（不闭合），另含原墙两条切分段
  const wallLines = linesOn(entities, DXF_LAYERS.WALL[0]);
  assert.deepEqual(wallLines[2], [1000, -2000, 1000, -3000]);
  assert.ok(entities.some((e) => e.type === 'TEXT' && e['8'] === DXF_LAYERS.WALL[0] && e['1'] === 'vanity_halfwall H1.05'));
});

test('project-dxf: wall_region along 超出墙长 → 显形告警不导出（与 3D unsupported 同口径）', () => {
  const input = baseInput();
  (input.house.sceneElements[1] as Extract<SceneElement, { type: 'wall_region' }>).along = [0, 5];
  const result = buildProjectDxf(input);
  assert.ok(result.warnings.some((w) => w.includes('tile_n') && w.includes('超出墙')));
  assert.equal(result.stats[DXF_LAYERS.WFIN_TILE[0]], undefined);
});

test('project-dxf: 带 segments 细分的墙，wall_region 沿折线链插值（不按主线直插）', () => {
  const input = baseInput();
  // 墙拆成两段细分：0→1m 与 1→4m（几何共线，插值结果应与主线一致）；把第二段整体平移 1m 南
  // 制造折线差异：along [3,4] 应落在平移后的第二段上，而不是主线直插位置。
  (input.house.sceneElements[0] as Extract<SceneElement, { type: 'wall' }>).segments = [
    { x1: 0, z1: 0, x2: 1, z2: 0 },
    { x1: 1, z1: 1, x2: 4, z2: 1 },
  ];
  (input.house.sceneElements[1] as Extract<SceneElement, { type: 'wall_region' }>).along = [3, 4];
  const result = buildProjectDxf(input);
  const tileLines = linesOn(parseEntities(result.dxf), DXF_LAYERS.WFIN_TILE[0]);
  // 链：段1 (0,0)→(1,0) 长 1；段2 (1,1)→(4,1) 长 3。along 3 → 段2 上 (3,1)，along 4 → (4,1)。
  // 主线直插会得 (3,0)/(4,0)（y=0），折线链插值得 (3,1)/(4,1)（y=-1000）——断言区分两者。
  assert.deepEqual(tileLines, [[3000, -1000, 4000, -1000]]);
});

test('project-dxf: wall_region 引用不存在的墙 → warning 显形，不抛', () => {
  const input = baseInput();
  (input.house.sceneElements[1] as Extract<SceneElement, { type: 'wall_region' }>).wall = 'w_missing';
  const result = buildProjectDxf(input);
  assert.ok(result.warnings.some((w) => w.includes('w_missing')));
  assert.equal(result.stats[DXF_LAYERS.WFIN_TILE[0]], undefined);
});

test('project-dxf: hinged_glass_door 画关闭位 + 开启位门扇与开启弧', () => {
  const result = buildProjectDxf(baseInput());
  const entities = parseEntities(result.dxf);
  const doorLines = linesOn(entities, DXF_LAYERS.DOOR[0]);
  // 关闭位 (0,800)→(0,-800)（z 0.8→1.6 映射 y -800→-1600，翻转后按 hinge start）
  // points[start=(0,0.8), end=(0,1.6)] → DXF (0,-800),(0,-1600)；hinge=start → 铰链 (0,-800)
  assert.deepEqual(doorLines[0], [0, -800, 0, -1600]);
  const arcs = entities.filter((e) => e.type === 'ARC' && e['8'] === DXF_LAYERS.DOOR[0]);
  assert.equal(arcs.length, 1);
  assert.equal(arcs[0]['40'], '800.0000'); // 半径 = 门宽 0.8m
});

test('project-dxf: plumbing / mep 缺失时图层为空 + warning；给足时落到 P-POINTS / M-ROUTE', () => {
  const without = buildProjectDxf(baseInput());
  assert.ok(without.warnings.some((w) => w.startsWith('plumbing:')));
  assert.ok(without.warnings.some((w) => w.startsWith('mep:')));
  assert.equal(without.stats[DXF_LAYERS.P_POINTS[0]], undefined);
  assert.equal(without.stats[DXF_LAYERS.M_ROUTE[0]], undefined);

  const withAll = buildProjectDxf({
    ...baseInput(),
    plumbing: [{ id: 'p_cold', room: 'living', type: 'water_in_cold' as never, x: 3, z: 1.5 }],
    mep: {
      coordination: {
        version: '1', status: 'ok',
        layers: {},
        routes: [{ id: 'r1', layer: 'condensate' as never, status: 'confirmed' as never, from: { x: 1, z: 1 }, to: { x: 3, z: 1 }, via: [] }],
        junctions: [],
      } as never,
      sources: { electrical: [], plumbing: [], ceiling: [], hvacAnchors: [], hvacTerminals: [], outdoor: [] } as never,
    },
  });
  assert.equal(withAll.stats[DXF_LAYERS.P_POINTS[0]], 2);
  // 路由折线一段 + 标注文字一条 = 2 个实体
  assert.equal(withAll.stats[DXF_LAYERS.M_ROUTE[0]], 2);
});

test('project-dxf: 候选/需求示意管路隔离到 M-CAND 并告警，不进 M-ROUTE（codex 审 blocking）', () => {
  const result = buildProjectDxf({
    ...baseInput(),
    mep: {
      coordination: {
        version: '1', status: 'ok',
        layers: {},
        routes: [
          { id: 'r_phys', layer: 'condensate' as never, status: 'confirmed' as never, from: { x: 1, z: 1 }, to: { x: 3, z: 1 }, via: [] },
          { id: 'r_cand', layer: 'condensate' as never, status: 'pending' as never, route_kind: 'candidate', from: { x: 0, z: 0 }, to: { x: 2, z: 0 }, via: [] },
        ],
        junctions: [],
      } as never,
      sources: { electrical: [], plumbing: [], ceiling: [], hvacAnchors: [], hvacTerminals: [], outdoor: [] } as never,
    },
  });
  assert.equal(result.stats[DXF_LAYERS.M_ROUTE[0]], 2); // 只有 r_phys
  assert.equal(result.stats[DXF_LAYERS.M_CAND[0]], 2); // r_cand 折线 + 标注
  assert.ok(result.warnings.some((w) => w.includes('r_cand') && w.includes('M-CAND')));
  const candTexts = parseEntities(result.dxf).filter((e) => e.type === 'TEXT' && e['8'] === DXF_LAYERS.M_CAND[0]);
  assert.ok(candTexts.some((e) => (e['1'] ?? '').includes('非放线依据')));
});

test('project-dxf: 内机 anchor 经 ref:ceiling 解析进 M-HVAC，解析不了显式告警（codex 审 blocking）', () => {
  const result = buildProjectDxf({
    ...baseInput(),
    mep: {
      coordination: { version: '1', status: 'ok', layers: {}, routes: [], junctions: [] } as never,
      sources: {
        electrical: [], plumbing: [], outdoor: [],
        ceiling: [{ id: 'ac_living', room: 'living', type: 'ac_indoor' as never, x: 10.3, z: 4.75 } as never],
        hvacAnchors: [
          { id: 'indoor_living', status: 'confirmed' as never, system: 'refrigerant' as never, ref: { source: 'ceiling', id: 'ac_living' } } as never,
          { id: 'indoor_lost', status: 'confirmed' as never, system: 'refrigerant' as never, ref: { source: 'ceiling', id: 'ac_missing' } } as never,
        ],
        hvacTerminals: [],
      } as never,
    },
  });
  // indoor_living 解析成功：圆 + 标注；indoor_lost 显形告警
  assert.equal(result.stats[DXF_LAYERS.M_HVAC[0]], 2);
  assert.ok(result.warnings.some((w) => w.includes('indoor_lost')));
});

test('project-dxf: 圆角折线经 centerlineSamples 展开（弧不成直线折点）+ R 标注（codex 二审 blocking）', () => {
  const input = baseInput();
  // 直角三点 + 中点圆角 R0.3：直线走法 = 2 条线；弧感知采样 ≥ 6 段且带 R300 标注
  input.house.sceneElements.push({
    type: 'railing_run', id: 'railing_arc', height: 1,
    points: [
      { x: 0, z: 5 },
      { x: 2, z: 5, radius: 0.3, cx: 2, cz: 4.7 },
      { x: 2, z: 3 },
    ],
  });
  const result = buildProjectDxf(input);
  const entities = parseEntities(result.dxf);
  const lines = linesOn(entities, DXF_LAYERS.GLAZING[0]);
  // 原有 glazing（hinged door 不在 GLAZING；此 fixture GLAZING 只有本折线）——弧采样段数 ≥ 6
  const railingLines = lines.filter(([x1, y1, x2, y2]) => Math.abs(y1 - y2) > 1 || x1 < 1900 || x2 > 2100);
  assert.ok(railingLines.length >= 6, `expected sampled arc segments, got ${lines.length}`);
  assert.ok(entities.some((e) => e.type === 'TEXT' && e['8'] === DXF_LAYERS.GLAZING[0] && e['1'] === 'R300'));
  // 开放折线：起点 (0,-5000) 到终点 (2,-3000)，不存在首尾闭合段
  assert.ok(!lines.some(([x1, y1, x2, y2]) => (x1 === 0 && y1 === -5000 && x2 === 2000 && y2 === -3000)));
});

test('project-dxf: 非矩形房间优先 points 轮廓，不用外接矩形（codex 二审 blocking）', () => {
  const input = baseInput();
  input.house.rooms = [{
    ...input.house.rooms[0],
    x: 2, z: 1, width: 4, depth: 2, area: 6.5,
    points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 1 }, { x: 2, z: 2 }, { x: 0, z: 2 }],
  }];
  const result = buildProjectDxf(input);
  const roomLines = linesOn(parseEntities(result.dxf), DXF_LAYERS.ROOM[0]);
  // 五边形 5 边；外接矩形南边是 (0,-2000)→(4000,-2000) 完整长边——断言不存在该 4000mm 水平边
  assert.equal(roomLines.length, 5);
  assert.ok(!roomLines.some(([x1, y1, x2, y2]) => y1 === -2000 && y2 === -2000 && Math.abs(x2 - x1) === 4000));
});

test('project-dxf: 抽象服务点标注「禁止开槽待SKU」+ 告警（codex 二审 blocking）', () => {
  const result = buildProjectDxf({
    ...baseInput(),
    plumbing: [
      { id: 'faucet_abs', room: 'living', type: 'faucet' as never, x: 1, z: 1, height: 0.8, note: 'h=0.8 为抽象服务点，不得按此直接开槽' },
      { id: 'drain_confirmed', room: 'living', type: 'drain' as never, x: 2, z: 1, height: 0.35, construction_status: 'confirmed' },
    ],
  });
  const texts = parseEntities(result.dxf).filter((e) => e.type === 'TEXT' && e['8'] === DXF_LAYERS.P_POINTS[0]);
  assert.ok(texts.some((e) => (e['1'] ?? '').includes('faucet_abs') && (e['1'] ?? '').includes('禁止开槽')));
  assert.ok(texts.some((e) => (e['1'] ?? '').includes('drain_confirmed') && !(e['1'] ?? '').includes('禁止开槽')));
  assert.ok(result.warnings.some((w) => w.includes('faucet_abs') && w.includes('禁止直接开槽')));
  assert.ok(!result.warnings.some((w) => w.includes('drain_confirmed')));
});

test('project-dxf: junction 随关联候选路线隔离 M-CAND（codex 二审 major）', () => {
  const result = buildProjectDxf({
    ...baseInput(),
    mep: {
      coordination: {
        version: '1', status: 'ok',
        layers: {},
        routes: [
          { id: 'in_a', layer: 'condensate' as never, status: 'confirmed' as never, route_kind: 'candidate', from: { x: 0, z: 0 }, to: { x: 1, z: 0 }, via: [] },
          { id: 'out_phys', layer: 'condensate' as never, status: 'confirmed' as never, from: { x: 2, z: 0 }, to: { x: 3, z: 0 }, via: [] },
        ],
        junctions: [{
          id: 'merge_1', layer: 'condensate' as never, kind: 'merge' as never,
          position: { x: 1.5, z: 0, y: 2.5 }, inlet_routes: ['in_a'], outlet_route: 'out_phys',
          fitting: 'wye' as never, fitting_overlap_m: 0.05, reason: 'test',
        }] as never,
      } as never,
      sources: { electrical: [], plumbing: [], ceiling: [], hvacAnchors: [], hvacTerminals: [], outdoor: [] } as never,
    },
  });
  const entities = parseEntities(result.dxf);
  // junction 圆和「待核验」标注在 M-CAND；M-ROUTE 只有 out_phys 折线+标注
  assert.ok(entities.some((e) => e['8'] === DXF_LAYERS.M_CAND[0] && e.type === 'CIRCLE' && e['10'] === '1500.0000'));
  assert.ok(entities.some((e) => e['8'] === DXF_LAYERS.M_CAND[0] && e.type === 'TEXT' && (e['1'] ?? '').includes('merge_1') && (e['1'] ?? '').includes('待核验')));
  assert.ok(!entities.some((e) => e['8'] === DXF_LAYERS.M_ROUTE[0] && e.type === 'CIRCLE'));
  assert.ok(result.warnings.some((w) => w.includes('merge_1')));
});

test('project-dxf: 电气 blocked/pending 点位标注限制 + 告警（codex 三审 blocking）', () => {
  const result = buildProjectDxf({
    ...baseInput(),
    house: {
      ...baseInput().house,
      electrical: [
        ...baseInput().house.electrical,
        { id: 'sock_blk', room: 'living', type: 'socket', x: 0.5, z: 0.5, height: 1.2, position_status: 'pending', serviceability_status: 'blocked' },
        { id: 'sock_pend', room: 'living', type: 'socket', x: 0.7, z: 0.5, position_status: 'inferred' },
      ] as never,
    },
  });
  const texts = parseEntities(result.dxf).filter((e) => e.type === 'TEXT' && e['8'] === DXF_LAYERS.E_POWER[0]);
  assert.ok(texts.some((e) => (e['1'] ?? '').includes('sock_blk') && (e['1'] ?? '').includes('不可用')));
  assert.ok(texts.some((e) => (e['1'] ?? '').includes('sock_pend') && (e['1'] ?? '').includes('待核')));
  assert.ok(result.warnings.some((w) => w.includes('sock_blk') && w.includes('不得按普通点施工')));
  assert.ok(result.warnings.some((w) => w.includes('sock_pend') && w.includes('位置待核')));
});

test('project-dxf: 踢脚线按门洞切分，不横穿门口（codex 三审 blocking）', () => {
  const input = baseInput();
  // 沿墙 [0,4] 踢脚；墙中点 2.0 有 0.9m 门洞 → 踢脚切成 [0,1.55] 与 [2.45,4] 两段
  input.house.sceneElements.push({ type: 'skirting_region', id: 'sk_main', wall: 'w_north', room: 'living', along: [0, 4], height: 0.1 });
  const result = buildProjectDxf(input);
  const skirtLines = linesOn(parseEntities(result.dxf), DXF_LAYERS.SKIRT[0]);
  assert.deepEqual(skirtLines, [[0, 0, 1550, 0], [2450, 0, 4000, 0]]);
});

test('project-dxf: ascii 模式保留英文限制短语，关键施工限制不丢失（codex 三审 blocking）', () => {
  const input = baseInput();
  input.house.sceneElements.push({ type: 'skirting_region', id: 'sk_x', wall: 'w_north', room: 'living', along: [0, 1], height: 0.1 });
  const ascii = buildProjectDxf({
    ...input,
    labels: 'ascii',
    plumbing: [{ id: 'faucet_abs', room: 'living', type: 'faucet' as never, x: 1, z: 1, height: 0.8, note: '抽象服务点，不得按此直接开槽' }],
    mep: {
      coordination: {
        version: '1', status: 'ok', layers: {},
        routes: [{ id: 'r_cand', layer: 'condensate' as never, status: 'pending' as never, route_kind: 'candidate', from: { x: 0, z: 0 }, to: { x: 2, z: 0 }, via: [] }],
        junctions: [],
      } as never,
      sources: { electrical: [], plumbing: [], ceiling: [], hvacAnchors: [], hvacTerminals: [], outdoor: [] } as never,
    },
  });
  const dxf = ascii.dxf;
  assert.ok(dxf.includes('ABSTRACT-NO CUT UNTIL SKU'), '抽象点限制须以英文交付');
  assert.ok(dxf.includes('CANDIDATE-NOT FOR CONSTRUCTION'), '候选路线限制须以英文交付');
  assert.ok(!dxf.includes('禁止开槽'));
});

test('project-dxf: 电气标注带多联数量 xN 与安装墙侧（codex 四审 blocking/major）', () => {
  const result = buildProjectDxf({
    ...baseInput(),
    house: {
      ...baseInput().house,
      electrical: [
        { id: 'sock_tv', room: 'living', type: 'socket', x: 1, z: 0, height: 0.3, count: 4, wallSide: 'east' },
        { id: 'sock_one', room: 'living', type: 'socket', x: 2, z: 0 },
      ] as never,
    },
  });
  const texts = parseEntities(result.dxf).filter((e) => e.type === 'TEXT' && e['8'] === DXF_LAYERS.E_POWER[0]);
  assert.ok(texts.some((e) => (e['1'] ?? '').includes('sock_tv') && (e['1'] ?? '').includes('x4') && (e['1'] ?? '').includes('east')));
  // 单联无 count 后缀
  assert.ok(texts.some((e) => (e['1'] ?? '').includes('sock_one') && !(e['1'] ?? '').includes(' x')));
});

test('project-dxf: 折线墙饰面逐段输出，不连起终点弦（codex 四审 blocking）', () => {
  const input = baseInput();
  // L 形墙：水平段 (0,0)→(2,0) 长 2 + 竖直段 (2,0)→(2,2) 长 2。区间 [1,3] 跨转角：
  // 逐段 = 水平 (1,0)→(2,0) + 竖直 (2,0)→(2,1)；弦线 = (1,0)→(2,1) 斜线（错误）。
  input.house.sceneElements[0] = { type: 'wall', id: 'w_l', x1: 0, z1: 0, x2: 2, z2: 0 };
  (input.house.sceneElements[0] as Extract<SceneElement, { type: 'wall' }>).segments = [
    { x1: 0, z1: 0, x2: 2, z2: 0 },
    { x1: 2, z1: 0, x2: 2, z2: 2 },
  ];
  (input.house.sceneElements[1] as Extract<SceneElement, { type: 'wall_region' }>).wall = 'w_l';
  (input.house.sceneElements[1] as Extract<SceneElement, { type: 'wall_region' }>).along = [1, 3];
  const result = buildProjectDxf(input);
  const tileLines = linesOn(parseEntities(result.dxf), DXF_LAYERS.WFIN_TILE[0]);
  assert.equal(tileLines.length, 2);
  assert.ok(tileLines.some(([x1, y1, x2, y2]) => x1 === 1000 && y1 === 0 && x2 === 2000 && y2 === 0), JSON.stringify(tileLines));
  assert.ok(tileLines.some(([x1, y1, x2, y2]) => x1 === 2000 && y1 === 0 && x2 === 2000 && y2 === -1000), JSON.stringify(tileLines));
  // 不存在斜弦 (1000,0)→(2000,-1000)
  assert.ok(!tileLines.some(([x1, y1, x2, y2]) => x1 === 1000 && y1 === 0 && x2 === 2000 && y2 === -1000));
});

test('project-dxf: hinge=end 门扇关闭位端点正确（末端铰链回归，codex 五审 blocking）', () => {
  const input = baseInput();
  input.house.sceneElements.push({ type: 'hinged_glass_door', id: 'gd_end', points: [{ x: 0, z: 0.8 }, { x: 0, z: 1.6 }], height: 2, swing: 'north', hinge: 'end' });
  const result = buildProjectDxf(input);
  const entities = parseEntities(result.dxf);
  const doorLines = linesOn(entities, DXF_LAYERS.DOOR[0]);
  // hinge=end：铰链 (0,-1600)，自由端关闭位 (0,-800)——门扇长 800mm（typo 会画成 (0,-1600) 自环）
  const leaf = doorLines.find(([x1, y1, x2, y2]) => x1 === 0 && y1 === -1600 && x2 === 0 && y2 === -800);
  assert.ok(leaf, JSON.stringify(doorLines));
  // 开启弧半径 = 门宽 800mm（typo 时半径 0，addArc 跳过 → gd_end 无弧）。
  // baseInput 的 gd1（hinge=start）也有一条弧，共 2 条、半径同为 800。
  const arcs = entities.filter((e) => e.type === 'ARC' && e['8'] === DXF_LAYERS.DOOR[0]);
  assert.equal(arcs.length, 2);
  assert.ok(arcs.every((arc) => arc['40'] === '800.0000'));
});

test('project-dxf: plumbing 显式 not_for_construction 命中禁施工判定（codex 五审 blocking）', () => {
  const result = buildProjectDxf({
    ...baseInput(),
    plumbing: [{ id: 'p_nfc', room: 'living', type: 'drain' as never, x: 1, z: 1, height: 0.35, not_for_construction: true }],
  });
  const texts = parseEntities(result.dxf).filter((e) => e.type === 'TEXT' && e['8'] === DXF_LAYERS.P_POINTS[0]);
  assert.ok(texts.some((e) => (e['1'] ?? '').includes('p_nfc') && (e['1'] ?? '').includes('SKU')));
  assert.ok(result.warnings.some((w) => w.includes('p_nfc')));
});

test('project-dxf: 电箱 mount_height 箱底标高随图交付（codex 五审 major）', () => {
  const result = buildProjectDxf({
    ...baseInput(),
    house: {
      ...baseInput().house,
      electrical: [
        { id: 'panel_strong', room: 'living', type: 'strong_panel', x: 1, z: 0, mount_height: 1.65 },
      ] as never,
    },
  });
  const texts = parseEntities(result.dxf).filter((e) => e.type === 'TEXT' && e['8'] === DXF_LAYERS.E_POWER[0]);
  assert.ok(texts.some((e) => (e['1'] ?? '').includes('panel_strong') && (e['1'] ?? '').includes('H1.65')));
});

test('project-dxf: plumbing 标注带安装墙侧（codex 五审 major）', () => {
  const result = buildProjectDxf({
    ...baseInput(),
    plumbing: [{ id: 'toilet_mb', room: 'living', type: 'toilet' as never, x: 1, z: 1, height: 0.35, wallSide: 'west' } as never],
  });
  const texts = parseEntities(result.dxf).filter((e) => e.type === 'TEXT' && e['8'] === DXF_LAYERS.P_POINTS[0]);
  assert.ok(texts.some((e) => (e['1'] ?? '').includes('toilet_mb') && (e['1'] ?? '').includes('west')));
});

test('project-dxf: 候选风口终端隔离 M-CAND，正式风口带 id（codex 六审 blocking）', () => {
  const result = buildProjectDxf({
    ...baseInput(),
    mep: {
      coordination: { version: '1', status: 'ok', layers: {}, routes: [], junctions: [] } as never,
      sources: {
        electrical: [], plumbing: [], ceiling: [], hvacAnchors: [], outdoor: [],
        hvacTerminals: [
          { id: 'condensate_living_candidate', status: 'pending', system: 'condensate', position: { x: 1, y: 2.5, z: 1 }, kind: 'condensate_drain_candidate', confirmed: false },
          { id: 'supply_living', status: 'confirmed', system: 'refrigerant', position: { x: 2, y: 2.5, z: 2 } },
        ] as never,
      } as never,
    },
  });
  const entities = parseEntities(result.dxf);
  assert.ok(entities.some((e) => e['8'] === DXF_LAYERS.M_CAND[0] && e.type === 'TEXT' && (e['1'] ?? '').includes('condensate_living_candidate')));
  assert.ok(entities.some((e) => e['8'] === DXF_LAYERS.M_HVAC[0] && e.type === 'TEXT' && (e['1'] ?? '').includes('supply_living')));
  assert.ok(!entities.some((e) => e['8'] === DXF_LAYERS.M_HVAC[0] && e.type === 'TEXT' && (e['1'] ?? '').includes('candidate')));
  assert.ok(result.warnings.some((w) => w.includes('condensate_living_candidate')));
});

test('project-dxf: floor_region 圆角随声明展开，不出外接矩形（codex 六审 blocking）', () => {
  const input = baseInput();
  // 直角三角形三点 + 第一点 R1.0 圆角：外接矩形闭合折线 = 3 边直角；弧感知 = 采样段 + R1000 标注
  input.house.sceneElements.push({
    type: 'floor_region', id: 'floor_round',
    points: [
      { x: 0, z: 5, radius: 1.0, cx: 1, cz: 5 },
      { x: 2, z: 5 },
      { x: 2, z: 6 },
    ],
  });
  const result = buildProjectDxf(input);
  const entities = parseEntities(result.dxf);
  const floorLines = linesOn(entities, DXF_LAYERS.F_FLOOR[0]);
  // 弧采样段数应明显多于 3（直角连接只有 3 条边）
  assert.ok(floorLines.length >= 6, `expected arc-sampled segments, got ${floorLines.length}`);
  assert.ok(entities.some((e) => e.type === 'TEXT' && e['8'] === DXF_LAYERS.F_FLOOR[0] && e['1'] === 'R1000'));
});

test('project-dxf: 普通门洞标注 swing/hinge（codex 六审 major）', () => {
  const result = buildProjectDxf(baseInput());
  const texts = parseEntities(result.dxf).filter((e) => e.type === 'TEXT' && e['8'] === DXF_LAYERS.OPENING[0]);
  assert.ok(texts.some((e) => (e['1'] ?? '').includes('op_door') && (e['1'] ?? '').includes('swing=inward') && (e['1'] ?? '').includes('hinge=start')));
});

test('project-dxf: ascii 模式房间标注显式用 id+sqm（codex 六审 minor）', () => {
  const ascii = buildProjectDxf({ ...baseInput(), labels: 'ascii' });
  assert.ok(ascii.dxf.includes('living 8.0sqm'));
  assert.ok(!ascii.dxf.includes('客厅'));
});

test('project-dxf: 降级 notes 写入 D-NOTES 图层随图交付（codex 七审 major）', () => {
  const result = buildProjectDxf({
    ...baseInput(),
    notes: ['PLUMBING NOT EXPORTED: render-facts API failed at export time'],
  });
  const entities = parseEntities(result.dxf);
  assert.ok(entities.some((e) => e['8'] === DXF_LAYERS.D_NOTES[0] && (e['1'] ?? '').includes('PLUMBING NOT EXPORTED')));
});

test('project-dxf: mep 缺失时自动加 MEP NOT EXPORTED 图内说明（codex 七审 major）', () => {
  const result = buildProjectDxf(baseInput());
  const entities = parseEntities(result.dxf);
  assert.ok(entities.some((e) => e['8'] === DXF_LAYERS.D_NOTES[0] && (e['1'] ?? '').includes('MEP NOT EXPORTED')));
  assert.ok(result.warnings.some((w) => w.startsWith('mep:')));
});

test('project-dxf: 声明圆角的吊顶标「矩形示意-圆角未表达」+ 告警（codex 七审 major）', () => {
  const input = baseInput();
  input.house.ceilingZones = [
    { id: 'ceil_plain', room: 'living', type: 'drop', thickness: 0.08, area: [0, 0, 4, 2] },
    { id: 'ceil_round', room: 'living', type: 'drop', thickness: 0.08, area: [0, 0, 4, 2], corner_radius: 0.1 },
  ];
  const result = buildProjectDxf(input);
  const texts = parseEntities(result.dxf).filter((e) => e.type === 'TEXT' && e['8'] === DXF_LAYERS.C_CEIL[0]);
  assert.ok(texts.some((e) => (e['1'] ?? '').includes('ceil_round') && (e['1'] ?? '').includes('矩形示意')));
  assert.ok(!texts.some((e) => (e['1'] ?? '').includes('ceil_plain') && (e['1'] ?? '').includes('矩形示意')));
  assert.ok(result.warnings.some((w) => w.includes('ceil_round') && w.includes('不可直接放线')));
});

test('project-dxf: ascii 模式吊顶近似说明用英文（codex 七审 major）', () => {
  const input = baseInput();
  input.house.ceilingZones = [{ id: 'ceil_round', room: 'living', type: 'drop', thickness: 0.08, area: [0, 0, 4, 2], corner_radii: { nw: 0.1 } }];
  const ascii = buildProjectDxf({ ...input, labels: 'ascii' });
  assert.ok(ascii.dxf.includes('RECT-ENVELOPE ONLY-NO FILLET'));
  assert.ok(!ascii.dxf.includes('矩形示意'));
});

test('project-dxf: 共墙双面饰面标注带房间归属且分侧错开（codex 八审 blocking）', () => {
  const input = baseInput();
  // 同一墙 w_north 两侧声明：living 侧 0~0.30m、kitchen 侧 0~2.65m（同 along）
  input.house.rooms.push({ id: 'kitchen', name: '厨房', x: 2, z: -2, width: 3, depth: 2, height: 2.8, type: 'service' });
  input.house.sceneElements.push(
    { type: 'wall_region', id: 'tile_balc', wall: 'w_north', room: 'living', along: [0, 1.6], bottom: 0, height: 0.30 },
    { type: 'wall_region', id: 'tile_gbath', wall: 'w_north', room: 'kitchen', along: [0, 1.6], bottom: 0, height: 2.65 },
  );
  const result = buildProjectDxf(input);
  const texts = parseEntities(result.dxf).filter((e) => e.type === 'TEXT' && e['8'] === DXF_LAYERS.WFIN_TILE[0]);
  const balc = texts.find((e) => (e['1'] ?? '').includes('tile_balc'));
  const gbath = texts.find((e) => (e['1'] ?? '').includes('tile_gbath'));
  assert.ok(balc && (balc['1'] ?? '').includes('[living]') && (balc['1'] ?? '').includes('0.00~0.30m'));
  assert.ok(gbath && (gbath['1'] ?? '').includes('[kitchen]') && (gbath['1'] ?? '').includes('0.00~2.65m'));
  // 分侧正确性（codex 九审 blocking）：living 在墙南侧（local z+ → DXF y−）、kitchen 北侧
  // （local z− → DXF y+）。z 翻转漏取反时两侧互换：balc 会跑到 y>0、gbath 跑到 y<0。
  assert.ok(balc && Number(balc['20']) < 0, `balc label should sit south (y<0), got ${balc?.['20']}`);
  assert.ok(gbath && Number(gbath['20']) > 0, `gbath label should sit north (y>0), got ${gbath?.['20']}`);
});

test('project-dxf: MEP 竖直管段画圆标记 + 标注起终标高（codex 八审 major）', () => {
  const result = buildProjectDxf({
    ...baseInput(),
    mep: {
      coordination: {
        version: '1', status: 'ok', layers: {},
        routes: [{ id: 'drop_bed', layer: 'refrigerant' as never, status: 'confirmed' as never, route_kind: 'physical', from: { x: 1, z: 1, y: 1.30 }, to: { x: 1, z: 1, y: 0.35 }, via: [] }],
        junctions: [],
      } as never,
      sources: { electrical: [], plumbing: [], ceiling: [], hvacAnchors: [], hvacTerminals: [], outdoor: [] } as never,
    },
  });
  const entities = parseEntities(result.dxf);
  // 平面零长 → 不出 LINE，出圆标记
  assert.ok(!entities.some((e) => e.type === 'LINE' && e['8'] === DXF_LAYERS.M_ROUTE[0]));
  assert.ok(entities.some((e) => e.type === 'CIRCLE' && e['8'] === DXF_LAYERS.M_ROUTE[0]));
  const texts = entities.filter((e) => e.type === 'TEXT' && e['8'] === DXF_LAYERS.M_ROUTE[0]);
  assert.ok(texts.some((e) => (e['1'] ?? '').includes('drop_bed') && (e['1'] ?? '').includes('H1.30→0.35')));
});

test('project-dxf: MEP 标高读 from_height/to_height 覆盖值而非端点原始 y（codex 九审 blocking）', () => {
  const result = buildProjectDxf({
    ...baseInput(),
    mep: {
      coordination: {
        version: '1', status: 'ok', layers: {},
        routes: [{
          id: 'weak_ap_cov', layer: 'weak_current' as never, status: 'confirmed' as never, route_kind: 'physical',
          from: { x: 1, z: 1, y: 0.50 }, to: { x: 3, z: 1, y: 0.90 }, via: [],
          from_height: 1.30, to_height: 0.35, // 路线声明覆盖端点原始 y
        }],
        junctions: [],
      } as never,
      sources: { electrical: [], plumbing: [], ceiling: [], hvacAnchors: [], hvacTerminals: [], outdoor: [] } as never,
    },
  });
  const texts = parseEntities(result.dxf).filter((e) => e.type === 'TEXT' && e['8'] === DXF_LAYERS.M_ROUTE[0]);
  // 读覆盖值 H1.30→0.35；读原始端点 y 会错标 H0.50→0.90
  assert.ok(texts.some((e) => (e['1'] ?? '').includes('H1.30→0.35')), JSON.stringify(texts.map((e) => e['1'])));
  assert.ok(!texts.some((e) => (e['1'] ?? '').includes('H0.50→0.90')));
});

test('project-dxf: 候选 anchor（pending/候选汇流节点）隔离 M-CAND，不与 junction 双画（codex 十审 blocking）', () => {
  const result = buildProjectDxf({
    ...baseInput(),
    mep: {
      coordination: {
        version: '1', status: 'ok', layers: {},
        routes: [{
          id: 'in_a', layer: 'condensate' as never, status: 'confirmed' as never, route_kind: 'candidate',
          from: 'condensate_outlet_cand', to: 'merge_node', via: [],
        }],
        junctions: [{
          id: 'merge_node', layer: 'condensate' as never, kind: 'merge' as never,
          position: { x: 1.5, z: 0, y: 2.5 }, inlet_routes: ['in_a'], outlet_route: 'out_x',
          fitting: 'wye' as never, fitting_overlap_m: 0.05, reason: 'test',
        }] as never,
      } as never,
      sources: {
        electrical: [], plumbing: [], ceiling: [], hvacTerminals: [], outdoor: [],
        hvacAnchors: [
          { id: 'merge_node', status: 'pending' as never, system: 'condensate' as never, position: { x: 1.5, y: 2.5, z: 0 } },
          { id: 'indoor_ok', status: 'confirmed' as never, system: 'refrigerant' as never, position: { x: 3, y: 2.8, z: 1 } },
        ] as never,
      } as never,
    },
  });
  const entities = parseEntities(result.dxf);
  // merge_node 只进 M-CAND（junction 一份 + anchor 隔离后同图层），不出现在 M-HVAC
  assert.ok(!entities.some((e) => e['8'] === DXF_LAYERS.M_HVAC[0] && (e['1'] ?? '').includes('merge_node')));
  assert.ok(entities.some((e) => e['8'] === DXF_LAYERS.M_CAND[0] && e.type === 'CIRCLE' && e['10'] === '1500.0000'));
  // 正常 anchor 留 M-HVAC
  assert.ok(entities.some((e) => e['8'] === DXF_LAYERS.M_HVAC[0] && e.type === 'TEXT' && (e['1'] ?? '').includes('indoor_ok')));
  assert.ok(result.warnings.some((w) => w.includes('merge_node') && w.includes('M-CAND')));
});

test('project-dxf: 等高路线也标注安装标高（codex 十审 major）', () => {
  const result = buildProjectDxf({
    ...baseInput(),
    mep: {
      coordination: {
        version: '1', status: 'ok', layers: {},
        routes: [{ id: 'strong_main', layer: 'refrigerant' as never, status: 'confirmed' as never, route_kind: 'physical', from: { x: 0, z: 0, y: 2.55 }, to: { x: 3, z: 0, y: 2.55 }, via: [] }],
        junctions: [],
      } as never,
      sources: { electrical: [], plumbing: [], ceiling: [], hvacAnchors: [], hvacTerminals: [], outdoor: [] } as never,
    },
  });
  const texts = parseEntities(result.dxf).filter((e) => e.type === 'TEXT' && e['8'] === DXF_LAYERS.M_ROUTE[0]);
  assert.ok(texts.some((e) => (e['1'] ?? '').includes('strong_main') && (e['1'] ?? '').includes('H2.55')));
});

test('project-dxf: ascii 模式标高分隔符用 ->（codex 十审 minor）', () => {
  const ascii = buildProjectDxf({
    ...baseInput(),
    labels: 'ascii',
    mep: {
      coordination: {
        version: '1', status: 'ok', layers: {},
        routes: [{ id: 'drop', layer: 'refrigerant' as never, status: 'confirmed' as never, route_kind: 'physical', from: { x: 1, z: 1, y: 1.30 }, to: { x: 1, z: 1, y: 0.35 }, via: [] }],
        junctions: [],
      } as never,
      sources: { electrical: [], plumbing: [], ceiling: [], hvacAnchors: [], hvacTerminals: [], outdoor: [] } as never,
    },
  });
  assert.ok(ascii.dxf.includes('H1.30->0.35'));
  assert.ok(!ascii.dxf.includes('→'));
});

test('project-dxf: ascii 标注模式剥离中文，几何不变', () => {
  const utf8 = buildProjectDxf(baseInput());
  const ascii = buildProjectDxf({ ...baseInput(), labels: 'ascii' });
  assert.ok(utf8.dxf.includes('客厅'));
  assert.ok(!ascii.dxf.includes('客厅'));
  assert.equal(ascii.stats[DXF_LAYERS.ROOM[0]], utf8.stats[DXF_LAYERS.ROOM[0]]);
});

test('project-dxf: 吊顶 area 四元组画矩形；无 area 的分区 warning 显形', () => {
  const result = buildProjectDxf({
    ...baseInput(),
    house: { ...baseInput().house, ceilingZones: [
      baseInput().house.ceilingZones[0],
      { id: 'ac_living', room: 'living', type: 'ac_indoor' as never },
    ] },
  });
  const ceilLines = linesOn(parseEntities(result.dxf), DXF_LAYERS.C_CEIL[0]);
  assert.equal(ceilLines.length, 4); // 矩形四边
  assert.ok(result.warnings.some((w) => w.includes('ac_living')));
});
