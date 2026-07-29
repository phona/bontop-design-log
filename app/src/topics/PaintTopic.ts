import type { Topic, SceneApi, TopicOption } from '@shared/types';
import { paintOptions } from '../data/designData.js';
import type { HouseScene } from '../render/HouseScene.js';

export class PaintTopic implements Topic {
  id = 'paint';
  name = '乳胶漆方案';
  options = paintOptions;

  apply(scene: SceneApi, optionId: string): string[] {
    const option = this.options.find((o) => o.id === optionId);
    if (!option) return [];
    const hs = scene as unknown as HouseScene;
    const data = option.data as Record<string, unknown> | undefined;
    const appearance = (data?.appearance as { type: string; color: string; scale?: number } | undefined) ?? (option.color
      ? { type: 'matte_paint', color: option.color, scale: 1 }
      : undefined);
    if (!appearance) return [];

    const paintRoomIds = hs.getRoomIdsWithWallFinish('paint');
    for (const roomId of paintRoomIds) {
      hs.setWallMaterial(roomId, appearance);
    }
    return paintRoomIds.map((id) => `paint:${id}`);
  }

  validate(): string[] {
    return [];
  }
}
