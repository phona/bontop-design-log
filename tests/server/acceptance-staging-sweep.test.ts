// 暂存区启动清扫的回归测试（issue #84，2026-11-04）。
// 守：planStagingSweep 的年龄口径（7 天整点边界算年轻——宁可不清；严格超龄才删）；
// sweepAcceptanceStaging 只碰 acceptance-staging 自己、暂存区不存在不报错、删除失败
// 只记日志继续、超龄目录里含年轻文件时整树不删；启动日志把「扫了几个/删了几个/
// 为什么」显形（tmp/ 被 .gitignore，业主不可见，无声堆积就是这么来的）。
// clearStaging 的现有语义（submit 成功后清）由 acceptance-routes.test.ts 守，不在这里重复。

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  STAGING_SWEEP_MAX_AGE_MS, planStagingSweep, sweepAcceptanceStaging,
  type StagingSweepEntry,
} from '../../server/acceptance-draft-store.js';

const DAY_MS = 86_400_000;
// 造时钟：固定 nowMs，所有「几天前」都相对它算，测试不依赖真实时间
const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);
const STAGING_REL = 'tmp/capture/acceptance-staging';

const tempRoots: string[] = [];

/** 造一个假仓库根：<root>/tmp/capture/acceptance-staging 已存在。 */
function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'acceptance-sweep-'));
  tempRoots.push(root);
  mkdirSync(join(root, STAGING_REL), {recursive: true});
  return root;
}

function stagingOf(root: string): string {
  return join(root, STAGING_REL);
}

function writeEntry(root: string, rel: string, content = 'x'): void {
  const target = join(stagingOf(root), rel);
  mkdirSync(join(target, '..'), {recursive: true});
  writeFileSync(target, content);
}

/** 把条目（文件或目录）的 mtime 设成 daysAgo 天前。 */
function ageEntry(root: string, rel: string, daysAgo: number): void {
  const when = new Date(NOW - daysAgo * DAY_MS);
  utimesSync(join(stagingOf(root), rel), when, when);
}

function collectLog(): {lines: string[]; log: (line: string) => void} {
  const lines: string[] = [];
  return {lines, log: (line: string) => lines.push(line)};
}

after(() => {
  for (const root of tempRoots) {
    // 清理前把可能被 chmod 锁住的目录恢复可写，否则 rmSync 自己也会 EACCES
    try {
      for (const rel of readdirSync(stagingOf(root), {recursive: true}) as string[]) {
        chmodSync(join(stagingOf(root), rel), 0o700);
      }
    } catch { /* 临时目录读不到就算了 */ }
    rmSync(root, {recursive: true, force: true});
  }
});

describe('planStagingSweep：按年龄切分（纯函数）', () => {
  const entry = (path: string, daysAgo: number): StagingSweepEntry => ({path, mtimeMs: NOW - daysAgo * DAY_MS});

  it('正好 7 天整点算年轻——保留（宁可不清）', () => {
    const plan = planStagingSweep([entry('PKG-060/check_tile_gap/a.jpg', 7)], NOW, STAGING_SWEEP_MAX_AGE_MS);
    assert.deepEqual(plan.keep, ['PKG-060/check_tile_gap/a.jpg']);
    assert.deepEqual(plan.remove, []);
  });

  it('差 1ms 超龄才删；更老的一律删', () => {
    const plan = planStagingSweep([
      entry('a.jpg', 7 + 1 / DAY_MS),   // 7 天 + 1ms
      entry('b.jpg', 30),
      entry('c.jpg', 365),
    ], NOW, STAGING_SWEEP_MAX_AGE_MS);
    assert.deepEqual(plan.remove, ['a.jpg', 'b.jpg', 'c.jpg']);
    assert.deepEqual(plan.keep, []);
  });

  it('年轻的（含未来时间戳/时钟回拨）一律保留', () => {
    const plan = planStagingSweep([
      entry('fresh.jpg', 0),
      entry('yesterday.jpg', 1),
      entry('almost.jpg', 6.9),
      {path: 'future.jpg', mtimeMs: NOW + 5 * DAY_MS},
    ], NOW, STAGING_SWEEP_MAX_AGE_MS);
    assert.deepEqual(plan.keep, ['fresh.jpg', 'yesterday.jpg', 'almost.jpg', 'future.jpg']);
    assert.deepEqual(plan.remove, []);
  });

  it('混合场景：老的删、年轻的留，输入数组不被改写', () => {
    const entries = [entry('old/a.jpg', 10), entry('new/a.jpg', 2), entry('boundary/a.jpg', 7)];
    const snapshot = entries.map((item) => ({...item}));
    const plan = planStagingSweep(entries, NOW, STAGING_SWEEP_MAX_AGE_MS);
    assert.deepEqual(plan.remove, ['old/a.jpg']);
    assert.deepEqual(plan.keep, ['new/a.jpg', 'boundary/a.jpg']);
    assert.deepEqual(entries, snapshot, '纯函数不得修改入参');
  });

  it('空清单 → 两边都空；maxAgeMs 由调用方注入', () => {
    assert.deepEqual(planStagingSweep([], NOW, STAGING_SWEEP_MAX_AGE_MS), {keep: [], remove: []});
    // 注入 1 天阈值：2 天前的条目立刻超龄
    assert.deepEqual(planStagingSweep([entry('a.jpg', 2)], NOW, DAY_MS).remove, ['a.jpg']);
  });
});

