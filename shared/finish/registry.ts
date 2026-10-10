/**
 * 面层范围核查注册表：finish-scope 层唯一入口。
 *
 * 与 `shared/penetration/registry.ts` 同构：
 * - 配置声明 severity 下限（只许加严不许放宽）
 * - 豁免带 reason/owner/expires，到期自动复活
 * - 覆盖矩阵：代码实现了但配置没申报 → 报错；配置申报了但代码没实现 → 报错
 */

import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { load as parseYaml } from 'js-yaml';
import {
  validateFinishScope,
  type FinishIssue,
  type FinishScopeInput,
} from './rules.js';

export type { FinishIssue } from './rules.js';
import {
  severityFloor,
  sameFinishPair,
  type FinishLintConfig,
  type FinishRuleSpec,
  type FinishWaiverSpec,
} from './types.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
export const CONFIG_PATH = 'config/finish-lint.yaml';
const SOURCE = 'config/layout/overlay.yaml + config/ceiling.yaml + shared/finish/';

/** 代码里真实实现了的规则。配置申报与此清单互为镜像，缺一方即报错。 */
export const IMPLEMENTED_RULES: FinishRuleSpec[] = [
  {
    id: 'finish.wall_overlap',
    codes: ['finish.wall_finish_overlap'],
    kinds: 'paint_region vs walltile(wall_region)',
    severity: 'error',
    enabled: true,
    note: '同一面墙同一房间（同侧）的水平+竖向区间都相交 → 该面被计两次。跨房间是双面涂漆，合法不报。',
  },
  {
    id: 'finish.sill_duplicate',
    codes: ['finish.sill_finish_duplicate'],
    kinds: 'paint_sill_region vs sill_region',
    severity: 'error',
    enabled: true,
    note: '同一 bay 元素的同一个面被漆与砖同时声明。',
  },
  {
    id: 'finish.paint_duplicate_same_side',
    codes: ['finish.paint_duplicate_same_side'],
    kinds: 'paint_region vs paint_region',
    severity: 'error',
    enabled: true,
    note: '同一面墙同一房间同侧两段涂漆声明 along 相交 → 纯计量重复。',
  },
  {
    id: 'finish.paint_room_binding',
    codes: ['finish.paint_outside_room', 'finish.paint_on_suppressed_wall', 'finish.paint_room_unresolvable', 'finish.paint_span_unresolvable'],
    kinds: 'paint_region vs room boundary',
    severity: 'error',
    enabled: true,
    note: 'along 端点须落在声明房间的 boundary 多边形上；挂 suppress 墙或定位失败显形。',
  },
];

/** finish-scope 层 code 全集：parity 测试与文档都引这一份。 */
export const FINISH_RULE_CODES: string[] = IMPLEMENTED_RULES.flatMap((rule) => rule.codes);

/** 注册表自身也会产出的 code。 */
export const REGISTRY_CODES = [
  'finish.rule_duplicate',
  'finish.rule_severity_invalid',
  'finish.rule_code_unknown',
  'finish.rule_unimplemented',
  'finish.rule_undeclared',
  'finish.rule_disabled',
  'finish.waiver_rule_unknown',
  'finish.waiver_pair_malformed',
  'finish.waiver_expired',
  'finish.waiver_missing_reason',
];

export function loadFinishLintConfig(): FinishLintConfig {
  return parseYaml(readFileSync(path.join(ROOT, CONFIG_PATH), 'utf8')) as FinishLintConfig;
}

