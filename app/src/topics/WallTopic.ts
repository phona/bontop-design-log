import type { Topic, SceneApi, TopicOption } from '@shared/types';
import { wallOptions } from '../data/designData.js';
import type { HouseScene } from '../render/HouseScene.js';

export class WallTopic implements Topic {
  id = 'wall';
  name = '墙砖方案';
  options = wallOptions;

  apply(scene: SceneApi, optionId: string): string[] {
    const option = this.options.find((o) => o.id === optionId);
    if (!option) return [];
    const hs = scene as unknown as HouseScene;
    const data = option.data as Record<string, unknown> | undefined;
    const appearance = (data?.appearance as { type: string; color: string; scale?: number } | undefined) ?? (option.color
      ? { type: 'ceramic_tile_v2', color: option.color, scale: 2 }
      : undefined);
    if (!appearance) return [];

    const tileRoomIds = hs.getRoomIdsWithWallFinish('tile');
    for (const roomId of tileRoomIds) {
      hs.setWallMaterial(roomId, appearance);
    }
    return tileRoomIds.map((id) => `wall:${id}`);
  }

  validate(): string[] {
    return [];
  }
}
