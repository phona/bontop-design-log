import type { Topic, SceneApi, TopicOption } from '@shared/types';
import { floorOptions } from '../data/designData.js';
import type { HouseScene } from '../render/HouseScene.js';

export class FloorTopic implements Topic {
  id = 'floor';
  name = '地砖方案';
  options = floorOptions;

  apply(scene: SceneApi, optionId: string): string[] {
    const option = this.options.find((o) => o.id === optionId);
    if (!option?.color) return [];
    (scene as unknown as HouseScene).setFloorColor(option.color);
    return ['floor:all'];
  }

  validate(): string[] {
    return [];
  }
}
