import type { Topic, SceneApi } from '@shared/types';
import { countertopOptions } from '../data/designData.js';
import type { HouseScene } from '../render/HouseScene.js';

export class CountertopTopic implements Topic {
  id = 'countertop';
  name = '台面方案';
  options = countertopOptions;

  apply(scene: SceneApi, optionId: string): string[] {
    const option = this.options.find((o) => o.id === optionId);
    if (!option) return [];
    const appearance = (option.data as { appearance?: { type: string; color: string } } | undefined)?.appearance;
    if (!appearance) return [];
    (scene as unknown as HouseScene).setCountertopMaterial(appearance);
    return ['countertop:kitchen'];
  }

  validate(): string[] {
    return [];
  }
}
