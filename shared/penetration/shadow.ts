import type { BoxEntry } from './scene.js';
import { aabbOverlaps, obbFromObject, satOverlap, type Obb } from './obb.js';
import { relationshipExemptsPair } from './rules.js';
import { computeEnvelopeShadow, type EnvelopeInput, type EnvelopeReport } from './envelopes.js';
import type { Aabb3, RelationshipSpec, SpatialIssue } from '../spatial-validation.js';

/**
 * OBB shadow 对照：**只观察、不判定**。
 *
 * ## 适用范围（2026-10-09 实测后收窄）
 * 第一版把家具↔墙、家具↔玻璃也纳入对照，结果 71 对全部报「OBB 说撞、规则说不撞」。
 * 逐条看下去发现那不是缺陷，而是**判据口径**差异：
 *
 * - 家具↔墙：SceneBuilder 的家具/墙共用**墙中心线** datum，家具包络按中心线 authoring，
 *   因此与墙 slab 固有 ≤ 半墙厚（实测一律 0.06m）的重叠——代码里叫 representation
 *   contact，规则用 `segmentCrossingDepth`/`segmentSolidOverlapDepth` 判「是否真穿越」。
 *   OBB 直接和墙 slab 比，等于用另一套口径重复判一遍。要用 OBB 判墙穿透，必须先把墙
 *   退化成中心线平面/线段做 OBB-vs-plane 测试，那是另一件事，未做之前不纳入对照。
 * - 家具↔玻璃：规则走 concrete overlay path 的穿越判定，不是 AABB 相交。
 * - 家具↔家具：规则的判据**就是** AABB 重叠深度，这一档才是 OBB 真正的用武之地
 *   （旋转家具的 AABB 保守 → 假阳）。
 *
 * 因此本模块只对照家具↔家具，并额外做一件有真实价值的事：审计 `relationships`
 * 白名单是否过宽——被豁免的对如果 OBB 说根本不撞，说明这条豁免是假白名单。
 * （2026-10-09：白名单已迁入 `config/anti-penetration.yaml` 的 waivers，由
 * `relationshipSpecsFromWaivers` 还原后喂进来，审计口径不变。）
 *
 * 为什么安全：OBB 恒包含于 AABB，OBB 判相交 ⇒ AABB 必判相交。本层只能消假阳，
 * 不可能放过真阳；但也正因如此，未评审前不得把 OBB 设为 authoritative。
 */

export type ShadowVerdict = 'flagged' | 'clear';
export type ShadowDivergence = 'agree' | 'false_positive' | 'false_negative';

export interface ShadowDivergenceEntry {
  pair: [string, string];
  rule_says: ShadowVerdict;
  obb_says: ShadowVerdict;
  obb_depth_m?: number;
  mtv?: [number, number, number];
  divergence: ShadowDivergence;
}

export interface ExemptionAuditEntry {
  pair: [string, string];
  /** 声明了哪种关系（stacked/attached/contained；2026-10-09 起随 relationships 白名单迁入 anti-penetration 的 waivers）。 */
  relationship: string;
  /** OBB 是否确认这一对真的相交——false 即「假白名单」（豁免了其实不撞的一对）。 */
  obb_confirms_overlap: boolean;
  obb_depth_m?: number;
}

export interface ShadowInput {
  furniture: BoxEntry[];
  relationships?: RelationshipSpec[];
  mepTypes?: string[];
  /** 规则层本轮产出的 issue，用于取「规则怎么说」。 */
  ruleIssues: SpatialIssue[];
  /**
   * 活动包络（envelope）输入。提供时才计算 envelope shadow，并并进同一份
   * `report.shadow.envelopes`（shadow-only，不影响 errors/warnings/退出码）。
   * 缺省（如既有单测）不生成 envelopes 段，保持向后兼容。
   */
  envelopes?: EnvelopeInput;
}

