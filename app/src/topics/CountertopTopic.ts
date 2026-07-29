import type { Topic, SceneApi } from '@shared/types';
import { countertopOptions } from '../data/designData.js';

export class CountertopTopic implements Topic {
  id = 'countertop';
  name = '台面方案';
  options = countertopOptions;

  apply(_scene: SceneApi, optionId: string): string[] {
    const option = this.options.find((o) => o.id === optionId);
    if (!option) return [];
    console.log('CountertopTopic selected:', optionId);
    return [];
  }

  validate(): string[] {
    return [];
  }
}
