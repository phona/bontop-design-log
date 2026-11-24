// tests/server/pipe-box-blocker-gate.test.ts
//
// Codex review 5935989455（PR #259 第二轮）的 blocking 项：pipe_box 绕过了
// blocker 完整性门禁——
//   ① overlay schema 允许 pending/undeclared 的盒不带 blocker；
//   ② pipe_box 不进 collectElements()，checkBlockers 永远看不到它；
//   ③ pending-carriers 的载体行在盒缺 blocker 时合成一个 fallback blocker，
//      待决视图看起来「已登记属主」，实则掩盖了缺失的真实声明。
//
// 本文件钉死修复后的三道防线：schema 拒收、采集进门禁、载体不合成。
// 反向锚：每道防线都有「抹掉 blocker 必须红」的用例，不是恒真式。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseOverlay } from '../../server/overlay-merge.js';
import { collectElements } from '../../shared/element-sources.js';
import { deriveElementStates, type ElementInput } from '../../shared/element-state.js';
import {
  checkBlockers,
  formatBlockerIssue,
  type BlockerSubject,
} from '../../shared/element-blockers.js';
import { collectRows } from '../../scripts/docs/generate-pending-view.js';
import { buildPipeBoxPendingRow, parsePipeBoxPendingItem } from '../../shared/pending-carriers.js';

const REAL_BLOCKER = `
    blocker:
      kind: site_measurement
      owner: [业主]
      trigger: 2026-11-27 量房
      reverses_if: 实测后按结果回改或销号
      rationale: 立管实位未经实测`;

function pipeBoxYaml(extra: string): string {
  return `
version: 1
elements:
  - id: box_test
    type: pipe_box
    room: master_bath
    riser: drain_riser_master_bath
    width: 0.20
    depth: 0.20
    faces: 2
    bottom: 0
    top: 2.50
${extra}`;
}

describe('pipe_box schema：未确认状态无 blocker 即拒收（Codex blocking）', () => {
  // 未确认 = pending / undeclared / inferred / likely / 缺省 status。
  // 只有实测（measured）与已确认（confirmed）的盒可以不带 blocker。
  for (const status of ['pending', 'undeclared', 'inferred', 'likely']) {
    it(`status=${status} 且无 blocker → parse 抛错`, () => {
      assert.throws(() => parseOverlay(pipeBoxYaml(`    status: ${status}\n`)), /blocker/);
    });
  }

  it('缺省 status 且无 blocker → parse 抛错', () => {
    assert.throws(() => parseOverlay(pipeBoxYaml('')), /blocker/);
  });

  it('status=measured 且无 blocker → 通过（已实测，无未决口径）', () => {
    const cfg = parseOverlay(pipeBoxYaml('    status: measured\n'));
    assert.equal(cfg.elements.length, 1);
  });

  it('status=confirmed 且无 blocker → 通过（已裁定，无未决口径）', () => {
    const cfg = parseOverlay(pipeBoxYaml('    status: confirmed\n'));
    assert.equal(cfg.elements.length, 1);
  });

  it('status=pending + 真实 blocker → 通过', () => {
    const cfg = parseOverlay(pipeBoxYaml(`    status: pending\n${REAL_BLOCKER}\n`));
    assert.equal(cfg.elements.length, 1);
  });

  it('status=inferred + 真实 blocker → 通过（生产 3 盒即此形态）', () => {
    const cfg = parseOverlay(pipeBoxYaml(`    status: inferred\n${REAL_BLOCKER}\n`));
    assert.equal(cfg.elements.length, 1);
  });
});

