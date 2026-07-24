import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';

export interface AcceptanceItem {
  item: string;
  method: string;
  standard: string;
  severity: 'critical' | 'major' | 'minor' | 'warning' | 'info';
  rooms?: string[];
  knowledge?: string;
  picture_url?: string;
  source?: string;
}

interface PhaseEntry {
  phase: string;
  name?: string;
  items: AcceptanceItem[];
}

interface AcceptanceConfigRaw {
  phases: PhaseEntry[];
}

export class AcceptanceEngine {
  private checklists: Map<string, AcceptanceItem[]> = new Map();
  private loaded = false;

  load(path = 'config/acceptance.yaml'): void {
    const data = parseYaml(readFileSync(path, 'utf8')) as AcceptanceConfigRaw;
    this.checklists.clear();
    for (const p of data.phases) {
      this.checklists.set(p.phase, p.items);
    }
    this.loaded = true;
  }

  private ensureLoaded(): void {
    if (!this.loaded) this.load();
  }

  getChecklist(phase: string): AcceptanceItem[] {
    this.ensureLoaded();
    return this.checklists.get(phase) ?? [];
  }

  getChecklistForRoom(phase: string, roomId: string): AcceptanceItem[] {
    const items = this.getChecklist(phase);
    return items.filter(i => !i.rooms || i.rooms.includes(roomId));
  }
}
