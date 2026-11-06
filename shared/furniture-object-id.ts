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

/** 条目摆位方式（与 shared/furniture-placement.ts 的四种定位声明 + count-only 一一对应）。 */
export type FurniturePlacementKind = 'mount' | 'wall' | 'anchor' | 'absolute' | 'count_only';

export interface DeclaredFurnitureIdEntry {
  id: string;
  roomId: string;
  type: string;
  /** 该房条目数组下标（house.yaml 原始序，与 placed 序号无关——只作溯源）。 */
  sourceIndex: number;
  placement: FurniturePlacementKind;
  /** placement === 'mount' 时的宿主稳定 id（FurnitureMount.furniture_id）。 */
  mountHost?: string;
}

/**
 * 全屋已声明稳定 id 的家具条目清单（issue #98 PR-8 按对象算账的统一入口）。
 *
 * 消费方：shared/schedule-state.ts 校验成本项 `targets`、scripts/schedule/cost-by-object.ts
 * 建「对象 → 工作包/成本项」链。placed 判定与 resolveFurniturePlacement 的四种定位
 * 声明（mount / wall / anchor / 绝对 x+z）同口径；count-only 条目无 runtime 对象，即使误声明
 * id 也不得被成本归属引用（schedule-state 校验按 placed 拦截）。
 *
 * `anchor`（issue #98 PR-10，锚点派生摆位）算 placed：它有稳定 id、摆位由另一份配置的锚点
 * 解出（shared/condensate-chain.ts），与绝对 x/z 一样有 runtime 对象——漏判会把主卫链条
 * 三件错归类成 count-only，按对象算账视图随之少件（D19 条带 7 件只剩 4 件）。
 */
export function collectDeclaredFurnitureIds(furnishings: FurnishingsYaml): DeclaredFurnitureIdEntry[] {
  const entries: DeclaredFurnitureIdEntry[] = [];
  for (const [roomId, items] of Object.entries(furnishings)) {
    items.forEach((item, sourceIndex) => {
      if (item.id === undefined) return;
      const placement: FurniturePlacementKind = item.mount
        ? 'mount'
        : item.wall
          ? 'wall'
          : item.anchor
            ? 'anchor'
            : (item.x !== undefined || item.z !== undefined)
              ? 'absolute'
              : 'count_only';
      entries.push({
        id: item.id,
        roomId,
        type: item.type,
        sourceIndex,
        placement,
        ...(item.mount ? {mountHost: item.mount.furniture_id} : {}),
      });
    });
  }
  return entries;
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