describe('pipe_box 进 collectElements：门禁看得见它', () => {
  const BOX_IDS = [
    'pipe_box:pipe_box_mbath_riser',
    'pipe_box:pipe_box_gbath_riser',
    'pipe_box:pipe_box_kitchen_riser',
  ];

  it('采集到生产 3 盒，带真实 blocker（非合成）', () => {
    const elements = collectElements();
    const byId = new Map(elements.map((item) => [item.id, item]));
    for (const id of BOX_IDS) {
      const box = byId.get(id);
      assert.ok(box, `${id} 必须被采集到`);
      assert.equal(box.kind, 'pipe_box');
      assert.equal(box.configStatus, 'inferred');
      assert.ok(box.blocker, `${id} 必须带对象本体声明的 blocker`);
      assert.deepEqual(box.blocker!.owner, ['业主']);
      assert.match(box.blocker!.trigger, /2026-11-27 量房/);
    }
  });

  it('生产 3 盒派生为 inferred，不进 pending/undeclared 门禁计数（39 不变）', () => {
    const elements = collectElements();
    const result = deriveElementStates({ elements, issues: [] });
    const statusById = new Map(result.states.map((state) => [state.id, state.status]));
    for (const id of BOX_IDS) assert.equal(statusById.get(id), 'inferred');
    const gate = checkBlockers(elements as BlockerSubject[], (subject) => statusById.get(subject.id));
    assert.equal(gate.checked, 39, `受门禁管辖的 pending/undeclared 构件数仍为 39：${gate.checked}`);
    assert.deepEqual(gate.issues.map((issue) => formatBlockerIssue(issue)), [], '门禁仍全绿');
  });

  it('反向锚：门禁不是恒真式——合成一个无 blocker 的 pending 盒必须报红', () => {
    const synthetic: ElementInput[] = [
      {
        id: 'pipe_box:box_no_blocker',
        kind: 'pipe_box',
        label: '包管盒 box_no_blocker',
        room: 'master_bath',
        configStatus: 'pending',
      },
      {
        id: 'pipe_box:box_with_blocker',
        kind: 'pipe_box',
        label: '包管盒 box_with_blocker',
        room: 'master_bath',
        configStatus: 'pending',
        blocker: {
          kind: 'site_measurement',
          owner: ['业主'],
          trigger: '2026-11-27 量房',
          reverses_if: '实测后按结果回改或销号',
          rationale: '立管实位未经实测',
        },
      },
    ];
    const result = deriveElementStates({ elements: synthetic, issues: [] });
    const statusById = new Map(result.states.map((state) => [state.id, state.status]));
    const gate = checkBlockers(synthetic as BlockerSubject[], (subject) => statusById.get(subject.id));
    assert.equal(gate.checked, 2);
    assert.ok(
      gate.issues.some((issue) => issue.id === 'pipe_box:box_no_blocker' && issue.code === 'blocker_missing'),
      '无 blocker 的 pending 盒必须报 blocker_missing',
    );
    assert.ok(
      !gate.issues.some((issue) => issue.id === 'pipe_box:box_with_blocker'),
      '带真实 blocker 的盒不得报红',
    );
  });
});

describe('pipe_box 载体行：缺 blocker 即抛错，不许合成 fallback（Codex blocking）', () => {
  const BOX = {
    id: 'pipe_box_mbath_riser',
    room: 'master_bath',
    riser: 'drain_riser_master_bath',
    pipes: 1,
    width: 0.2,
    depth: 0.2,
    faces: 2,
    bottom: 0,
    top: 2.5,
    status: 'inferred',
    note: '立管实位未经实测',
  };

  it('无 blocker → 抛错（此前会合成 owner 量房的 fallback 行）', () => {
    assert.throws(() => buildPipeBoxPendingRow(BOX), /未声明 blocker/);
  });

  it('有 blocker → 原样采用，不合成、不改写', () => {
    const blocker = {
      kind: 'site_measurement',
      owner: ['业主'],
      trigger: '2026-11-27 量房',
      reverses_if: '实测后按结果回改或销号',
      rationale: '立管实位未经实测',
    } as const;
    const row = buildPipeBoxPendingRow({ ...BOX, blocker: { ...blocker, owner: ['业主'] } });
    assert.equal(row.id, 'pipe_box:pipe_box_mbath_riser');
    assert.deepEqual(row.blocker.owner, ['业主']);
    assert.match(row.blocker.trigger, /2026-11-27 量房/);
    assert.ok(row.measure.includes('drain_riser_master_bath'));
  });

  it('缺省 status 的盒 → 载体行 status=undeclared（Codex review 5937110969 minor；与 element-state 缺省派生一致）', () => {
    const blocker = {
      kind: 'site_measurement',
      owner: ['业主'],
      trigger: '2026-11-27 量房',
      reverses_if: '实测后按结果回改或销号',
      rationale: '立管实位未经实测',
    } as const;
    const { status, ...noStatus } = BOX;
    assert.equal(status, 'inferred', '本用例的前提：BOX 声明了 inferred，要测的是去掉它');
    const row = buildPipeBoxPendingRow({ ...noStatus, blocker: { ...blocker, owner: ['业主'] } });
    assert.equal(row.status, 'undeclared');
    assert.match(row.currentValue, /status=undeclared/);
  });

  it('缺省 status 且无 blocker → 抛错文案也写 undeclared，不写 inferred', () => {
    const { status, ...noStatus } = BOX;
    assert.equal(status, 'inferred', '本用例的前提：BOX 声明了 inferred，要测的是去掉它');
    assert.throws(() => buildPipeBoxPendingRow(noStatus), /status=undeclared/);
  });
});

