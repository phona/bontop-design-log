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
  openings: [{ id: 'op_door', type: 'door', x: 2, z: 0, width: 0.9, height: 2.1 }],
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
        wall,
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
