import type { Topic, SceneApi, TopicOption } from '@shared/types';
import { wallOptions } from '../data/designData.js';
import type { HouseScene } from '../render/HouseScene.js';

const WALL_ROOMS = ['kitchen', 'master_bath', 'guest_bath'];

export class WallTopic implements Topic {
  id = 'wall';
  name = '墙砖方案';
  options = wallOptions;

  apply(scene: SceneApi, optionId: string): string[] {
    const option = this.options.find((o) => o.id === optionId);
    if (!option?.color) return [];
    (scene as unknown as HouseScene).setWallColor(WALL_ROOMS, option.color);
    return WALL_ROOMS.map((id) => `wall:${id}`);
  }

  validate(): string[] {
    return [];
  }
}
