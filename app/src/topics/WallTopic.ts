import type { Topic, SceneApi, TopicOption } from '@shared/types';
import { wallOptions } from '../data/designData.js';
import type { HouseScene } from '../render/HouseScene.js';

export class WallTopic implements Topic {
  id = 'wall';
  name = '墙砖方案';
  options = wallOptions;

  apply(scene: SceneApi, optionId: string): string[] {
    const option = this.options.find((o) => o.id === optionId);
    if (!option?.color) return [];
    const tileRoomIds = (scene as unknown as HouseScene).getRoomIdsWithWallFinish('tile');
    (scene as unknown as HouseScene).setWallColor(tileRoomIds, option.color);
    return tileRoomIds.map((id) => `wall:${id}`);
  }

  validate(): string[] {
    return [];
  }
}
