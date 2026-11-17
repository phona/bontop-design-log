import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildHvacEntityDescriptors } from '../../shared/render/HvacBuilder.js';
import type { ElectricalPoint, HvacDiagram } from '../../shared/types.js';

// PR #260 第五轮修复（Codex review 5939681715 major）：暖通 anchor 的 electrical ref
// 指向 along_host 点位时，resolveAnchor 不传 siblings——派生点位解不出、锚点实体被记诊断
// 跳过。修复后 siblings 取自 sources.electrical（与 InfrastructureBuilder / mep-hvac-lint
// 同口径）。注：既有 shared/render/HvacBuilder.test.ts 不被任何套件执行（test:server 只
// 跑 tests/server/**，test:app 只跑 app/ 内 vitest），故本回归放 tests/server/。
describe('HvacBuilder along_host electrical ref', () => {
  it('resolves an anchor whose electrical ref is an along_host point', () => {
    const pointWalls = new Map([['w_test', { segments: [{ x1: 4, z1: 0, x2: 4, z2: 10 }], line_datum: 'centerline' as const }]]);
    const electrical: ElectricalPoint[] = [
      { id: 'sock_ac_host', room: 'living', type: 'socket', wall: 'w_test', wallSide: 'west', along: 2, height: 0.3 },
      { id: 'sock_ac_derived', room: 'living', type: 'socket', wallSide: 'west', along_host: { id: 'sock_ac_host', offset: 0.5 }, height: 0.3 },
    ];
    const diagram: HvacDiagram = {
      anchors: [{ id: 'indoor_ac', status: 'confirmed', system: 'refrigerant', ref: { source: 'electrical', id: 'sock_ac_derived' } }],
      terminals: [],
      routes: [],
      reference_constraints: [],
    };
    const diagnostics: string[] = [];
    const entities = buildHvacEntityDescriptors('A2', diagram, { electrical, pointWalls, mountHosts: new Map() }, diagnostics);
    assert.deepEqual(diagnostics, []);
    assert.equal(entities.length, 1);
    assert.equal(entities[0].objectId, 'hvac:A2:anchor:indoor_ac');
    // 宿主沿墙 along 2 → 派生 along 2.5；完成面 x = 墙线 4 − 半墙厚 0.06；y = 点位 height
    assert.deepEqual(entities[0].position, { x: 3.94, y: 0.3, z: 2.5 });
  });

  it('still surfaces a diagnostic when the along_host ref is broken', () => {
    const pointWalls = new Map([['w_test', { segments: [{ x1: 4, z1: 0, x2: 4, z2: 10 }], line_datum: 'centerline' as const }]]);
    const electrical: ElectricalPoint[] = [
      { id: 'sock_ac_derived', room: 'living', type: 'socket', wallSide: 'west', along_host: { id: 'no_such_point', offset: 0.5 }, height: 0.3 },
    ];
    const diagram: HvacDiagram = {
      anchors: [{ id: 'indoor_ac', status: 'confirmed', system: 'refrigerant', ref: { source: 'electrical', id: 'sock_ac_derived' } }],
      terminals: [],
      routes: [],
      reference_constraints: [],
    };
    const diagnostics: string[] = [];
    const entities = buildHvacEntityDescriptors('A2', diagram, { electrical, pointWalls, mountHosts: new Map() }, diagnostics);
    assert.equal(entities.length, 0);
    assert.equal(diagnostics.length, 1);
    assert.match(diagnostics[0], /no_such_point/);
  });
});