describe('待决视图：pipe_box 不重复、不合成（载体行胜出）', () => {
  it('pipe_box 恰好 3 行、id 唯一、每行都有载体的 measure 文本', () => {
    const rows = collectRows();
    const boxes = rows.filter((row) => row.id.startsWith('pipe_box:'));
    assert.equal(boxes.length, 3, `pipe_box 行数：${boxes.map((row) => row.id).join(', ')}`);
    assert.equal(new Set(boxes.map((row) => row.id)).size, 3, 'pipe_box 行 id 不得重复');
    for (const row of boxes) {
      assert.ok(row.measure, `${row.id} 必须带载体的 measure（量什么 + 当前推断），不是采集侧的空行`);
      assert.deepEqual(row.blocker.owner, ['业主'], `${row.id} 的 blocker 必须是对象声明的业主，不是合成的量房`);
    }
  });

  it('全视图 id 唯一：采集侧与载体侧不得对同一构件各出一行', () => {
    const rows = collectRows();
    const ids = rows.map((row) => row.id);
    assert.equal(new Set(ids).size, ids.length, '待决视图不得有重复 id');
    assert.equal(rows.length, 99, `待决条目总数仍为 99：${rows.length}`); // 2026-11-23 通长假梁：ceiling_master_beam（板底实测）+ ac_master（厂家图 #39）新增 blocker；2026-11-24 electrical:sock_master_ac 补 blocker（精确位置待 #39，status 仍为 inferred）后待决视图多这一行
  });
});

describe('pipe_box 省略 pipes 即单管，不炸待决视图（Codex review 5936494593 major）', () => {
  // PipeBoxSchema 把 pipes 声明为 .default(1)，省略是 schema 合法写法；
  // 但载体直读曾用 requireNumber，省略即抛错，整份待决清单都生成不了。
  // 反向锚：非法管数仍必须红，不是恒真式。
  const BLOCKER = {
    kind: 'site_measurement',
    owner: ['业主'],
    trigger: '2026-11-27 量房',
    reverses_if: '实测后按结果回改或销号',
    rationale: '立管实位未经实测',
  } as const;
  const RECORD = {
    id: 'pipe_box_mbath_riser',
    type: 'pipe_box',
    room: 'master_bath',
    riser: 'drain_riser_master_bath',
    width: 0.2,
    depth: 0.2,
    faces: 2,
    bottom: 0,
    top: 2.5,
    status: 'inferred',
    note: '立管实位未经实测',
    blocker: { ...BLOCKER, owner: ['业主'] },
  } as Record<string, unknown>;

  it('省略 pipes → 解析为 1，载体行渲染为单管，不抛错', () => {
    const { pipes, ...rest } = RECORD;
    assert.equal(pipes, undefined, '本用例的前提：记录确实省略了 pipes');
    const source = parsePipeBoxPendingItem(rest, 'config/model/envelope/openings.yaml');
    assert.equal(source.pipes, 1);
    const row = buildPipeBoxPendingRow(source);
    assert.equal(row.id, 'pipe_box:pipe_box_mbath_riser');
    assert.match(row.currentValue, /^单管 0\.20×0\.20m/);
  });

  it('pipes: 2 → 解析为 2，渲染为双管', () => {
    const source = parsePipeBoxPendingItem({ ...RECORD, pipes: 2 }, 'config/model/envelope/openings.yaml');
    assert.equal(source.pipes, 2);
    const row = buildPipeBoxPendingRow(source);
    assert.match(row.currentValue, /^双管 0\.20×0\.20m/);
  });

  it('反向锚：pipes 为字符串仍抛错（不许悄悄当成数字）', () => {
    assert.throws(
      () => parsePipeBoxPendingItem({ ...RECORD, pipes: '1' }, 'config/model/envelope/openings.yaml'),
      /pipes 缺有限数字段/,
    );
  });

  it('反向锚：pipes 为 3 仍抛错（schema 只接受 1/2）', () => {
    assert.throws(
      () => parsePipeBoxPendingItem({ ...RECORD, pipes: 3 }, 'config/model/envelope/openings.yaml'),
      /只能是 1（单管）或 2（双管）/,
    );
  });
});
