import { watch, type FSWatcher } from 'chokidar';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { VALID_CEILING_TYPES, type CeilingZone, type ElectricalPoint, type ElectricalTopology, type PlumbingPoint } from '../shared/types.js';
import { parseElectricalTopology } from '../shared/project-render-facts-schema.js';
import { parseMepCoordination, type MepCoordination } from '../shared/mep-hvac-coordination-schema.js';

export { VALID_CEILING_TYPES } from '../shared/types.js';
export type { CeilingZone, ElectricalPoint, PlumbingPoint } from '../shared/types.js';

export interface ConfigStatus {
  path: string;
  status: 'ok' | 'failed';
  error?: string;
}

export class ConfigLoader<T> {
  private config: T | undefined;
  private status: ConfigStatus;
  private watcher: FSWatcher | null = null;

  constructor(
    private path: string,
    private parse: (raw: string) => T,
    private onChange: (config: T) => void
  ) {
    this.status = { path, status: 'failed' };
  }

  load(): void {
    try {
      const raw = readFileSync(this.path, 'utf8');
      const config = this.parse(raw);
      this.config = config;
      this.status = { path: this.path, status: 'ok' };
      this.onChange(config);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[config-loader] Failed to load ${this.path}:`, err);
      this.status = { path: this.path, status: 'failed', error };
    }
  }

  startWatching(): void {
    this.watcher = watch(this.path, { persistent: true, ignoreInitial: true });
    this.watcher.on('change', () => this.load());
    this.watcher.on('add', () => this.load());
    this.watcher.on('error', (err: unknown) => {
      console.error(`[config-loader] Watcher error for ${this.path}:`, err);
    });
  }

  async stopWatching(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  getConfig(): T | undefined {
    return this.config;
  }

  getStatus(): ConfigStatus {
    return this.status;
  }

  getStatuses(): ConfigStatus[] {
    return [this.status];
  }
}

export interface StatusLoader {
  getStatuses(): ConfigStatus[];
  stopWatching(): Promise<void>;
}

export class ConfigRegistry {
  private loaders: StatusLoader[] = [];

  register<T>(loader: ConfigLoader<T>): void;
  register(loader: StatusLoader): void;
  register(loader: StatusLoader): void {
    this.loaders.push(loader);
  }

  getStatuses(): ConfigStatus[] {
    return this.loaders.flatMap((l) => l.getStatuses());
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.loaders.map((l) => l.stopWatching()));
  }
}

// ── Domain config loaders ─────────────────────────────────────────

function loadConfig<T>(path: string): T {
  return parseYaml(readFileSync(path, 'utf8')) as T;
}

export function loadElectricalConfig(): ElectricalPoint[] {
  return loadConfig<ElectricalPoint[]>('config/electrical.yaml');
}

export function loadElectricalTopologyConfig(): ElectricalTopology {
  return parseElectricalTopology(readFileSync('config/electrical-topology.yaml', 'utf8'), loadElectricalConfig());
}

export function loadPlumbingConfig(): PlumbingPoint[] {
  return loadConfig<PlumbingPoint[]>('config/plumbing.yaml');
}

export function loadCeilingConfig(): CeilingZone[] {
  return loadConfig<CeilingZone[]>('config/ceiling.yaml');
}

export function loadMepCoordinationConfig(): MepCoordination {
  return parseMepCoordination(readFileSync('config/mep-hvac-coordination.yaml', 'utf8'));
}

export interface ProcurementMaterial {
  id: string;
  name: string;
  room: string | null;
  category: string;
  current_stage: string;
  waste_rate: number;
  unit: string;
  notes: string[];
}

export interface ProcurementConfig {
  materials: ProcurementMaterial[];
}

export function loadProcurementConfig(path = 'config/procurement.yaml'): ProcurementConfig {
  return loadConfig<ProcurementConfig>(path);
}
