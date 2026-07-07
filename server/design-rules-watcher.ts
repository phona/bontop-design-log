import { watch, type FSWatcher } from 'chokidar';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import type { DesignRulesConfig } from '../shared/types.js';
import { RuleEngine } from './rule-engine.js';

export type RulesChangeCallback = (engine: RuleEngine) => void;

export class DesignRulesWatcher {
  private watcher: FSWatcher | null = null;
  private engine: RuleEngine;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs = 300;

  constructor(
    private configPath: string,
    private onChange: RulesChangeCallback
  ) {
    this.engine = this.loadEngine();
  }

  private loadEngine(): RuleEngine {
    try {
      const raw = readFileSync(this.configPath, 'utf8');
      const config = load(raw) as DesignRulesConfig;
      return new RuleEngine(config);
    } catch (err) {
      console.error(`[design-rules-watcher] Failed to load ${this.configPath}:`, err);
      return this.engine ?? new RuleEngine({ version: '1.0', risks: [], constraints: [] });
    }
  }

  getEngine(): RuleEngine {
    return this.engine;
  }

  start(): void {
    this.watcher = watch(this.configPath, {
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on('change', () => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        const newEngine = this.loadEngine();
        this.engine = newEngine;
        this.onChange(newEngine);
      }, this.debounceMs);
    });

    this.watcher.on('error', (err: unknown) => {
      console.error('[design-rules-watcher] Watcher error:', err);
    });
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}
