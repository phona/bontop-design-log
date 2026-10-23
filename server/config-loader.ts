import { watch, type FSWatcher } from 'chokidar';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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

/**
 * chokidar 对同一路径的 change 事件有 50ms 节流（FSWatcher._throttle）：两次写间隔
 * 小于 50ms 时第二个事件被直接丢弃且不补发。配置编辑（编辑器保存、批量改写）可能连写，
 * 这里在每次触发后补一次延迟重读，保证任何一次写的最终状态都会在 ~250ms 内被 load。
 */
const TRAILING_READ_MS = 250;

/**
 * 目录级配置文件监听。单文件 watch 把 inotify 挂在文件的 inode 上：git checkout、
 * 编辑器「写临时文件再改名」这类原子替换会换掉 inode，旧 watch 从此静默断线——
 * 2026-10-24 实测，mv 替换一次后连后续 in-place 追加也不再触发任何事件。
 * 监听父目录（depth 0，不递归子目录）后事件挂在目录 inode 上，替换/删除/重建都能到达。
 * 同目录的多个目标合并为一个 watcher，命中任一目标文件时触发 onAnyChange。
 */
export function watchConfigFiles(paths: string[], onAnyChange: () => void): FSWatcher[] {
  const targets = new Set(paths.map((p) => resolve(p)));
  let trailing: ReturnType<typeof setTimeout> | undefined;
  const fire = () => {
    onAnyChange();
    clearTimeout(trailing);
    trailing = setTimeout(onAnyChange, TRAILING_READ_MS);
  };
  const watchers: FSWatcher[] = [];
  for (const dir of new Set([...targets].map((p) => dirname(p)))) {
    const watcher = watch(dir, { persistent: true, ignoreInitial: true, depth: 0 });
    const handler = (eventPath: unknown) => {
      if (typeof eventPath === 'string' && targets.has(resolve(eventPath))) fire();
    };
    watcher.on('change', handler);
    watcher.on('add', handler);
    watcher.on('error', (err: unknown) => {
      console.error(`[config-loader] Watcher error for ${dir}:`, err);
    });
    watchers.push(watcher);
  }
  return watchers;
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
    this.watcher = watchConfigFiles([this.path], () => this.load())[0] ?? null;
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
