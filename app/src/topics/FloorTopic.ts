import type { Topic, SceneApi, TopicSelection } from '@shared/types';
import { floorOptions } from '../data/designData.js';
import type { HouseScene } from '../render/HouseScene.js';
import type { MaterialAppearance } from '../render/TextureFactory.js';

// DEC-041：全屋地面统一为本 topic，分房状态 = selection.roomOverrides（数据驱动，无房间硬编码）。
// 入户花园等"开发商已铺"房间不设特殊材质状态——渲染照常可自定义，仅在预算 applyRooms 与决策日志层面跳过。
export class FloorTopic implements Topic {
  id = 'floor';
  name = '地砖方案';
  options = floorOptions;

  apply(scene: SceneApi, optionId: string, selection?: TopicSelection): string[] {
    const hs = scene as unknown as HouseScene;
    const appearanceOf = (id: string): MaterialAppearance | undefined => {
      const option = this.options.find((o) => o.id === id);
      if (!option) return undefined;
      const data = option.data as Record<string, unknown> | undefined;
      return (data?.appearance as MaterialAppearance | undefined) ?? (option.color
        ? { type: 'ceramic_tile_v2', color: option.color, scale: 2 }
        : undefined);
    };

    const defaultAppearance = appearanceOf(optionId);
    if (!defaultAppearance) {
      console.warn(`[FloorTopic] 未知选项 "${optionId}"（合法选项：${this.options.map((o) => o.id).join(', ')}），地面未应用材质`);
      return [];
    }

    const overrides = selection?.roomOverrides ?? {};
    const applied: string[] = [];
    for (const roomId of hs.getAllRoomIds()) {
      if (!roomId) continue; // floor_region 无 roomId，单独走 applyFloorRegionMaterials
      const effectiveId = overrides[roomId] ?? optionId;
      const appearance = appearanceOf(effectiveId);
      if (!appearance) {
        console.warn(`[FloorTopic] 房间 ${roomId} 覆盖选项 "${effectiveId}" 不存在，回退 default "${optionId}"`);
        hs.setFloorMaterial(roomId, defaultAppearance);
      } else {
        hs.setFloorMaterial(roomId, appearance);
      }
      applied.push(`floor:${roomId}`);
    }

    // 过渡带（走廊/入户等 floor_region）：无 follow 跟 default，有 follow 跟目标房间的有效地材
    hs.applyFloorRegionMaterials(defaultAppearance, (roomId) => {
      const id = overrides[roomId] ?? optionId;
      return appearanceOf(id) ?? null;
    });

    return applied;
  }

  validate(): string[] {
    return [];
  }
}
