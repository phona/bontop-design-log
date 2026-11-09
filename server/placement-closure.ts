/**
 * 交付闭合性断言（issue #98 疗法①，方案见 PR #122 §一.1 / §三.1）。
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
 * 本断言把整个类从「静默」变成「当场炸」：不满足即抛，逐个点名「哪个点位、缺哪个宿主、
 * 可能的原因」，不许静默跳过。它挂在**交付边界**（/api/project 组装响应前）——
 * 渲染层可以挑着看（阶段可见性是业主预演用途），交付物必须自洽。
 *
 * 宿主表用 pointMountHostIndex 的产物（全量 furnishings，**不按阶段过滤**）：
 * 一期排除某个柜不影响它当定位宿主——排除的是「画不画」，不是「在不在」。
 */

import type { PointMountHost } from '../shared/point-placement.js';

/** 参与闭合性检查的点位最小形态（ElectricalPoint / PlumbingPoint 的定位相关子集）。 */
export interface PlacementClosurePoint {
  id: string;
  /** 家具挂载定位声明（issue #98 S2）：furniture_id 必须存在于定位宿主表。 */
  mount?: { furniture_id: string };
}

/**
 * 断言「本次要下发的 electrical + plumbing 点位」声明的 mount 宿主全部存在于定位宿主表。
 *
 * 逐点检查 `mount.furniture_id`：
 * - 不在宿主表 → 抛（断引用 / 宿主被阶段过滤 / 宿主表构造漏了该房间）；
 * - 在表里但无平面几何（count-only 条目，无 x/z）→ 同样抛：没有平面几何就解不出宿主脸，
 *   挂载必然失败，与其留给解算器诊断再被某个消费方降级，不如在交付前拦下。
 *
 * 一次收集全部违例后抛一条聚合错误：修一条就能看到下一条，不用逐次重启。
 */
export function assertPlacementHostClosure(
  electrical: readonly PlacementClosurePoint[],
  plumbing: readonly PlacementClosurePoint[],
  mountHosts: ReadonlyMap<string, PointMountHost>,
): void {
  const violations: string[] = [];
  const check = (kind: string, point: PlacementClosurePoint): void => {
    if (point.mount === undefined) return;
    const hostId = point.mount.furniture_id;
    if (typeof hostId !== 'string' || hostId === '') {
      violations.push(`${kind}点位 ${point.id}: mount 声明缺 furniture_id（没有宿主 id 无从闭合，更无从解算）`);
      return;
    }
    const host = mountHosts.get(hostId);
    if (host === undefined) {
      violations.push(`${kind}点位 ${point.id}: mount 宿主 "${hostId}" 不在定位宿主表（可能原因：宿主被阶段过滤 / furniture_id 断引用 / 宿主表构造时漏掉了该房间）`);
      return;
    }
    if (host.x === undefined || host.z === undefined) {
      violations.push(`${kind}点位 ${point.id}: mount 宿主 "${hostId}" 在定位宿主表里但没有平面几何（count-only 条目无 x/z，不得挂载；宿主脸平面解不出）`);
    }
  };

  for (const point of electrical) check('电气', point);
  for (const point of plumbing) check('给排水', point);

  if (violations.length > 0) {
    throw new Error(
      `交付闭合性断言失败（PR #122 §一.1：被交付点位声明的物理宿主必须存在于定位宿主表），共 ${violations.length} 条：\n`
      + `- ${violations.join('\n- ')}\n`
      + '处理方向：把宿主加回全量 furnishings（阶段只该过滤渲染可见性），或改挂真实存在的宿主，或把点位本身移出本次交付；不得靠降级解算放行。',
    );
  }
}
