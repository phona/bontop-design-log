import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { ProjectCatalog } from './project-catalog.js';

export type LifecycleStage = 'selection' | 'quantity' | 'purchased' | 'delivered' | 'installed' | 'accepted' | 'maintenance' | 'returned';

export interface MaterialStatus {
  id: string;
  stage: LifecycleStage;
  quantity?: { area: number; wasteRate: number; total: number; unit: string };
  notes: string[];
}

interface ProcurementMaterialRaw {
  id: string;
  name: string;
  room: string | null;
  category: string;
  current_stage: LifecycleStage;
  waste_rate: number;
  unit: string;
  notes: string[];
}

interface ProcurementConfigRaw {
  materials: ProcurementMaterialRaw[];
}

export class LifecycleEngine {
  private materials: Map<string, MaterialStatus> = new Map();
  private rawEntries: Map<string, ProcurementMaterialRaw> = new Map();
  private loaded = false;

  load(configPath = 'config/procurement.yaml'): void {
    const data = parseYaml(readFileSync(configPath, 'utf8')) as ProcurementConfigRaw;
    this.materials.clear();
    this.rawEntries.clear();
    for (const m of data.materials) {
      this.rawEntries.set(m.id, m);
      this.materials.set(m.id, {
        id: m.id,
        stage: m.current_stage ?? 'selection',
        notes: m.notes ?? [],
      });
    }
    this.loaded = true;
  }

  private ensureLoaded(): void {
    if (!this.loaded) this.load();
  }

  getStatus(materialId: string): MaterialStatus {
    this.ensureLoaded();
    const s = this.materials.get(materialId);
    if (!s) throw new Error(`Unknown material: ${materialId}`);
    return { ...s };
  }

  setStage(materialId: string, stage: LifecycleStage): void {
    this.ensureLoaded();
    const s = this.materials.get(materialId);
    if (!s) throw new Error(`Unknown material: ${materialId}`);
    s.stage = stage;
  }

  calculateQuantity(materialId: string): { area: number; wasteRate: number; total: number; unit: string } {
    this.ensureLoaded();
    const entry = this.rawEntries.get(materialId);
    if (!entry) throw new Error(`Unknown material: ${materialId}`);

    const catalog = ProjectCatalog.load('.');
    let area = 0;

    if (entry.room === null) {
      for (const room of catalog.getRooms()) {
        area += room.area ?? room.width * room.depth;
      }
    } else {
      const room = catalog.getRoom(entry.room);
      if (!room) throw new Error(`Unknown room: ${entry.room}`);
      area = room.area ?? room.width * room.depth;
    }

    return {
      area,
      wasteRate: entry.waste_rate,
      total: area * entry.waste_rate,
      unit: entry.unit,
    };
  }

  getAllStatuses(): MaterialStatus[] {
    this.ensureLoaded();
    return [...this.materials.values()].map(s => ({ ...s }));
  }
}
