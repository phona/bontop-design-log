import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { buildProjectRenderFactsProjection } from '../../shared/project-render-facts-projection.js';
import { parseProjectHvacFacts, validateProjectHvacFacts } from '../../shared/project-render-facts-schema.js';
import type { CurtainPresentationState, CurrentScheme, ProjectRenderFacts, RenderLightingOverride, TrackLightConfig } from '../../shared/types.js';
import type { CurtainOverlayLike } from '../../shared/curtain-projection.js';

const facts: ProjectRenderFacts = {
  electrical: [
    { id: 'light_1', room: 'living', type: 'dome', x: 1, z: 2, height: 2.8, temp: 4000, recessed: true },
    { id: 'track_1', room: 'living', type: 'track_light', x: 2, z: 3, height: 2.8, temp: 3000, heads: 5 },
    { id: 'socket_1', room: 'living', type: 'socket', x: 3, z: 4 },
  ],
  plumbing: [{ id: 'faucet_1', room: 'kitchen', type: 'faucet', x: 3, z: 4 }],
  ceiling: [{ id: 'ceiling_1', room: 'living', type: 'drop' }],
  hvac: {
    plans: [{ id: 'A2', kind: 'vrf_ducted', outdoor: { id: 'outdoor_1', platform: 'platform', x: 1, z: 2, direction: 'south', width: 1, depth: 1, height: 1, model: 'VRF' }, diagram: { anchors: [], terminals: [], routes: [], reference_constraints: [] } }],
  },
};

const scheme: CurrentScheme = {
  updatedAt: '2026-08-23T00:00:00.000Z',
  selections: { floor: { default: 'floor_default', roomOverrides: { kitchen: 'floor_kitchen' } } },
};

function override(id = 'light_1'): RenderLightingOverride {
  // anchorY 不再写在 overrides 里：渲染挂点 = electrical.height(2.8) + anchorY_offset。
  return { id, anchorY_offset: -0.25, offsetX: 0.15, basis: 'dome shade thickness', reason: 'Audited render anchor.', applies_to: ['web', 'blender'] };
}

function overrides(...ids: string[]): RenderLightingOverride[] {
  return ids.map((id) => override(id));
}

const overlay: CurtainOverlayLike = {
  elements: [
    { id: 'curtain_living_south', type: 'curtain', room: 'living', kind: 'sheer_blackout' },
  ],
};

const presentation: CurtainPresentationState = {
  default: 'open',
  roomOverrides: {},
  updatedAt: '2026-08-25T00:00:00.000Z',
};

function project(
  projectionFacts: ProjectRenderFacts,
  projectionOverrides: RenderLightingOverride[],
  projectionScheme: CurrentScheme,
) {
  return buildProjectRenderFactsProjection(projectionFacts, projectionOverrides, projectionScheme, overlay, presentation, { fixtures: [] });
}

