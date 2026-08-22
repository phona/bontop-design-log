import type { Topic, SceneApi, TopicSelection } from '@shared/types';
import { wallOptions } from '../data/designData.js';
import type { HouseScene } from '../render/HouseScene.js';
import type { MaterialAppearance } from '../render/TextureFactory.js';

// DEC-041：分房状态 = selection.roomOverrides。
export class WallTopic implements Topic {
  id = 'wall';
  name = '墙砖方案';
  options = wallOptions;

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
      console.warn(`[WallTopic] 未知选项 "${optionId}"（合法选项：${this.options.map((o) => o.id).join(', ')}），墙砖未应用`);
      return [];
    }

    const overrides = selection?.roomOverrides ?? {};
    const tileRoomIds = hs.getRoomIdsWithWallFinish('tile');
    const applied: string[] = [];
    for (const roomId of tileRoomIds) {
      const effectiveId = overrides[roomId] ?? optionId;
      const appearance = appearanceOf(effectiveId);
      if (!appearance) {
        console.warn(`[WallTopic] 房间 ${roomId} 覆盖选项 "${effectiveId}" 不存在，回退 default "${optionId}"`);
      }
      hs.setWallMaterial(roomId, appearance ?? defaultAppearance);
      applied.push(`wall:${roomId}`);
    }
    return applied;
  }

  validate(): string[] {
    return [];
  }
}
