// control.ts 数据层合同校验的自动化防线（独立复审 F1）。
//
// 背景：PR #16 在 scripts/schedule/control.ts 给带 contract 块的报价轮次
// 加了约 67 行 fail-closed 校验（金额与 locked_cny 一致、deal_status 只认
// signed、signed_at 严格日历、archive_paths 的 {path, sha256} 形态与路径
// 边界）。此前这层校验零自动化测试——复审者手工 8 个探针全过，但任何
// 后续重构（改字段名、动正则）都能让它静默失效，而它炸的是
// verify:schedule、不是单测。本文件把那组探针固化为回归测试。
//
// 手法：符号链接农场沙箱。control.ts 以 process.cwd() 为仓根，校验要读
// 的文件遍布全仓，整仓复制太慢；故沙箱里除 schedule/ 与 contracts/ 为
// 真实副本（可篡改面）外，其余顶层条目全部 symlink 回真仓（只读面）。
// 归档路径核查 contractArchivePathProblem 只作用于 contracts/ 内的真实
// 副本，realpath 不出沙箱归档区；指纹快照经 symlink 读到的是同一内容。
// 每例 spawn 一次 `control.ts --check`（约 2s），断言退出码与点名错误。
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { load as parseYaml } from 'js-yaml';

type AnyRecord = Record<string, any>;

const repoRoot = process.cwd();
const sandbox = mkdtempSync(join(tmpdir(), 'control-contract-'));
const sandboxControlPath = join(sandbox, 'schedule/phase-1/control.yaml');
let pristineControlText = '';

function buildSandbox(): void {
  for (const entry of readdirSync(repoRoot)) {
    if (entry === '.git' || entry === 'node_modules' || entry === 'schedule' || entry === 'contracts') continue;
    symlinkSync(join(repoRoot, entry), join(sandbox, entry));
  }
  symlinkSync(join(repoRoot, 'node_modules'), join(sandbox, 'node_modules'));
  cpSync(join(repoRoot, 'schedule'), join(sandbox, 'schedule'), { recursive: true });
  cpSync(join(repoRoot, 'contracts'), join(sandbox, 'contracts'), { recursive: true });
  pristineControlText = readFileSync(sandboxControlPath, 'utf8');
}

