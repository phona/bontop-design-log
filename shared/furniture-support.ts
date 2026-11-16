// 支撑检查（2026-11-16 DDD 模型约束）：「不悬空」是对象自身的模型约束。
//
// 一件 placed 家具的建模竖向包络（FixtureFactory 实测 Box3，与 SceneBuilder 渲染
// 同口径）必须符合它的支撑声明。语义按支撑种类：
// - floor：建模底 = 0；wall：建模底 = 声明挂高 bottom；
// - furniture：建模底 = 承托面 surface（宿主 id 须在 furnishings 中）；
// - inset：建模包络跨过台面（底 ≤ 面 ≤ 顶，容差内）；
// - ceiling：建模顶 = 完成面 face − drop（drop 缺省 0）。
//
// 本模块是纯函数（不读 config、不建模型）：调用方（verify-furniture-placement）
// 传进已算出的建模包络；测试直接传合成包络断言各 kind 的通过/失败边界。
import type { FurnishingSupport } from './types.js';

/** 建模竖向包络（FixtureFactory 实测 Box3，与 SceneBuilder 渲染同口径）。 */
export interface FurnishingBuiltBounds {
  bottom: number;
  top: number;
}

// 支撑检查容差 5mm：与起夜灯挂载 x/z 漂移容差（verify-spatial）同量级；配方小数位精度 1mm，
// 5mm 只消浮点/取整噪声，不掩盖厘米级悬空。
export const SUPPORT_EPS = 0.005;

export function checkSupport(
  label: string,
  support: FurnishingSupport | undefined,
  bounds: FurnishingBuiltBounds | null,
  hosts: ReadonlyMap<string, unknown>,
  errors: string[],
): void {
  if (!support) {
    // 摆位解算器已对缺 support 的 placed 条目出诊断（verify 循环到不了这里）；兜底。
    errors.push(`${label}: 缺少 support 支撑声明（placed 条目必填）`);
    return;
  }
  if (!bounds) return; // 无模型（如冷凝链示意件）：无竖向几何可比，跳过（不报错）。
  const { bottom, top } = bounds;
  if (support.kind === 'floor') {
    if (Math.abs(bottom) > SUPPORT_EPS) {
      errors.push(`${label}: 落地件建模底 ${bottom.toFixed(3)}m ≠ 地面 0（悬空/下沉 ${Math.abs(bottom).toFixed(3)}m）`);
    }
  } else if (support.kind === 'wall') {
    if (Math.abs(bottom - support.bottom) > SUPPORT_EPS) {
      errors.push(`${label}: 挂墙件建模底 ${bottom.toFixed(3)}m ≠ 声明挂高 ${support.bottom.toFixed(3)}m`);
    }
  } else if (support.kind === 'furniture' || support.kind === 'inset') {
    const hostIds = Array.isArray(support.host) ? support.host : [support.host];
    for (const hostId of hostIds) {
      if (!hosts.has(hostId)) errors.push(`${label}: 支撑宿主 "${hostId}" 不在 furnishings 中（断引用）`);
    }
    if (support.kind === 'furniture') {
      if (Math.abs(bottom - support.surface) > SUPPORT_EPS) {
        errors.push(`${label}: 搁置件建模底 ${bottom.toFixed(3)}m ≠ 承托面 ${support.surface.toFixed(3)}m（宿主 ${hostIds.join('/')}）`);
      }
    } else if (bottom > support.surface + SUPPORT_EPS || top < support.surface - SUPPORT_EPS) {
      errors.push(`${label}: 嵌装件建模底 ${bottom.toFixed(3)}m / 顶 ${top.toFixed(3)}m 未跨过台面 ${support.surface.toFixed(3)}m（须底 ≤ 面 ≤ 顶，容差 ${SUPPORT_EPS}m）`);
    }
  } else if (support.kind === 'ceiling') {
    const expectedTop = support.face - (support.drop ?? 0);
    if (Math.abs(top - expectedTop) > SUPPORT_EPS) {
      errors.push(`${label}: 吊顶件建模顶 ${top.toFixed(3)}m ≠ 完成面 ${support.face.toFixed(3)}m − drop ${support.drop ?? 0}m（期望 ${expectedTop.toFixed(3)}m）`);
    }
  }
}
