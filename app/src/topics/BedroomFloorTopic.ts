import type { Topic, SceneApi, TopicOption } from '@shared/types';
import { bedroomFloorOptions } from '../data/designData.js';
import type { HouseScene } from '../render/HouseScene.js';

// 卧室房间 id，镜像 config/design-rules.yaml 的 bedroom_floor applyRooms。
// 若卧室划分变更，须同步此处与 design-rules。
export const BEDROOM_ROOM_IDS = ['master_bedroom', 'study', 'bedroom_nw', 'bedroom_se'];

export class BedroomFloorTopic implements Topic {
  id = 'bedroom_floor';
  name = '卧室地面';
  options = bedroomFloorOptions;

  apply(scene: SceneApi, optionId: string): string[] {
    const option = this.options.find((o) => o.id === optionId);
    if (!option) return [];
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
