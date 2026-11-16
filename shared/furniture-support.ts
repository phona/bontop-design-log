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

/** 支撑声明的合法 kind（与 shared/types.ts FurnishingSupport 的联合成员同口径）。 */
export const SUPPORT_KINDS: ReadonlySet<string> = new Set(['floor', 'wall', 'furniture', 'inset', 'ceiling']);

/**
 * 支撑声明的运行时校验（2026-11-16 Codex 一审 blocking）：YAML 经 TypeScript 类型断言
 * 读入，不验证数据——`{}`、拼错的 kind、缺必填数值都曾静默通过本模块（缺失数值产生
 * NaN，比较条件恒为 false；未知 kind 落在全部分支之外，零错误）。本函数在几何比较
 * 之前先验声明本身：kind 须在联合内、各 kind 的必填字段须齐全且数值有限、宿主须为
 * 非空 id。返回是否合法；不合法时逐条入 errors，调用方不再做几何比较。
 */
export function validateSupportDeclaration(label: string, support: unknown, errors: string[]): boolean {
  if (typeof support !== 'object' || support === null || Array.isArray(support)) {
    errors.push(`${label}: support 支撑声明须为对象（收到 ${Array.isArray(support) ? '数组' : support === null ? 'null' : typeof support}）`);
    return false;
  }
  const declaration = support as Record<string, unknown>;
  const kind = declaration.kind;
  if (typeof kind !== 'string' || !SUPPORT_KINDS.has(kind)) {
    errors.push(`${label}: 未知的 support kind ${JSON.stringify(kind)}（须为 floor/wall/furniture/inset/ceiling 之一）`);
    return false;
  }
  const finiteNumber = (field: string): boolean => {
    const value = declaration[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`${label}: ${kind} 支撑缺必填数值 ${field}（须为有限数，收到 ${String(value)}）`);
      return false;
    }
    return true;
  };
  let valid = true;
  if (kind === 'wall') {
    valid = finiteNumber('bottom') && valid;
  } else if (kind === 'furniture' || kind === 'inset') {
    const host = declaration.host;
    const hostIds = Array.isArray(host) ? host : [host];
    if (hostIds.length === 0 || hostIds.some((id) => typeof id !== 'string' || id.length === 0)) {
      errors.push(`${label}: ${kind} 支撑缺有效宿主 host（须为非空 id 或非空 id 数组）`);
      valid = false;
    }
    valid = finiteNumber('surface') && valid;
  } else if (kind === 'ceiling') {
    valid = finiteNumber('face') && valid;
    if (declaration.drop !== undefined) valid = finiteNumber('drop') && valid;
  }
  return valid;
}

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
  // 声明本身先验（非法声明不做几何比较：缺失数值会算出 NaN、比较恒 false 而静默通过）。
  if (!validateSupportDeclaration(label, support, errors)) return;
  if (!bounds) return; // 无模型（如冷凝链示意件）：无竖向几何可比，跳过（不报错）。
  const { bottom, top } = bounds;
  // 包络本身先验（2026-11-16 Codex 四审 blocking）：非有限数或倒置包络时，所有
  // 大小比较恒 false、门禁静默通过；须在比较前拒绝。
  if (!Number.isFinite(bottom) || !Number.isFinite(top)) {
    errors.push(`${label}: 建模包络非有限数（bottom ${bottom}、top ${top}），拒绝比较`);
    return;
  }
  if (bottom > top + SUPPORT_EPS) {
    errors.push(`${label}: 建模包络倒置（bottom ${bottom}m > top ${top}m），拒绝比较`);
    return;
  }
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
