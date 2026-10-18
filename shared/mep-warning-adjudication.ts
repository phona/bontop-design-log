import { load as parseYaml } from 'js-yaml';
import { z } from 'zod';
import type { MepLintResult } from './mep-hvac-lint.js';

/**
 * 交底表态登记册（DEC-2026-10-17-R19）。
 *
 * 交付判据的完整定义：`verify:mep` 全绿 = must_fix 清零 **且** 报告里存活的每个
 * warning 类都在本登记册表态为 accepted（附 DEC 全引 + 复核 owner/触发）。
 * 未表态的 warning 类本身成为 must_fix error——「一堆低级问题等着人处理」的状态
 * 不允许以绿色形态存在；本表让「等数据 / 已接受为近似」两类在报告里各就各位。
 * 表态是人工断言：accepted 的管位/近似是否属实由登记的 owner 在 trigger 时复核。
 */
const AdjudicationSchema = z.object({
  code: z.string().min(1),
  verdict: z.literal('accepted'),
  dec_ref: z.string().min(1),
  scope: z.string().optional(),
  owner: z.string().optional(),
  trigger: z.string().optional(),
}).strict();

export const MepWarningAdjudicationSchema = z.object({
  version: z.string(),
  note: z.string().optional(),
  adjudications: z.array(AdjudicationSchema).min(1),
}).strict();

export type MepWarningAdjudication = z.infer<typeof MepWarningAdjudicationSchema>;

export function parseMepWarningAdjudication(raw: string): MepWarningAdjudication {
  return MepWarningAdjudicationSchema.parse(parseYaml(raw));
}

/**
 * 交付契约：把「未表态的 warning 类」追加为 must_fix error，并同步 counts 与
 * must_fix 桶明细（调用方在 lintMepCoordination 之后、输出之前调用）。
 */
export function appendUnadjudicatedWarningFindings(result: MepLintResult, registry: MepWarningAdjudication): void {
  const accepted = new Set(registry.adjudications.map((entry) => entry.code));
  const present = new Map<string, number>();
  for (const warning of result.warnings) present.set(warning.code, (present.get(warning.code) ?? 0) + 1);
  const unadjudicated = [...present.keys()].filter((code) => !accepted.has(code)).sort();
  for (const code of unadjudicated) {
    const count = present.get(code) ?? 0;
    result.errors.push({
      level: 'error',
      code: 'warning_class_unadjudicated',
      message: `Warning class ${code} ×${count} has no delivery adjudication: register accepted (dec_ref + owner + trigger) in config/mep-warning-adjudication.yaml, or clear the class, before delivery (DEC-2026-10-17-R19)`,
      category: 'must_fix_before_briefing',
    });
    result.counts.errors += 1;
    const bucket = result.categories?.must_fix_before_briefing;
    if (bucket) {
      const entry = bucket.codes.find((candidate) => candidate.code === code);
      if (entry) entry.count += 1;
      else bucket.codes.push({ code, count: 1 });
      bucket.count += 1;
    }
  }
}
