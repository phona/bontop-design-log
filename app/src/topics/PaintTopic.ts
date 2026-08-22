import type { Topic, SceneApi, TopicSelection } from '@shared/types';
import { paintOptions } from '../data/designData.js';
import type { HouseScene } from '../render/HouseScene.js';
import type { MaterialAppearance } from '../render/TextureFactory.js';

// DEC-041：分房状态 = selection.roomOverrides；天花跟随所在房间墙漆。
export class PaintTopic implements Topic {
  id = 'paint';
  name = '乳胶漆方案';
  options = paintOptions;

  apply(scene: SceneApi, optionId: string, selection?: TopicSelection): string[] {
    const hs = scene as unknown as HouseScene;
    const appearanceOf = (id: string): MaterialAppearance | undefined => {
      const option = this.options.find((o) => o.id === id);
      if (!option) return undefined;
      const data = option.data as Record<string, unknown> | undefined;
      return (data?.appearance as MaterialAppearance | undefined) ?? (option.color
        ? { type: 'matte_paint', color: option.color, scale: 1 }
        : undefined);
    };

    const defaultAppearance = appearanceOf(optionId);
    if (!defaultAppearance) {
      console.warn(`[PaintTopic] 未知选项 "${optionId}"（合法选项：${this.options.map((o) => o.id).join(', ')}），墙漆未应用`);
      return [];
    }

    const overrides = selection?.roomOverrides ?? {};
    const paintRoomIds = hs.getRoomIdsWithWallFinish('paint');
    const applied: string[] = [];
    for (const roomId of paintRoomIds) {
      const effectiveId = overrides[roomId] ?? optionId;
      const appearance = appearanceOf(effectiveId);
      if (!appearance) {
        console.warn(`[PaintTopic] 房间 ${roomId} 覆盖选项 "${effectiveId}" 不存在，回退 default "${optionId}"`);
      }
      const mat = appearance ?? defaultAppearance;
      hs.setWallMaterial(roomId, mat);
      hs.setCeilingMaterial(roomId, mat);
      applied.push(`paint:${roomId}`);
    }
    return applied;
  }

  validate(): string[] {
    return [];
  }
}