/** 覆盖矩阵：配置与实现必须互为镜像，否则覆盖矩阵在说谎。 */
export function validateFinishRegistry(config: FinishLintConfig, source = CONFIG_PATH): FinishIssue[] {
  const issues: FinishIssue[] = [];
  const seen = new Set<string>();
  for (const rule of config.rules ?? []) {
    if (seen.has(rule.id)) {
      issues.push({ level: 'error', code: 'finish.rule_duplicate', entity: rule.id, message: `规则 ${rule.id} 在配置里重复申报`, evidence: { source } });
    }
    seen.add(rule.id);
    if (rule.severity !== 'error' && rule.severity !== 'warning') {
      issues.push({ level: 'error', code: 'finish.rule_severity_invalid', entity: rule.id, message: `规则 ${rule.id} 的 severity 只能是 error/warning`, evidence: { severity: rule.severity } });
    }
    for (const code of rule.codes ?? []) {
      if (!FINISH_RULE_CODES.includes(code)) {
        issues.push({ level: 'error', code: 'finish.rule_code_unknown', entity: rule.id, message: `规则 ${rule.id} 申报了未实现的 code ${code}`, evidence: { code } });
      }
    }
    if (!rule.enabled) {
      issues.push({ level: 'warning', code: 'finish.rule_disabled', entity: rule.id, message: `规则 ${rule.id} 在配置里被禁用——规则不跑就等于没有`, evidence: {} });
    }
  }
  for (const implemented of IMPLEMENTED_RULES) {
    const declared = (config.rules ?? []).find((rule) => rule.id === implemented.id);
    if (!declared) {
      issues.push({ level: 'error', code: 'finish.rule_undeclared', entity: implemented.id, message: `规则 ${implemented.id} 已在代码实现但配置未申报`, evidence: { codes: implemented.codes } });
      continue;
    }
    for (const code of implemented.codes) {
      if (!(declared.codes ?? []).includes(code)) {
        issues.push({ level: 'error', code: 'finish.rule_undeclared', entity: implemented.id, message: `规则 ${implemented.id} 的 code ${code} 未在配置登记`, evidence: { code } });
      }
    }
  }
  const knownRules = new Set((config.rules ?? []).map((rule) => rule.id));
  for (const waiver of config.waivers ?? []) {
    if (!knownRules.has(waiver.rule)) {
      issues.push({ level: 'error', code: 'finish.waiver_rule_unknown', entity: waiver.id, message: `豁免 ${waiver.id} 指向未申报的规则 ${waiver.rule}`, evidence: { rule: waiver.rule } });
    }
    if (!Array.isArray(waiver.pair) || waiver.pair.length !== 2) {
      issues.push({ level: 'error', code: 'finish.waiver_pair_malformed', entity: waiver.id, message: `豁免 ${waiver.id} 的 pair 必须是两个声明 id`, evidence: { pair: waiver.pair } });
    }
    if (!waiver.reason) {
      issues.push({ level: 'error', code: 'finish.waiver_missing_reason', entity: waiver.id, message: `豁免 ${waiver.id} 没有 reason——没有理由的豁免视为谎言`, evidence: {} });
    }
    if (waiver.expires && waiver.expires < new Date().toISOString().slice(0, 10)) {
      issues.push({ level: 'error', code: 'finish.waiver_expired', entity: waiver.id, message: `豁免 ${waiver.id} 已于 ${waiver.expires} 到期，自动复活为 error`, evidence: { expires: waiver.expires } });
    }
  }
  return issues;
}

/** 规则自判级别 vs 配置下限，取更严的一个。 */
export function applyFinishPolicy(issues: FinishIssue[], config: FinishLintConfig, today: string): FinishIssue[] {
  const floor = new Map((config.rules ?? []).map((rule) => [rule.id, rule]));
  const byCode = new Map<string, FinishRuleSpec>();
  for (const rule of config.rules ?? []) for (const code of rule.codes ?? []) byCode.set(code, rule);
  const waived = (config.waivers ?? []).filter((waiver) => waiver.expires >= today && waiver.reason);
  return issues.map((issue) => {
    const rule = byCode.get(issue.code);
    const level = rule ? severityFloor(issue.level, rule.severity) : issue.level;
    if (level === 'info') return { ...issue, level };
    const hit = waived.find((waiver) => sameFinishPair(issue.entity, issue.entity, [waiver.pair[0], waiver.pair[1]])
      || (Array.isArray((issue.evidence as any)?.declarations) && sameFinishPair((issue.evidence as any).declarations[0], (issue.evidence as any).declarations[1], waiver.pair)));
    if (hit) return { ...issue, level: 'info' as const, evidence: { ...issue.evidence, waivedBy: hit.id } };
    return { ...issue, level };
  });
}

export interface FinishRunResult {
  issues: FinishIssue[];
  registryIssues: FinishIssue[];
}

export function runFinishScopeChecks(input: FinishScopeInput, today: string, config = loadFinishLintConfig()): FinishRunResult {
  const registryIssues = validateFinishRegistry(config);
  const raw = validateFinishScope(input);
  const issues = applyFinishPolicy(raw, config, today);
  return { issues, registryIssues };
}

export { SOURCE };
