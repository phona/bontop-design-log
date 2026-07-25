import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { loadProcurementConfig } from './config-loader.js';

export interface TradeoffOption {
  label: string;
  cost: number;
  risk: 'low' | 'medium' | 'high';
  time_days?: number;
  acceptance_items?: string[];
  tips?: string;
  note?: string;
}

export interface Tradeoff {
  topic: string;
  label: string;
  options: TradeoffOption[];
}

interface TradeoffConfigRaw {
  tradeoffs: Tradeoff[];
}

const MATERIAL_TOPIC_MAP: Record<string, string[]> = {
  floor: ['tile_installation'],
  wall_tile: ['tile_installation'],
  paint: ['paint_brand'],
};

const DEFAULT_TOPICS = ['procurement_mode'];

export class TradeoffEngine {
  private tradeoffs: Tradeoff[] = [];
  private loaded = false;

  load(path = 'config/tradeoffs.yaml'): void {
    const data = parseYaml(readFileSync(path, 'utf8')) as TradeoffConfigRaw;
    this.tradeoffs = data.tradeoffs;
    this.loaded = true;
  }

  private ensureLoaded(): void {
    if (!this.loaded) this.load();
  }

  getTradeoffs(topic: string): Tradeoff[] {
    this.ensureLoaded();
    return this.tradeoffs.filter(t => t.topic === topic);
  }

  getAll(): Tradeoff[] {
    this.ensureLoaded();
    return this.tradeoffs.map(t => ({ ...t, options: [...t.options] }));
  }

  getAffectedTradeoffs(materialId: string): Tradeoff[] {
    this.ensureLoaded();
    const procurement = loadProcurementConfig();
    const material = procurement.materials.find(m => m.id === materialId);
    if (!material) return [];
    const topics = MATERIAL_TOPIC_MAP[material.category] ?? DEFAULT_TOPICS;
    return this.tradeoffs.filter(t => topics.includes(t.topic));
  }
}
