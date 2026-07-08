import { watch, type FSWatcher } from 'chokidar';
import { readFileSync } from 'node:fs';

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