describe('sweepAcceptanceStaging：启动清扫入口', () => {
  it('超龄暂存整目录删掉，年轻的整个留下', () => {
    const root = makeRoot();
    writeEntry(root, 'PKG-060/check_tile_gap/a.jpg');
    writeEntry(root, 'PKG-060/check_tile_gap/b.jpg');
    writeEntry(root, 'PKG-900/SCH-900-01/c.jpg');
    ageEntry(root, 'PKG-060/check_tile_gap/a.jpg', 10);
    ageEntry(root, 'PKG-060/check_tile_gap/b.jpg', 9);
    ageEntry(root, 'PKG-900/SCH-900-01/c.jpg', 1);
    // 目录 mtime 后设（写子文件会把父目录 mtime 推到当前）
    ageEntry(root, 'PKG-060/check_tile_gap', 10);
    ageEntry(root, 'PKG-060', 10);
    ageEntry(root, 'PKG-900/SCH-900-01', 1);
    ageEntry(root, 'PKG-900', 1);

    const {lines, log} = collectLog();
    const result = sweepAcceptanceStaging({root, nowMs: NOW, log});

    assert.equal(result.existed, true);
    assert.equal(result.removed, 4, '两个超龄文件 + 两个超龄目录（删空后连带删除）');
    assert.equal(result.kept, 3, 'PKG-900 的文件与两层目录都年轻');
    assert.equal(result.failures.length, 0);
    assert.ok(!existsSync(join(stagingOf(root), 'PKG-060')), '超龄暂存目录必须没了');
    assert.ok(existsSync(join(stagingOf(root), 'PKG-900/SCH-900-01/c.jpg')), '年轻暂存必须原样');
    // 日志一行：扫了几个、删了几个、为什么
    assert.equal(lines.length, 1, '无失败时只打一行汇总');
    assert.match(lines[0], /暂存区清扫：tmp\/capture\/acceptance-staging 扫到 7 项，删 4 项（修改时间早于 7 天），留 3 项，失败 0 项/);
  });

  it('超龄目录里含年轻文件 → 不整树删：只删超龄文件，目录与年轻文件都留下', () => {
    const root = makeRoot();
    writeEntry(root, 'PKG-060/check_tile_gap/stale.jpg');
    writeEntry(root, 'PKG-060/check_tile_gap/fresh.jpg');
    ageEntry(root, 'PKG-060/check_tile_gap/stale.jpg', 12);
    ageEntry(root, 'PKG-060/check_tile_gap/fresh.jpg', 2);
    // 目录自身超龄（上次增删条目是 12 天前）
    ageEntry(root, 'PKG-060/check_tile_gap', 12);
    ageEntry(root, 'PKG-060', 12);

    const {lines, log} = collectLog();
    const result = sweepAcceptanceStaging({root, nowMs: NOW, log});

    assert.ok(!existsSync(join(stagingOf(root), 'PKG-060/check_tile_gap/stale.jpg')), '超龄文件删掉');
    assert.ok(existsSync(join(stagingOf(root), 'PKG-060/check_tile_gap/fresh.jpg')), '年轻文件必须留下');
    assert.equal(result.nonEmptyDirsKept, 2, '两层超龄目录都因含年轻文件未删');
    assert.match(lines[0], /其中 2 个超龄目录因含年轻文件未删/);
  });

  it('只清 acceptance-staging 自己：tmp/ 其他子目录与暂存区外的同前缀目录都不碰', () => {
    const root = makeRoot();
    writeEntry(root, 'PKG-060/check_tile_gap/a.jpg');
    ageEntry(root, 'PKG-060/check_tile_gap/a.jpg', 30);
    ageEntry(root, 'PKG-060/check_tile_gap', 30);
    ageEntry(root, 'PKG-060', 30);
    // 同级的 tmp/capture 杂物与仓内证据目录（都超龄）
    mkdirSync(join(root, 'tmp/capture/acceptance-draft'), {recursive: true});
    writeFileSync(join(root, 'tmp/capture/acceptance-draft/PKG-060.json'), '{}');
    writeFileSync(join(root, 'tmp/capture/other-old.txt'), 'stale');
    mkdirSync(join(root, 'schedule/phase-1/evidence/PKG-060/check_tile_gap'), {recursive: true});
    writeFileSync(join(root, 'schedule/phase-1/evidence/PKG-060/check_tile_gap/a.jpg'), 'evidence');
    const stale = new Date(NOW - 40 * DAY_MS);
    utimesSync(join(root, 'tmp/capture/acceptance-draft/PKG-060.json'), stale, stale);
    utimesSync(join(root, 'tmp/capture/other-old.txt'), stale, stale);
    utimesSync(join(root, 'tmp/capture/acceptance-draft'), stale, stale);
    utimesSync(join(root, 'schedule/phase-1/evidence/PKG-060/check_tile_gap/a.jpg'), stale, stale);
    utimesSync(join(root, 'schedule/phase-1/evidence/PKG-060/check_tile_gap'), stale, stale);

    sweepAcceptanceStaging({root, nowMs: NOW, log: () => {}});

    assert.ok(!existsSync(join(stagingOf(root), 'PKG-060')), '暂存区里的超龄条目删掉');
    assert.ok(existsSync(join(root, 'tmp/capture/acceptance-draft/PKG-060.json')), '草稿目录不归启动清扫管（归 clearStaging）');
    assert.ok(existsSync(join(root, 'tmp/capture/other-old.txt')), 'tmp/ 其他子目录不碰');
    assert.ok(existsSync(join(root, 'schedule/phase-1/evidence/PKG-060/check_tile_gap/a.jpg')), '仓内证据不碰');
  });

  it('暂存区目录不存在 → 跳过不报错，日志说明原因', () => {
    const root = mkdtempSync(join(tmpdir(), 'acceptance-sweep-empty-'));
    tempRoots.push(root);
    const {lines, log} = collectLog();
    const result = sweepAcceptanceStaging({root, nowMs: NOW, log});
    assert.equal(result.existed, false);
    assert.equal(result.scanned, 0);
    assert.equal(result.removed, 0);
    assert.deepEqual(result.failures, []);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /tmp\/capture\/acceptance-staging 不存在，跳过/);
  });

  it('暂存区为空目录 → 扫到 0 项，不报错', () => {
    const root = makeRoot();
    const {lines, log} = collectLog();
    const result = sweepAcceptanceStaging({root, nowMs: NOW, log});
    assert.equal(result.existed, true);
    assert.equal(result.scanned, 0);
    assert.equal(result.removed, 0);
    assert.match(lines[0], /扫到 0 项，删 0 项/);
  });

  it('删除失败（权限）→ 记日志继续，其余超龄条目照删，不抛', () => {
    const root = makeRoot();
    writeEntry(root, 'PKG-LOCKED/check/a.jpg');
    writeEntry(root, 'PKG-OLD/check/b.jpg');
    ageEntry(root, 'PKG-LOCKED/check/a.jpg', 10);
    ageEntry(root, 'PKG-LOCKED/check', 10);
    ageEntry(root, 'PKG-LOCKED', 10);
    ageEntry(root, 'PKG-OLD/check/b.jpg', 10);
    ageEntry(root, 'PKG-OLD/check', 10);
    ageEntry(root, 'PKG-OLD', 10);
    // 锁住 PKG-LOCKED/check：里面有老文件也删不掉（模拟权限故障）
    chmodSync(join(stagingOf(root), 'PKG-LOCKED/check'), 0o500);

    const {lines, log} = collectLog();
    let result: ReturnType<typeof sweepAcceptanceStaging> | undefined;
    assert.doesNotThrow(() => { result = sweepAcceptanceStaging({root, nowMs: NOW, log}); });

    assert.equal(result!.failures.length, 1, '删不掉的那个条目记一条失败');
    assert.match(result!.failures[0].message, /EACCES|permission/i);
    assert.equal(result!.failures[0].path, 'PKG-LOCKED/check/a.jpg');
    assert.ok(existsSync(join(stagingOf(root), 'PKG-LOCKED/check/a.jpg')), '删不掉的文件还在');
    assert.ok(!existsSync(join(stagingOf(root), 'PKG-OLD')), '失败不影响其他超龄条目被删');
    // 汇总行 + 每条失败一行
    assert.equal(lines.length, 2);
    assert.match(lines[0], /失败 1 项/);
    assert.match(lines[1], /删除失败 PKG-LOCKED\/check\/a\.jpg：/);
  });

  it('不传 root/nowMs 时走 repoRoot() 与 Date.now()：切进假仓库根跑默认路径', () => {
    const root = makeRoot();
    // 真实时钟口径：10 天前落盘一个、1 天前落盘一个
    const realNow = Date.now();
    for (const [rel, days] of [['PKG-060/check_tile_gap/a.jpg', 10], ['PKG-060/check_tile_gap/fresh.jpg', 1]] as const) {
      writeEntry(root, rel);
      const when = new Date(realNow - days * DAY_MS);
      utimesSync(join(stagingOf(root), rel), when, when);
    }
    ageEntry(root, 'PKG-060/check_tile_gap', 10);
    ageEntry(root, 'PKG-060', 10);

    const {lines, log} = collectLog();
    const cwd = process.cwd();
    process.chdir(root);
    let result: ReturnType<typeof sweepAcceptanceStaging> | undefined;
    try {
      // 只注入 log；root 与 nowMs 都取默认（repoRoot() = cwd，Date.now()）
      result = sweepAcceptanceStaging({log});
    } finally {
      process.chdir(cwd);
    }

    assert.equal(result!.existed, true);
    // 超龄文件删掉；同段的年轻文件让两层超龄目录都留下（宁可不清）
    assert.equal(result!.removed, 1);
    assert.equal(result!.nonEmptyDirsKept, 2);
    // kept = 实际保留总数：1 个年轻文件 + 2 个因含年轻文件留下的超龄目录（codex 复审 minor）
    assert.equal(result!.kept, 3);
    assert.ok(!existsSync(join(stagingOf(root), 'PKG-060/check_tile_gap/a.jpg')), '默认时钟下 10 天前的条目照删');
    assert.ok(existsSync(join(stagingOf(root), 'PKG-060/check_tile_gap/fresh.jpg')), '1 天前的条目默认时钟下也留');
    assert.match(lines[0], /删 1 项（修改时间早于 7 天）/);
  });

  it('符号链接安全：暂存区内的链接不被沿读、更不被沿删（codex 复审 blocking）', () => {
    // 场景：暂存区内 PKG-060/link -> 暂存区外的「证据目录」（仓内 schedule/... 的替身）。
    // 旧实现 readdirSync({recursive:true})+statSync 会跟随链接，把 link/old.jpg 列进清单，
    // 删除循环认不出祖先是 link，rmSync 会删掉暂存区外的真实文件——删除边界失守。
    const root = makeRoot();
    const outside = mkdtempSync(join(tmpdir(), 'sweep-outside-'));
    tempRoots.push(outside);
    const evidenceDir = join(outside, 'evidence');
    mkdirSync(evidenceDir, {recursive: true});
    const outsideFile = join(evidenceDir, 'old.jpg');
    writeFileSync(outsideFile, 'precious');
    const when = new Date(NOW - 30 * DAY_MS);
    utimesSync(outsideFile, when, when); // 链接目标也是超龄的：旧实现会删它

    writeEntry(root, 'PKG-060/check_tile_gap/a.jpg');
    ageEntry(root, 'PKG-060/check_tile_gap/a.jpg', 30); // 真超龄文件：照删
    symlinkSync(evidenceDir, join(stagingOf(root), 'PKG-060/check_tile_gap/link'));

    const {log} = collectLog();
    const result = sweepAcceptanceStaging({root, nowMs: NOW, log});

    // 链接目标（暂存区外）必须原样存在；暂存区内的真超龄文件照删
    assert.ok(existsSync(outsideFile), '暂存区外的链接目标必须原样——删除边界不许沿链接失守');
    assert.equal(readFileSync(outsideFile, 'utf8'), 'precious');
    assert.ok(!existsSync(join(stagingOf(root), 'PKG-060/check_tile_gap/a.jpg')), '真超龄文件照删');
    // 链接条目不进清单（不沿它读），删除数为 0（a.jpg 之外没有可删的真条目）
    assert.equal(result.scanned, 3, '清单只含真实条目：两层目录 + a.jpg，不含 link 及其内容');
    assert.equal(result.removed, 1, '只删真超龄文件 a.jpg；link 不沿读也不沿删');
    assert.ok(existsSync(join(stagingOf(root), 'PKG-060/check_tile_gap/link')), '链接条目本身不删（不碰暂存区外的任何东西）');
  });

  it('符号链接安全：暂存根本身是链接时拒绝清扫', () => {
    const root = makeRoot();
    const realStaging = mkdtempSync(join(tmpdir(), 'sweep-real-'));
    tempRoots.push(realStaging);
    const victim = join(realStaging, 'old.jpg');
    writeFileSync(victim, 'x');
    const when = new Date(NOW - 30 * DAY_MS);
    utimesSync(victim, when, when);
    // 把暂存区根换成指向 realStaging 的链接
    rmSync(stagingOf(root), {recursive: true, force: true});
    symlinkSync(realStaging, stagingOf(root));

    const {lines, log} = collectLog();
    const result = sweepAcceptanceStaging({root, nowMs: NOW, log});

    assert.equal(result.removed, 0, '链接根拒绝清扫：一项都不删');
    assert.ok(existsSync(victim), '链接目标必须原样');
    assert.match(lines[0], /是符号链接，拒绝清扫/);
  });
});
