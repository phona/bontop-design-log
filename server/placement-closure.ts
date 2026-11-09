/**
 * 交付闭合性检查（issue #98 疗法①，方案见 PR #122 §一.1 / §三.1）。
 *
 * **不变量**：交付时，任何被交付点位声明的物理宿主，必须存在于定位宿主表中。
 * 「闭合」的含义：只要有一个被交付的点位说它挂 `X`，`X` 就必须在宿主表里——差一条都不行。
 *
 * 为什么需要它：issue #98 第四阶段把点位定位从「声明绝对 x/z」改成「mount.furniture_id
 * 关系声明」，平面位置由 shared/point-placement.ts 从宿主表派生。宿主表与点位清单是
 * 两个来源（house.yaml furnishings vs electrical.yaml / plumbing.yaml），且过滤政策
 * 不一致（electrical 全量下发、furnishings 按阶段过滤）——「点在场、宿主不在表」会让
 * 解算失败，而多个消费方对失败是降级处理（回落声明坐标 / 回落原点 / 跳过该模型），
 * 缺宿主于是变成静默错位：16 轮审查 53 条 finding 里 A 类 12 条（11 blocking）
 * 都是这一条不变量无人守护的反复采样。
 *
 * **宽容读取与严格输出的分工**（issue #98「宽容读取、局部降级、统一诊断、严格输出」；
 * PR #122 深审修复）：
 * - `collectPlacementHostClosureViolations` 只收集诊断、不抛——给 /api/project 这类
 *   **页面预览入口**用：200 + 诊断字段随响应下发，页面显形问题并继续预览其余部分；
 * - `assertPlacementHostClosure` 收集后聚合抛错——给**正式交付边界**用（DXF 装配前、
 *   验证脚本），真实错误必须失败，不许降级放行。
 * 断言函数保留，改的是调用点如何处理结果：从「抛 → 503」改成「收集诊断 → 响应带诊断
 * + 交付路径失败」。两者逐条文案一致（同一套检查、两种处置）。
 *
 * 宿主表用 shared/placement-indexes.ts 的 `mountHosts`（全量 furnishings，**不按阶段过滤**）：
 * 一期排除某个柜不影响它当定位宿主——排除的是「画不画」，不是「在不在」。
 * 该表与 /api/project 下发给浏览器的 `house.furnishingsAll` 消费的是同一个单一产地，
 * 不存在第二张宿主表（2026-11-09 疗法②）。
 */

import type { PointMountHost } from '../shared/point-placement.js';

/** 参与闭合性检查的点位最小形态（ElectricalPoint / PlumbingPoint 的定位相关子集）。 */
export interface PlacementClosurePoint {
  id: string;
  /** 家具挂载定位声明（issue #98 S2）：furniture_id 必须存在于定位宿主表。 */
  mount?: { furniture_id: string };
}

/** 单条闭合性违例：哪个点位、缺哪个宿主、可能原因。 */
export interface PlacementClosureViolation {
  /** 点位所属清单：electrical（电气） / plumbing（给排水）。 */
  kind: 'electrical' | 'plumbing';
  /** 违例点位 id。 */
  pointId: string;
  /** 声明的宿主 id；mount 声明缺 furniture_id 时为 undefined。 */
  hostId?: string;
  /** 人读诊断（与断言聚合错误的逐条文案逐字一致）。 */
  message: string;
}

/** 统一处理方向（严格输出口径）：页面降级预览，交付与验证仍按真实错误失败。 */
export const PLACEMENT_CLOSURE_GUIDANCE =
  '处理方向：把宿主加回全量 furnishings（阶段只该过滤渲染可见性），或改挂真实存在的宿主，或把点位本身移出本次交付；不得靠降级解算放行。'
  + '页面预览按宽容读取降级继续，但正式 DXF 导出与模型验证遇到同样的断引用必须失败（严格输出，issue #98）。';

const KIND_LABEL: Record<PlacementClosureViolation['kind'], string> = {
  electrical: '电气',
  plumbing: '给排水',
};

/**
 * 收集「本次要下发的 electrical + plumbing 点位」声明的 mount 宿主全部闭合性违例。
 *
 * 逐点检查 `mount.furniture_id`：
 * - 不在宿主表 → 违例（断引用 / 宿主被阶段过滤 / 宿主表构造漏了该房间）；
 * - 在表里但无平面几何（count-only 条目，无 x/z）→ 同样违例：没有平面几何就解不出宿主脸，
 *   挂载必然失败，与其留给解算器诊断再被某个消费方降级，不如在交付前点名。
 *
 * 一次收集全部违例（修一条就能看到下一条，不用逐次重启）；**不抛**——是否降级（页面
 * 预览 200 + 诊断）还是失败（交付边界 assert）由调用方按 issue #98 的分工决定。
 */
export function collectPlacementHostClosureViolations(
  electrical: readonly PlacementClosurePoint[],
  plumbing: readonly PlacementClosurePoint[],
  mountHosts: ReadonlyMap<string, PointMountHost>,
): PlacementClosureViolation[] {
  const violations: PlacementClosureViolation[] = [];
  const check = (kind: PlacementClosureViolation['kind'], point: PlacementClosurePoint): void => {
    if (point.mount === undefined) return;
    const label = KIND_LABEL[kind];
    const hostId = point.mount.furniture_id;
    if (typeof hostId !== 'string' || hostId === '') {
      violations.push({
        kind,
        pointId: point.id,
        message: `${label}点位 ${point.id}: mount 声明缺 furniture_id（没有宿主 id 无从闭合，更无从解算）`,
      });
      return;
    }
    const host = mountHosts.get(hostId);
    if (host === undefined) {
      violations.push({
        kind,
        pointId: point.id,
        hostId,
        message: `${label}点位 ${point.id}: mount 宿主 "${hostId}" 不在定位宿主表（可能原因：宿主被阶段过滤 / furniture_id 断引用 / 宿主表构造时漏掉了该房间）`,
      });
      return;
    }
    if (host.x === undefined || host.z === undefined) {
      violations.push({
        kind,
        pointId: point.id,
        hostId,
        message: `${label}点位 ${point.id}: mount 宿主 "${hostId}" 在定位宿主表里但没有平面几何（count-only 条目无 x/z，不得挂载；宿主脸平面解不出）`,
      });
    }
  };

  for (const point of electrical) check('electrical', point);
  for (const point of plumbing) check('plumbing', point);

  return violations;
}

/**
 * 断言「本次要交付的 electrical + plumbing 点位」声明的 mount 宿主全部存在于定位宿主表。
 *
 * 正式交付边界（DXF 装配前、模型验证脚本）用这一支：真实错误必须当场失败，不降级放行。
 * 页面预览入口（/api/project）改用 `collectPlacementHostClosureViolations`——宽容读取，
 * 200 + 诊断字段，不 503 掐死页面（PR #122 深审修复，issue #98）。
 */
export function assertPlacementHostClosure(
  electrical: readonly PlacementClosurePoint[],
  plumbing: readonly PlacementClosurePoint[],
  mountHosts: ReadonlyMap<string, PointMountHost>,
): void {
  const violations = collectPlacementHostClosureViolations(electrical, plumbing, mountHosts);
  if (violations.length === 0) return;
  throw new Error(
    `交付闭合性断言失败（PR #122 §一.1：被交付点位声明的物理宿主必须存在于定位宿主表），共 ${violations.length} 条：\n`
    + `- ${violations.map((v) => v.message).join('\n- ')}\n`
    + PLACEMENT_CLOSURE_GUIDANCE,
  );
}
