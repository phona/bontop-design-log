import type { Topic, SceneApi, TopicOption } from '@shared/types';
import { bedroomFloorOptions } from '../data/designData.js';
import type { HouseScene } from '../render/HouseScene.js';

// 卧室房间 id 定义在零依赖的 bedroom-room-ids.ts（渲染层引用时不会连带加载 designData）
import { BEDROOM_ROOM_IDS } from './bedroom-room-ids.js';
export { BEDROOM_ROOM_IDS } from './bedroom-room-ids.js';

export class BedroomFloorTopic implements Topic {
  id = 'bedroom_floor';
  name = '卧室地面';
  options = bedroomFloorOptions;

  apply(scene: SceneApi, optionId: string): string[] {
    const option = this.options.find((o) => o.id === optionId);
    if (!option) {
      // 静默返回会让卧室地面停留在默认底色、难以察觉（历史事故：scheme 写入了 floor topic 的选项 id）
      console.warn(`[BedroomFloorTopic] 未知选项 "${optionId}"（合法选项：${this.options.map((o) => o.id).join(', ')}），卧室地面未应用材质`);
      return [];
    }
    const hs = scene as unknown as HouseScene;
    const data = option.data as Record<string, unknown> | undefined;
    const appearance = (data?.appearance as { type: string; color: string; scale?: number } | undefined) ?? (option.color
      ? { type: 'wood_grain_v2', color: option.color, scale: 2 }
      : undefined);
    if (!appearance) return [];

    for (const roomId of BEDROOM_ROOM_IDS) {
      hs.setFloorMaterial(roomId, appearance);
    }
    return BEDROOM_ROOM_IDS.map((id) => `bedroom_floor:${id}`);
  }

  validate(): string[] {
    return [];
  }
}