describe('buildProjectRenderFactsProjection', () => {
  it('projects only lighting fixtures without mutating construction facts', () => {
    const projection = project(facts, overrides('light_1', 'track_1'), scheme);

    // 2026-11-07 issue #98 S3：lightingFixtures 不再带 circuit——该字段唯一来源（点位侧
    // circuit 声明）已退役，渲染链无消费者；回路归属见 shared/point-circuits.ts 单一派生。
    assert.deepEqual(projection.lightingFixtures, [{
      id: 'light_1', room: 'living', type: 'dome',
      position: { x: 1.15, y: 2.55, z: 2 }, temperatureK: 4000, enabled: true, recessed: true,
    }, {
      id: 'track_1', room: 'living', type: 'track_light',
      position: { x: 2.15, y: 2.55, z: 3 }, temperatureK: 3000, enabled: true, heads: 5,
    }]);
    assert.deepEqual(projection.plumbing, facts.plumbing);
    assert.deepEqual(projection.ceiling, facts.ceiling);
    assert.deepEqual(projection.hvac, { status: 'unimplemented', planId: null });
    assert.deepEqual(projection.materials.floor, scheme.selections.floor);
    assert.equal(projection.version, '2.0');
    assert.equal(projection.lightingFixtures.find((fixture) => fixture.id === 'track_1')?.heads, 5);
    assert.equal(projection.lightingFixtures.find((fixture) => fixture.id === 'track_1')?.heads, 5);
    assert.deepEqual(projection.presentation.curtains.curtains.map((c) => c.id), ['curtain_living_south']);
    assert.equal(projection.presentation.curtains.effectiveByRoom.living, 'open');
    assert.deepEqual(facts.electrical[0], { id: 'light_1', room: 'living', type: 'dome', x: 1, z: 2, height: 2.8, temp: 4000, recessed: true });
  });

  it('preserves wall host and room-side normal inputs for wall lamps', () => {
    const wallFacts: ProjectRenderFacts = {
      ...facts,
      electrical: [
        ...facts.electrical,
        // parseElectricalPoints 的产出形态：wall_side 已投影为 wallSide（本测试不走 parser）
        { id: 'wall_1', room: 'living', type: 'wall_lamp', height: 1.35, wall: 'wall-east', wallSide: 'west', along: 0.5 },
      ],
    };
    const projection = buildProjectRenderFactsProjection(wallFacts, overrides('light_1', 'track_1', 'wall_1'), scheme, overlay, presentation, { fixtures: [] }, undefined, new Map([['wall-east', { segments: [{ x1: 5, z1: 0, x2: 5, z2: 10 }], line_datum: 'centerline' }]]));
    const wallLamp = projection.lightingFixtures.find((fixture) => fixture.id === 'wall_1');
    // issue #98 S3：挂墙灯具平面位置走解析器（along 0.5 自墙段起点 z=0 → datum (5,0.5)，
    // 完成面 = 5 − 半墙厚 0.06 = 4.94，再加 overrides.offsetX 0.15 → 5.09），不再读声明 x/z。
    assert.deepEqual(wallLamp, {
      id: 'wall_1', room: 'living', type: 'wall_lamp',
      // 派生锚点 = electrical.height(1.35) + anchorY_offset(-0.25)
      position: { x: 5.09, y: 1.1, z: 0.5 }, temperatureK: 3000, enabled: true,
      wallId: 'wall-east', wallSide: 'west',
    });
  });

  it('preserves ordered track head purposes in projection resolvedHeads', () => {
    const headPurposes = [
      { purpose: 'coffee_table' as const, role: '茶几重点照明' },
      { purpose: 'sofa' as const, role: '沙发重点照明' },
      { purpose: 'living_seating' as const, role: '客厅座区整体照明' },
      { purpose: 'living_south_or_corner' as const, role: '客厅南侧或角落补光' },
    ];
    const config = {
      id: 'track_1', type: 'track_light' as const, length: 2.8,
      heads: headPurposes.map((metadata, index) => ({
        offset: { x: index - 1, z: 0 }, target: { x: index, y: -2.2, z: index / 2 }, ...metadata,
      })),
      target_y_mode: 'relative' as const, direction: { x: 0, y: -1, z: 0 }, beam: 0.7, energy: 9,
      rotation: { x: 0, y: 0, z: 0 },
    };
    const projection = buildProjectRenderFactsProjection(facts, overrides('light_1', 'track_1'), scheme, overlay, presentation, { fixtures: [config] });
    const projectedTrack = projection.lighting?.fixtures.find((fixture): fixture is TrackLightConfig => fixture.id === 'track_1' && fixture.type === 'track_light');
    assert.deepEqual(projectedTrack?.heads.map(({ purpose, role }) => ({ purpose, role })), headPurposes);
    assert.deepEqual(projectedTrack?.resolvedHeads?.map(({ purpose, role }) => ({ purpose, role })), headPurposes);
  });

  it('preserves concrete plumbing, ceiling, and three floor overrides in the render projection', () => {
    const concreteFacts: ProjectRenderFacts = {
      electrical: [{ id: 'light_1', room: 'living', type: 'dome', x: 1, z: 2, height: 2.8 }],
      plumbing: [
        { id: 'faucet_mbath_vanity', room: 'master_bath', type: 'faucet', x: 2.6, z: 2.8 },
        { id: 'drain_kitchen_dishwasher', room: 'kitchen', type: 'drain', x: 9, z: 0.3 },
      ],
      ceiling: [
        { id: 'ceiling_kitchen', room: 'kitchen', type: 'aluminum_buckle', thickness: 0.15, area: [7.2, 0, 10.8, 4.3] },
      ],
      hvac: facts.hvac,
    };
    const concreteScheme: CurrentScheme = {
      updatedAt: '2026-08-23T00:00:00.000Z',
      selections: { floor: { default: 'floor_default', roomOverrides: {
        master_bath: 'floor_mb', guest_bath: 'floor_gb', balcony: 'floor_balcony',
      } } },
    };
    const projection = project(concreteFacts, [override()], concreteScheme);
    assert.deepEqual(projection.plumbing, concreteFacts.plumbing);
    assert.deepEqual(projection.ceiling, concreteFacts.ceiling);
    assert.deepEqual(projection.materials.floor, concreteScheme.selections.floor);
  });

  it('projects A2 only and never leaks its diagram into historical options', () => {
    const a2 = project(facts, overrides('light_1', 'track_1'), { ...scheme, selections: { ...scheme.selections, hvac: { default: 'A2', roomOverrides: {} } } });
    assert.equal(a2.hvac.status, 'implemented');
    assert.equal(a2.hvac.status === 'implemented' && a2.hvac.planId, 'A2');
    const archived = project(facts, overrides('light_1', 'track_1'), { ...scheme, selections: { ...scheme.selections, hvac: { default: 'A1', roomOverrides: {} } } });
    assert.deepEqual(archived.hvac, { status: 'unimplemented', planId: 'A1' });
    assert.equal('diagram' in archived.hvac, false);
  });

  it('strictly validates neighbor reference constraints and constrained routes', () => {
    const yaml = `plans:
  - id: A2
    kind: vrf_ducted
    outdoor: { id: outdoor_1, platform: platform, x: 1, z: 2, direction: south, width: 1, depth: 1, height: 1, model: VRF }
    diagram:
      anchors: []
      terminals: []
      reference_constraints:
        - id: neighbor_beam
          status: inferred
          source: survey/neighbor_ys01_original_structure_2025-06.png
          uncertainty_m: 0.15
          not_for_construction: true
          range: { x1: 1, x2: 2, z1: 3, z2: 3.2 }
          reference_beam_bottom_y: 2.65
          risk: net height
          reason: neighbor reference
          survey_confirmation: measure own beam
      routes: []
`;
    const parsed = parseProjectHvacFacts(yaml);
    assert.equal(parsed.plans[0].diagram.reference_constraints[0].status, 'inferred');
    assert.throws(() => parseProjectHvacFacts(yaml.replace('status: inferred', 'status: confirmed')), /Invalid option/);
    assert.throws(() => parseProjectHvacFacts(yaml.replace('          survey_confirmation: measure own beam\n', '')), /survey_confirmation/);
    const constrained = structuredClone(parsed);
    constrained.plans[0].diagram.anchors.push({ id: 'a', status: 'inferred', system: 'refrigerant', position: { x: 1, y: 2, z: 3 }, reason: 'test' });
    constrained.plans[0].diagram.anchors.push({ id: 'b', status: 'inferred', system: 'refrigerant', position: { x: 2, y: 2, z: 3 }, reason: 'test' });
    constrained.plans[0].diagram.routes.push({ id: 'route', status: 'confirmed', system: 'refrigerant', from: 'a', to: 'b', constraint_refs: ['neighbor_beam'], reason: 'test' });
    assert.throws(() => validateProjectHvacFacts(constrained, facts), /cannot be confirmed/);
    constrained.plans[0].diagram.routes[0].status = 'inferred';
    constrained.plans[0].diagram.routes[0].constraint_refs = ['missing'];
    assert.throws(() => validateProjectHvacFacts(constrained, facts), /unknown constraint/);
  });

  it('parses access-panel terminals with serves_unit through the hvac schema', () => {
    // DEC-2026-10-27-R03：serves_unit 必须经 schema 落到投影（strict 模式下未登记字段会被拒）。
    const yaml = `plans:
  - id: A2
    kind: vrf_ducted
    outdoor: { id: outdoor_1, platform: platform, x: 1, z: 2, direction: south, width: 1, depth: 1, height: 1, model: VRF }
    diagram:
      anchors: []
      terminals:
        - id: access_parent_side
          status: inferred
          system: access
          position: { x: 5.75, y: 2.65, z: 6.45 }
          mount_face: south
          length: 0.6
          grille_height: 0.25
          serves_unit: ac_parent
          reason: test
      reference_constraints: []
      routes: []
`;
    const parsed = parseProjectHvacFacts(yaml);
    const terminal = parsed.plans[0].diagram.terminals[0];
    assert.equal(terminal.serves_unit, 'ac_parent');
    assert.equal(terminal.length, 0.6);
    assert.equal(terminal.grille_height, 0.25);
    assert.equal(terminal.mount_face, 'south');
  });

  it('rejects missing, unknown, non-lighting, and duplicate overrides', () => {
    assert.throws(() => project(facts, [], scheme), /Missing render override/);
    assert.throws(() => project(facts, [override('unknown')], scheme), /unknown electrical id/);
    assert.throws(() => project(facts, [override('socket_1')], scheme), /does not reference a lighting fixture/);
    assert.throws(() => project(facts, [override(), override()], scheme), /Duplicate render override/);
  });
});

