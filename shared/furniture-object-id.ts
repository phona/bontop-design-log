import type { FurnishingItem, FurnishingsYaml } from './types.js';

/**
 * 家具 runtime 对象 ID 的唯一实现（issue #98 稳定工程对象 ID）。
 *
 * - 条目声明了 `id`（如 `gbath.vanity`）→ 直接用它，房间内重排不改 ID；
 * - 未声明 → 沿用旧口径 `furniture:${room}:${type}:${index}`。
 *
 * `index` 是调用方维护的「该房 placed 序号」：带 id 的条目照常占一个序号，
 * 因此给某件家具补 id 不会挪动同房其他家具的下标 ID。
 *
 * 取代此前散落五处的同一公式副本（SceneBuilder.addFurniture、verify-spatial 三处、
 * penetration/registry.placedClearanceIssues），它们现在都调用本函数。
 */
export function furnitureObjectId(roomId: string, item: Pick<FurnishingItem, 'id' | 'type'>, index: number): string {
  return item.id ?? `furniture:${roomId}:${item.type}:${index}`;
}

export interface DuplicateFurnitureId {
  id: string;
  /** 声明同一 id 的全部条目，形如 `guest_bath/vanity[0]`（房间内源数组下标）。 */
  entries: string[];
}

/**
 * 全屋范围内重复声明的家具 `id`。稳定 ID 被 anti-penetration waivers 等跨文件引用，
 * 重复会让同一引用绑到两个对象上，由 verify:furniture 以 error 拦截。
 */
export function findDuplicateFurnitureIds(furnishings: FurnishingsYaml): DuplicateFurnitureId[] {
  const byId = new Map<string, string[]>();
  for (const [roomId, items] of Object.entries(furnishings)) {
    items.forEach((item, index) => {
      if (item.id === undefined) return;
      const entries = byId.get(item.id) ?? [];
      entries.push(`${roomId}/${item.type}[${index}]`);
      byId.set(item.id, entries);
    });
  }
  return [...byId.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([id, entries]) => ({ id, entries }));
}
