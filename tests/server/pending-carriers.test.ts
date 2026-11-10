// 待决视图载体覆盖的回归测试（2026-11-10 修 Codex major）。
//
// 守两件事：
// ① `config/layout/model-geometry.yaml` 的 `beams`（旧手账 #1 的迁入载体）逐条进量房清单，
//    每行带梁位/梁宽/梁底、推断值、not_for_construction 与量房 owner；
// ② 覆盖自检从「已采集 rows 的内部并集」升级为「源侧逐条对账」：把梁体整类从 rows 拿掉，
//    自检必须报缺 7 条——这正是原实现发现不了的形态（它没有源侧条目可对账）。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { collectRows } from '../../scripts/docs/generate-pending-view.js';
import {
  PENDING_CARRIERS,
  checkCarrierCoverage,
  findUnregisteredPendingSections,
} from '../../shared/pending-carriers.js';

describe('待决视图载体覆盖', () => {
  it('beams 逐条进入量房清单，字段完整且标明推断', () => {
    const rows = collectRows();
    const beams = rows.filter((row) => row.id.startsWith('layout:beam:'));
    const carrier = PENDING_CARRIERS.find((item) => item.id === 'layout:beams');
    assert.ok(carrier, '载体表必须登记 layout:beams');
    assert.equal(beams.length, 7); // 4 条结构梁推断 + 3 条指针式登记
    assert.equal(beams.length, carrier.pendingIds().length);
    for (const row of beams) {
      assert.equal(row.kind, 'beam');
      assert.equal(row.status, 'inferred');
      assert.deepEqual(row.blocker.owner, ['量房']);
      assert.match(row.blocker.trigger, /交房量房/);
      assert.match(row.blocker.trigger, /梁位/);
      assert.match(row.blocker.trigger, /梁宽/);
      assert.match(row.blocker.trigger, /梁底/);
      assert.ok(row.measure, `${row.id} 缺「量什么/当前值」`);
      assert.match(row.measure, /梁位/);
      assert.match(row.measure, /梁宽/);
      assert.match(row.measure, /梁底/);
      assert.match(row.measure, /推断/);
      assert.match(row.measure, /not_for_construction=true/);
    }
  });

  it('hvac reference_constraints 逐条进入量房清单（梁底读数的权威副本）', () => {
    const rows = collectRows();
    const refs = rows.filter((row) => row.id.startsWith('hvac:ref:'));
    assert.equal(refs.length, 11);
    for (const row of refs) {
      assert.deepEqual(row.blocker.owner, ['量房']);
      assert.match(row.blocker.trigger, /交房量房/);
      assert.match(row.measure ?? '', /梁底/);
      assert.match(row.measure ?? '', /not_for_construction=true/);
    }
  });

  it('给排水 construction_status: pending 的点位不再整类漏出清单', () => {
    const rows = collectRows();
    const ids = new Set(rows.map((row) => row.id));
    for (const id of ['plumbing:drain_riser_master_bath', 'plumbing:toilet_mbath', 'plumbing:water_entry']) {
      assert.ok(ids.has(id), `${id} 应进入量房清单`);
    }
  });

  it('反向锚：梁体整类缺席必须被自检报出来（原实现发现不了）', () => {
    const rows = collectRows();
    const withoutBeams = new Set(rows.filter((row) => !row.id.startsWith('layout:beam:')).map((row) => row.id));
    const issues = checkCarrierCoverage(withoutBeams);
    const beamIssue = issues.find((issue) => issue.carrier === 'layout:beams');
    assert.ok(beamIssue, '梁体整类被拿掉时自检必须报错');
    assert.equal(beamIssue.missing.length, 7);
    assert.ok(beamIssue.missing.every((id) => id.startsWith('layout:beam:')));
  });

  it('正向：全部现役载体的 pending 条目都在清单里', () => {
    const rows = collectRows();
    assert.deepEqual(checkCarrierCoverage(new Set(rows.map((row) => row.id))), []);
  });

  it('config 里没有未登记的 pending 载体段', () => {
    assert.deepEqual(findUnregisteredPendingSections(), []);
  });

  it('反向锚：新增一段 pending 语义但没登记时，反向扫描必须报出来', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pending-carriers-'));
    try {
      mkdirSync(path.join(dir, 'model'));
      writeFileSync(
        path.join(dir, 'model', 'probe.yaml'),
        ['items:', '  - id: probe_beam', '    status: pending', '    not_for_construction: true', ''].join('\n'),
      );
      const found = findUnregisteredPendingSections(dir);
      const issue = found.find((entry) => entry.section === 'items');
      assert.ok(issue, '未登记的 pending 段必须被报出来');
      assert.deepEqual(issue.ids, ['probe_beam']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