// ── 服务端投影调用点必须同时传两个宿主索引（issue #98 S3 回归锚）──────────────
// 失效形态：buildProjectRenderFactsProjection 的第 7 参（mountHosts）与第 8 参
// （pointWalls）都可选。漏传第 8 参**不会静默降级**——shared/lighting-fixtures.ts
// 对解不出宿主墙的挂墙灯直接 throw（「调用方须提供 pointWalls」），路由转 503。
// server/index.ts 曾只传第 7 参（Codex 在总 PR #122 上抓到的 blocking）。
// 这里读源码钉住两个索引都在调用点上传入，防再漏。
it('server/index.ts 的投影调用点同时传入 mountHosts 与 pointWalls', () => {
  const src = readFileSync('server/index.ts', 'utf8');
  const start = src.indexOf('getProjectRenderFactsProjection: () => {');
  assert.ok(start >= 0, '找不到 getProjectRenderFactsProjection');
  const call = src.slice(start, src.indexOf('\n  },', start));
  assert.match(call, /pointMountHostIndex\(/, '必须传 mountHosts（第 7 参）');
  assert.match(call, /pointWallIndexFromElements\(catalog\.getWalls\(\)\)/, '必须传 pointWalls（第 8 参）——漏传则挂墙灯解算抛错');
});
