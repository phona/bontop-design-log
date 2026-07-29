import type { Topic, SceneApi, TopicOption } from '@shared/types';
import { floorOptions } from '../data/designData.js';
import type { HouseScene } from '../render/HouseScene.js';

export class FloorTopic implements Topic {
  id = 'floor';
  name = '地砖方案';
  options = floorOptions;

  apply(scene: SceneApi, optionId: string): string[] {
    const option = this.options.find((o) => o.id === optionId);
    if (!option) return [];
    const hs = scene as unknown as HouseScene;
    const data = option.data as Record<string, unknown> | undefined;
    const appearance = (data?.appearance as { type: string; color: string; scale?: number } | undefined) ?? (option.color
      ? { type: 'ceramic_tile_v2', color: option.color, scale: 2 }
      : undefined);
    if (!appearance) return [];

    const allRoomIds = hs.getAllRoomIds();
    for (const roomId of allRoomIds) {
      hs.setFloorMaterial(roomId, appearance);
    }
    return ['floor:all'];
  }

  validate(): string[] {
    return [];
  }
}
