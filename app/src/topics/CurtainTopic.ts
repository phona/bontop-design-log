import type { Topic, SceneApi, TopicOption } from '@shared/types';
import { curtainOptions } from '../data/designData.js';
import type { HouseScene } from '../render/HouseScene.js';

export class CurtainTopic implements Topic {
  id = 'curtain';
  name = '窗帘方案';
  options = curtainOptions;

  apply(scene: SceneApi, optionId: string): string[] {
    const option = this.options.find((o) => o.id === optionId);
    if (!option) return [];
    const hs = scene as unknown as HouseScene;
    const data = option.data as Record<string, unknown> | undefined;
    const appearance = data?.appearance as { type: string; color: string; opacity?: number } | undefined;
    if (appearance) {
      hs.setCurtainMaterial({ color: appearance.color, opacity: appearance.opacity });
    }
    return ['curtain:all'];
  }

  validate(): string[] {
    return [];
  }
}
