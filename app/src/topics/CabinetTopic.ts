import type { Topic, SceneApi } from '@shared/types';
import { cabinetOptions } from '../data/designData.js';

export class CabinetTopic implements Topic {
  id = 'cabinet';
  name = '柜体板材';
  options = cabinetOptions;

  apply(_scene: SceneApi, optionId: string): string[] {
    const option = this.options.find((o) => o.id === optionId);
    if (!option) return [];
    console.log('CabinetTopic selected:', optionId);
    return [];
  }

  validate(): string[] {
    return [];
  }
}
