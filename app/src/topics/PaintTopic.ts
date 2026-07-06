import type { Topic, SceneApi, TopicOption } from '@shared/types';
import { paintOptions } from '../data/designData.js';
import type { HouseScene } from '../render/HouseScene.js';

const EXCLUDE_PAINT = ['master_bath', 'guest_bath', 'kitchen'];

export class PaintTopic implements Topic {
  id = 'paint';
  name = '乳胶漆方案';
  options = paintOptions;

  apply(scene: SceneApi, optionId: string): string[] {
    const option = this.options.find((o) => o.id === optionId);
    if (!option?.color) return [];
    (scene as unknown as HouseScene).setPaintColor(option.color, EXCLUDE_PAINT);
    return ['paint:rooms'];
  }

  validate(): string[] {
    return [];
  }
}