function runControlCheck(): { status: number | null; output: string } {
  const result = spawnSync('node', ['--import', 'tsx', 'scripts/schedule/control.ts', '--check'], {
    cwd: sandbox,
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { status: result.status, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
}

/**
 * 篡改走文本手术而非 parse→dump 往返：control.yaml 的字节内容是生成物
 * 输入指纹的一部分，整文件重排版会先触发「inputs changed」噪声、淹没
 * 合同校验本身的报错。每处锚点先断言在文件中恰出现一次，锚点漂移时
 * 测试当场点名，而不是静默改错地方。
 */
function replaceOnce(text: string, from: string, to: string): string {
  const first = text.indexOf(from);
  assert.notEqual(first, -1, `篡改锚点不存在：${from}`);
  assert.equal(text.indexOf(from, first + 1), -1, `篡改锚点不唯一：${from}`);
  return text.slice(0, first) + to + text.slice(first + from.length);
}

function mutateContractText(mutate: (text: string) => string): void {
  writeFileSync(sandboxControlPath, mutate(pristineControlText));
}

function restoreControl(): void {
  writeFileSync(sandboxControlPath, pristineControlText);
}

describe('control.ts 数据层合同校验（F1 回归防线）', () => {
  before(buildSandbox);
  after(() => rmSync(sandbox, { recursive: true, force: true }));

  it('基线原件：未篡改的沙箱必须 --check 通过', () => {
    const { status, output } = runControlCheck();
    assert.equal(status, 0, `--check 应通过，实际输出：${output.slice(-400)}`);
  });

  it('登记金额与 locked_cny 不一致必须报错点名', () => {
    mutateContractText((text) => replaceOnce(text, 'amount_cny: 36000', 'amount_cny: 35000'));
    try {
      const { status, output } = runControlCheck();
      assert.notEqual(status, 0);
      assert.match(output, /contract\.amount_cny=35000 与 locked_cny=36000 不一致/);
    } finally {
      restoreControl();
    }
  });

  it('deal_status 非 signed 必须报错', () => {
    mutateContractText((text) => replaceOnce(text, 'deal_status: signed', 'deal_status: pending'));
    try {
      const { status, output } = runControlCheck();
      assert.notEqual(status, 0);
      assert.match(output, /contract\.deal_status must be signed \(got pending\)/);
    } finally {
      restoreControl();
    }
  });

  it('signed_at 为不存在的日期（2026-02-30）必须报错', () => {
    mutateContractText((text) => replaceOnce(text, 'signed_at: "2026-10-04"', 'signed_at: "2026-02-30"'));
    try {
      const { status, output } = runControlCheck();
      assert.notEqual(status, 0);
      assert.match(output, /contract\.signed_at must be a real YYYY-MM-DD calendar date/);
    } finally {
      restoreControl();
    }
  });

  it('归档路径越界（contracts/../）即使配自洽哈希也必须报错', () => {
    const target = join(sandbox, 'schedule/phase-1/cost.md');
    const sha256 = createHash('sha256').update(readFileSync(target)).digest('hex');
    mutateContractText((text) => replaceOnce(
      replaceOnce(text,
        '- path: contracts/2026-10-03/QR-2026-10-03-24_中央空调_合同附件p1_20261004.jpg',
        '- path: contracts/../schedule/phase-1/cost.md'),
      'b1adfe5ca3aa6e31744cc14d6c329e952c5b8d715a4379b41fd69a6aacb5f61a',
      sha256,
    ));
    try {
      const { status, output } = runControlCheck();
      assert.notEqual(status, 0);
      assert.match(output, /归档路径越界/);
    } finally {
      restoreControl();
    }
  });

  it('sha256 非 64 位十六进制必须报错', () => {
    mutateContractText((text) => replaceOnce(text,
      'b1adfe5ca3aa6e31744cc14d6c329e952c5b8d715a4379b41fd69a6aacb5f61a', 'abc123'));
    try {
      const { status, output } = runControlCheck();
      assert.notEqual(status, 0);
      assert.match(output, /sha256 必须是 64 位十六进制/);
    } finally {
      restoreControl();
    }
  });

  it('归档原件缺位必须报错', () => {
    mutateContractText((text) => replaceOnce(text,
      '- path: contracts/2026-10-03/QR-2026-10-03-24_中央空调_合同附件p1_20261004.jpg',
      '- path: contracts/2026-10-03/not-archived.jpg'));
    try {
      const { status, output } = runControlCheck();
      assert.notEqual(status, 0);
      assert.match(output, /归档原件不存在/);
    } finally {
      restoreControl();
    }
  });

  it('归档原件被换成符号链接必须报错', () => {
    const contract = (parseYaml(pristineControlText) as AnyRecord).hard_finish_quote_rounds.records
      .find((entry: AnyRecord) => entry.id === 'QR-2026-10-03-24').contract as AnyRecord;
    const firstPath = join(sandbox, contract.archive_paths[0].path as string);
    const secondPath = join(sandbox, contract.archive_paths[1].path as string);
    assert.ok(existsSync(firstPath) && existsSync(secondPath), '沙箱内两页原件必须都在位');
    const backup = readFileSync(firstPath);
    unlinkSync(firstPath);
    symlinkSync(secondPath, firstPath);
    try {
      assert.ok(lstatSync(firstPath).isSymbolicLink());
      const { status, output } = runControlCheck();
      assert.notEqual(status, 0);
      assert.match(output, /归档原件是符号链接/);
    } finally {
      unlinkSync(firstPath);
      writeFileSync(firstPath, backup);
    }
  });
});