export interface ShadowReport {
  summary: {
    /** 进入对照的家具互撞候选对（AABB 命中且未被关系豁免）。 */
    candidates: number;
    agree: number;
    falsePositives: number;
    falseNegatives: number;
    /** 被 relationships 豁免且 AABB 确实相交的对。 */
    exemptPairsAudited: number;
    /** 其中 OBB 说其实不撞的（假白名单）。 */
    overBroadExemptions: number;
  };
  divergences: ShadowDivergenceEntry[];
  exemptionAudit: ExemptionAuditEntry[];
  /** 活动包络 shadow（info-only）。仅当传入 envelopes 输入时存在。 */
  envelopes?: EnvelopeReport;
}

function obbOf(entry: BoxEntry): Obb | null {
  return entry.object ? obbFromObject(entry.object) : null;
}

function overlapDepth(a: BoxEntry, b: BoxEntry): { depth: number; mtv?: [number, number, number] } | null {
  const obbA = obbOf(a);
  const obbB = obbOf(b);
  if (!obbA || !obbB) return null;
  const overlap = satOverlap(obbA, obbB);
  if (!overlap) return { depth: 0 };
  return {
    depth: Number(overlap.depth.toFixed(4)),
    mtv: [Number(overlap.mtv.x.toFixed(4)), Number(overlap.mtv.y.toFixed(4)), Number(overlap.mtv.z.toFixed(4))] as [number, number, number],
  };
}

export function computeObbShadow(input: ShadowInput): ShadowReport {
  const mep = new Set(input.mepTypes ?? []);
  const relationships = input.relationships ?? [];
  const flagged = new Set(input.ruleIssues.filter((issue) => issue.level !== 'info').map((issue) => issue.entity));
  const divergences: ShadowDivergenceEntry[] = [];
  const exemptionAudit: ExemptionAuditEntry[] = [];

  const candidates = input.furniture.filter((entry) => !mep.has(entry.type));
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      const boxA: Aabb3 = a.box;
      const boxB: Aabb3 = b.box;
      // 与规则层同口径的 broad-phase：竖向不重叠或 AABB 不相交即不是候选对。
      if (boxA.minY >= boxB.maxY || boxA.maxY <= boxB.minY) continue;
      if (!aabbOverlaps(boxA, boxB)) continue;

      const exempt = relationshipExemptsPair(a.entity, b.entity, relationships);
      const depth = overlapDepth(a, b);
      if (exempt) {
        exemptionAudit.push({
          pair: [a.entity, b.entity],
          relationship: relationships.find((relationship) => relationshipExemptsPair(a.entity, b.entity, [relationship]))?.id ?? '',
          obb_confirms_overlap: (depth?.depth ?? 0) > 0,
          ...(depth && depth.depth > 0 ? { obb_depth_m: depth.depth } : {}),
        });
        continue;
      }

      const ruleSays: ShadowVerdict = flagged.has(`${a.entity}↔${b.entity}`) || flagged.has(`${b.entity}↔${a.entity}`) ? 'flagged' : 'clear';
      const obbSays: ShadowVerdict = (depth?.depth ?? 0) > 0 ? 'flagged' : 'clear';
      const divergence: ShadowDivergence = ruleSays === obbSays ? 'agree' : ruleSays === 'flagged' ? 'false_positive' : 'false_negative';
      divergences.push({
        pair: [a.entity, b.entity],
        rule_says: ruleSays,
        obb_says: obbSays,
        ...(depth && depth.depth > 0 ? { obb_depth_m: depth.depth } : {}),
        ...(depth?.mtv ? { mtv: depth.mtv } : {}),
        divergence,
      });
    }
  }

  return {
    summary: {
      candidates: divergences.length,
      agree: divergences.filter((entry) => entry.divergence === 'agree').length,
      falsePositives: divergences.filter((entry) => entry.divergence === 'false_positive').length,
      falseNegatives: divergences.filter((entry) => entry.divergence === 'false_negative').length,
      exemptPairsAudited: exemptionAudit.length,
      overBroadExemptions: exemptionAudit.filter((entry) => !entry.obb_confirms_overlap).length,
    },
    divergences,
    exemptionAudit,
    ...(input.envelopes ? { envelopes: computeEnvelopeShadow(input.envelopes) } : {}),
  };
}
