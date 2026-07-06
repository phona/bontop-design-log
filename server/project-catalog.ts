import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import type {
  MaterialsYaml,
  RoomLayout,
  DesignOption,
  CatalogTopic,
  MaterialItem,
} from '../shared/types.js';
import { hvacSchemes, rooms, platform } from '../shared/houseData.js';

const MATERIAL_TOPIC_MAP: Record<string, string> = {
  地砖: 'floor',
  墙砖: 'wall',
  乳胶漆: 'paint',
};

export interface BudgetCategory {
  key: string;
  budget: number;
  actual: number;
  status: string;
  notes: string;
}

function materialToOption(m: MaterialItem): DesignOption | null {
  const topicId = MATERIAL_TOPIC_MAP[m.category];
  if (!topicId) return null;
  return {
    id: m.id,
    topicId,
    name: m.name,
    description: `${m.brand} ${m.model} · ${m.price_per_unit} 元/${m.unit}`,
    price_per_unit: m.price_per_unit,
    coverage_per_unit: m.coverage_per_unit,
    loss_rate: m.loss_rate,
    data: m,
  };
}

export class ProjectCatalog {
  private topics = new Map<string, CatalogTopic>();
  private rooms = new Map<string, RoomLayout>();
  private budgetCategories: BudgetCategory[] = [];

  constructor(
    materials: MaterialsYaml,
    budgetBase: {
      total_budget: number;
      categories: Record<string, Omit<BudgetCategory, 'key'>>;
    }
  ) {
    for (const m of materials.materials) {
      const opt = materialToOption(m);
      if (!opt) continue;
      let topic = this.topics.get(opt.topicId);
      if (!topic) {
        topic = {
          id: opt.topicId,
          name: m.category,
          perRoom: true,
          options: [],
        };
        this.topics.set(opt.topicId, topic);
      }
      topic.options.push(opt);
    }

    this.topics.set('hvac', {
      id: 'hvac',
      name: '空调方案',
      perRoom: false,
      options: hvacSchemes.map((s) => ({
        id: s.id,
        topicId: 'hvac',
        name: s.name,
        description: s.desc,
        price_per_unit: s.price_per_unit,
        coverage_per_unit: 1,
        loss_rate: 1,
        data: s,
      })),
    });

    for (const r of rooms) this.rooms.set(r.id, r);
    this.rooms.set(platform.id, platform);

    this.budgetCategories = Object.entries(budgetBase.categories).map(([key, c]) => ({
      key,
      ...c,
    }));
  }

  static load(configDir = '.'): ProjectCatalog {
    const materials = load(readFileSync(`${configDir}/config/materials.yaml`, 'utf8')) as MaterialsYaml;
    const budgetBase = JSON.parse(readFileSync(`${configDir}/budget/base.json`, 'utf8')) as {
      total_budget: number;
      categories: Record<string, Omit<BudgetCategory, 'key'>>;
    };
    return new ProjectCatalog(materials, budgetBase);
  }

  getTopics(): CatalogTopic[] {
    return [...this.topics.values()];
  }

  getTopic(id: string): CatalogTopic | undefined {
    return this.topics.get(id);
  }

  getOptions(topicId: string): DesignOption[] {
    return this.topics.get(topicId)?.options ?? [];
  }

  getOption(topicId: string, optionId: string): DesignOption | undefined {
    return this.getOptions(topicId).find((o) => o.id === optionId);
  }

  getRoom(id: string): RoomLayout | undefined {
    return this.rooms.get(id);
  }

  getRooms(): RoomLayout[] {
    return [...this.rooms.values()];
  }

  getBudgetCategories(): BudgetCategory[] {
    return this.budgetCategories;
  }

  isValidTopic(topicId: string): boolean {
    return this.topics.has(topicId);
  }

  isValidOption(topicId: string, optionId: string): boolean {
    return this.getOption(topicId, optionId) !== undefined;
  }

  isValidRoom(roomId: string): boolean {
    return this.rooms.has(roomId);
  }
}
