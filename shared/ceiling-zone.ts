/**
 * 吊顶分区的平面中心（issue #98 第五阶段 S1，设计文档 §4.4-E2/F-2 前置）。
 *
 * 由来：`normalizeCeilingZone`（area → 中心）原先只住在 `shared/render/HvacBuilder.ts`，
 * 而 MEP 端点解析 `resolveMepEndpoint` 的 ceiling 分支直读 `zone.x/z`——两条代码路径对
 * 「area-only 内机对象」的处理不同：3D 有实体、DXF/MEP 圈缺（E F-2 潜伏，§6.3-5 口径未裁）。
 * 本文件把该归一抽成单一实现，两路共用；今天 6 个 ac_* 都声明 x/z，故行为零变化。
 *
 * 语义（与原实现逐字一致）：x/z 齐备时原样返回；缺 x/z 而有 area 四边界
 * `[x1, z1, x2, z2]` 时取中心；两者皆缺原样返回（解不出由调用方显形，不发明坐标）。
 */
import type { CeilingZone } from './types.js';

export function normalizeCeilingZone(zone: CeilingZone): CeilingZone {
  if (zone.x !== undefined && zone.z !== undefined) return { ...zone };
  if (zone.area) {
    const [x1, z1, x2, z2] = zone.area;
    return { ...zone, x: (x1 + x2) / 2, z: (z1 + z2) / 2 };
  }
  return { ...zone };
}
