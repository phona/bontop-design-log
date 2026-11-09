// 交付闭合性断言守门测试（issue #98 疗法①，方案见 PR #122 §一.1 / §三.1）。
//
// 不变量：交付时，任何被交付点位声明的物理宿主，必须存在于定位宿主表中。
// 这条断言把「点在场、宿主不在表」从静默错位变成当场报错——16 轮审查 A 类 12 条
// finding（11 blocking）都是它无人守护的反复采样。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { assertPlacementHostClosure, collectPlacementHostClosureViolations, type PlacementClosurePoint } from '../../server/placement-closure.js';
import { pointMountHostIndex } from '../../shared/point-placement.js';
import { parseElectricalPoints, parsePlumbingPoints } from '../../shared/project-render-facts-schema.js';
import type { PlacementItem } from '../../shared/furniture-placement.js';

const read = (relative: string): string => readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');

/** 全量 furnishings 的定位宿主表（与 /api/project 的 house.furnishingsAll 同构造）。 */
const hostIndexFromHouse = (): ReturnType<typeof pointMountHostIndex> => {
  const house = parseYaml(read('config/house.yaml')) as { furnishings?: Record<string, PlacementItem[]> };
  return pointMountHostIndex(Object.values(house.furnishings ?? {}).flat());
};

const point = (id: string, mount?: { furniture_id: string }): PlacementClosurePoint => ({ id, mount });

describe('placement closure assertion (issue #98 疗法①)', () => {
  it('passes when every declared mount host is in the table with plane geometry', () => {
    const hosts = hostIndexFromHouse();
    assert.doesNotThrow(() => assertPlacementHostClosure(
      [
        point('night_corridor', { furniture_id: 'ld.wall_cabinet_tall' }),
        point('night_mid_corridor', { furniture_id: 'ld.entry_half_height_cabinet' }),
        point('sock_plain'), // 无 mount 的点位不参与闭合性
      ],
      [],
      hosts,
    ));
  });

  it('throws naming the point and the missing host (no silent skip)', () => {
    const hosts = hostIndexFromHouse();
    assert.throws(
      () => assertPlacementHostClosure([point('night_corridor', { furniture_id: 'ld.ghost_cabinet' })], [], hosts),
      (err: Error) => {
        assert.match(err.message, /交付闭合性断言失败/);
        assert.match(err.message, /电气点位 night_corridor/);
        assert.match(err.message, /ld\.ghost_cabinet/);
        // 错误信息必须给出可能的原因，便于定位是阶段过滤还是断引用
        assert.match(err.message, /宿主被阶段过滤/);
        assert.match(err.message, /断引用/);
        return true;
      },
    );
  });

  it('throws when the host is in the table but has no plane geometry (count-only)', () => {
    // count-only 条目照样进索引（pointMountHostIndex 的设计），但无 x/z 解不出宿主脸——
    // 挂载必然失败，交付前拦下，不留给解算器诊断再被消费方降级。
    const hosts = hostIndexFromHouse();
    hosts.set('ld.count_only', { id: 'ld.count_only' });
    assert.throws(
      () => assertPlacementHostClosure([point('night_x', { furniture_id: 'ld.count_only' })], [], hosts),
      (err: Error) => {
        assert.match(err.message, /给排水|电气点位 night_x/);
        assert.match(err.message, /count-only 条目无 x\/z/);
        return true;
      },
    );
  });

  it('throws on a mount declaration without furniture_id', () => {
    const hosts = hostIndexFromHouse();
    assert.throws(
      () => assertPlacementHostClosure([{ id: 'night_y', mount: {} as { furniture_id: string } }], [], hosts),
      /mount 声明缺 furniture_id/,
    );
  });

  it('reports every violation in one throw (fix one, see the next)', () => {
    const hosts = hostIndexFromHouse();
    assert.throws(
      () => assertPlacementHostClosure(
        [point('a', { furniture_id: 'ld.ghost_a' }), point('b', { furniture_id: 'ld.ghost_b' })],
        [point('p', { furniture_id: 'ld.ghost_p' })],
        hosts,
      ),
      (err: Error) => {
        assert.match(err.message, /共 3 条/);
        assert.match(err.message, /给排水点位 p/);
        return true;
      },
    );
  });

  it('holds for the shipped config (regression anchor: delivery is closed today)', () => {
    // 真实配置必须闭合——/api/project 每次请求都跑这条断言（见 server/routes.ts），
    // 配置一旦漂移（点位挂了不存在的宿主）这里先炸，而不是等页面静默缺标注。
    const electrical = parseElectricalPoints(read('config/electrical.yaml'));
    const plumbing = parsePlumbingPoints(read('config/plumbing.yaml'));
    assert.doesNotThrow(() => assertPlacementHostClosure(electrical, plumbing, hostIndexFromHouse()));
  });
});

describe('collectPlacementHostClosureViolations（宽容读取：收集诊断不抛，issue #98 + PR #122 深审修复）', () => {
  it('returns [] for a closed delivery', () => {
    const hosts = hostIndexFromHouse();
    assert.deepEqual(collectPlacementHostClosureViolations(
      [point('night_corridor', { furniture_id: 'ld.wall_cabinet_tall' })],
      [],
      hosts,
    ), []);
  });

  it('returns structured violations naming kind/point/host (does not throw)', () => {
    const hosts = hostIndexFromHouse();
    const violations = collectPlacementHostClosureViolations(
      [point('night_corridor', { furniture_id: 'ld.ghost_cabinet' })],
      [point('sink_trap', { furniture_id: 'gb.ghost_vanity' })],
      hosts,
    );
    assert.equal(violations.length, 2);
    assert.deepEqual(
      { kind: violations[0].kind, pointId: violations[0].pointId, hostId: violations[0].hostId },
      { kind: 'electrical', pointId: 'night_corridor', hostId: 'ld.ghost_cabinet' },
    );
    assert.deepEqual(
      { kind: violations[1].kind, pointId: violations[1].pointId, hostId: violations[1].hostId },
      { kind: 'plumbing', pointId: 'sink_trap', hostId: 'gb.ghost_vanity' },
    );
    // 人读诊断点名点位、宿主与可能原因（/api/project 的 placementClosureDiagnostics 就用它）
    assert.match(violations[0].message, /电气点位 night_corridor/);
    assert.match(violations[0].message, /ld\.ghost_cabinet/);
    assert.match(violations[0].message, /宿主被阶段过滤/);
    assert.match(violations[1].message, /给排水点位 sink_trap/);
  });

  it('assert message is built from the collected violations (one checker, two dispositions)', () => {
    const hosts = hostIndexFromHouse();
    const input = {
      electrical: [point('a', { furniture_id: 'ld.ghost_a' })],
      plumbing: [point('p', { furniture_id: 'gb.ghost_p' })],
      hosts,
    };
    const violations = collectPlacementHostClosureViolations(input.electrical, input.plumbing, input.hosts);
    assert.throws(
      () => assertPlacementHostClosure(input.electrical, input.plumbing, input.hosts),
      (err: Error) => {
        // 聚合错误逐条包含 collect 的每条 message（同一套检查、两种处置：页面收集 / 交付抛）
        for (const v of violations) assert.match(err.message, new RegExp(v.message.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        return true;
      },
    );
  });
});
