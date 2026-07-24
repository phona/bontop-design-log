import { watch, type FSWatcher } from 'chokidar';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';

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
}

export class ConfigRegistry {
  private loaders: ConfigLoader<unknown>[] = [];

  register<T>(loader: ConfigLoader<T>): void {
    this.loaders.push(loader as ConfigLoader<unknown>);
  }

  getStatuses(): ConfigStatus[] {
    return this.loaders.map((l) => l.getStatus());
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.loaders.map((l) => l.stopWatching()));
  }
}

// ── Domain config interfaces ──────────────────────────────────────

export interface ElectricalPoint {
  id: string;
  room: string;
  wall: string;
  type: 'socket' | 'switch' | 'switch_2way' | 'network' | 'usb';
  x: number;
  z: number;
  height: number;
  count?: number;
  note?: string;
}

export interface PlumbingPoint {
  id: string;
  room: string;
  type: 'faucet' | 'toilet' | 'shower' | 'drain' | 'washer' | 'faucet_outdoor';
  x: number;
  z: number;
  height?: number;
  note?: string;
}

export interface CeilingZone {
  id: string;
  room: string;
  type: 'drop' | 'integrated' | 'cove' | 'none' | 'ac_indoor';
  thickness?: number;
  area?: [number, number, number, number];
  x?: number;
  z?: number;
  height?: number;
  model?: string;
  note?: string;
}

// ── Domain config loaders ─────────────────────────────────────────

function loadConfig<T>(path: string): T {
  return parseYaml(readFileSync(path, 'utf8')) as T;
}

export function loadElectricalConfig(): ElectricalPoint[] {
  return loadConfig<ElectricalPoint[]>('config/electrical.yaml');
}

export function loadPlumbingConfig(): PlumbingPoint[] {
  return loadConfig<PlumbingPoint[]>('config/plumbing.yaml');
}

export function loadCeilingConfig(): CeilingZone[] {
  return loadConfig<CeilingZone[]>('config/ceiling.yaml');
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
