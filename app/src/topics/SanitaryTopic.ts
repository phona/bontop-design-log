import type { Topic, SceneApi } from '@shared/types';
import { sanitaryOptions } from '../data/designData.js';

export class SanitaryTopic implements Topic {
  id = 'sanitary';
  name = '卫浴洁具';
  options = sanitaryOptions;

  apply(_scene: SceneApi, optionId: string): string[] {
    const option = this.options.find((o) => o.id === optionId);
    if (!option) return [];
    console.log('SanitaryTopic selected:', optionId);
    return [];
  }

  validate(): string[] {
    return [];
  }
}
