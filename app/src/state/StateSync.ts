import type { CurrentScheme, VisualCommand, SelectionPatch, DecisionLogEntry, BudgetSnapshot, DesignCheckResult, ArchivedScheme } from '@shared/types';

type SchemeCallback = (scheme: CurrentScheme) => void;
type VisualCommandCallback = (command: VisualCommand) => void;
type OfflineCallback = (offline: boolean) => void;
type ConfigErrorCallback = (errors: Array<{ path: string; error: string }>) => void;

export class StateSync {
  private schemeInterval: ReturnType<typeof setTimeout> | null = null;
  private visualCommandInterval: ReturnType<typeof setTimeout> | null = null;
  private configStatusInterval: ReturnType<typeof setTimeout> | null = null;
  private schemeBackoff = 1000;
  private visualCommandBackoff = 500;
  private isOffline = false;
  private schemeCallbacks: SchemeCallback[] = [];
  private visualCommandCallbacks: VisualCommandCallback[] = [];
  private offlineCallbacks: OfflineCallback[] = [];
  private configErrorCallbacks: ConfigErrorCallback[] = [];
  private currentScheme: CurrentScheme | null = null;
  private processedCommandIds = new Map<string, number>();

  async getCurrentScheme(): Promise<CurrentScheme> {
    const response = await fetch('/api/scheme/current');
    if (!response.ok) throw new Error('Failed to fetch scheme');
    return response.json();
  }

  async updateScheme(selections: SelectionPatch[]): Promise<void> {
    const response = await fetch('/api/scheme/current', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selections, source: 'user' }),
    });
    if (!response.ok) throw new Error('Failed to update scheme');
  }

  async fetchScheme(): Promise<CurrentScheme> {
    return this.getCurrentScheme();
  }

  async fetchDecisions(): Promise<DecisionLogEntry[]> {
    const response = await fetch('/api/decisions');
    if (!response.ok) throw new Error('Failed to fetch decisions');
    return response.json();
  }

  async fetchBudget(): Promise<BudgetSnapshot> {
    const response = await fetch('/api/budget');
    if (!response.ok) throw new Error('Failed to fetch budget');
    return response.json();
  }

  async fetchRisks(): Promise<DesignCheckResult> {
    const response = await fetch('/api/risks');
    if (!response.ok) throw new Error('Failed to fetch risks');
    return response.json();
  }

  async fetchConfigStatus(): Promise<{ configs: Array<{ path: string; status: 'ok' | 'failed'; error?: string }> }> {
    const response = await fetch('/api/config-status');
    if (!response.ok) throw new Error('Failed to fetch config status');
    return response.json();
  }

  async fetchArchivedSchemes(): Promise<Pick<ArchivedScheme, 'id' | 'name' | 'createdAt'>[]> {
    const response = await fetch('/api/schemes');
    if (!response.ok) throw new Error('Failed to fetch archived schemes');
    return response.json();
  }

  async archiveScheme(name: string, reason?: string): Promise<ArchivedScheme> {
    const response = await fetch('/api/schemes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, reason }),
    });
    if (!response.ok) throw new Error('Failed to archive scheme');
    return response.json();
  }

  async restoreScheme(id: string): Promise<void> {
    const response = await fetch(`/api/schemes/${id}/restore`, { method: 'POST' });
    if (!response.ok) throw new Error('Failed to restore scheme');
  }

  async deleteArchivedScheme(id: string): Promise<void> {
    const response = await fetch(`/api/schemes/${id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Failed to delete archived scheme');
  }

  async getVisualCommands(): Promise<VisualCommand[]> {
    const response = await fetch('/api/visual-commands');
    if (!response.ok) throw new Error('Failed to fetch visual commands');
    return response.json();
  }

  async ackVisualCommands(ids: string[]): Promise<void> {
    const response = await fetch('/api/visual-commands/ack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!response.ok) throw new Error('Failed to ack visual commands');
  }

  async postViewContext(objectId: string): Promise<void> {
    const response = await fetch('/api/view-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ objectId }),
    });
    if (!response.ok) throw new Error('Failed to post view context');
  }

  onSchemeChange(callback: SchemeCallback): void {
    this.schemeCallbacks.push(callback);
  }

  onVisualCommand(callback: VisualCommandCallback): void {
    this.visualCommandCallbacks.push(callback);
  }

  onOfflineChange(callback: OfflineCallback): void {
    this.offlineCallbacks.push(callback);
  }

  onConfigError(callback: ConfigErrorCallback): void {
    this.configErrorCallbacks.push(callback);
  }

  start(): void {
    this.pollScheme();
    this.pollVisualCommands();
    this.pollConfigStatus();
  }

  private async pollScheme(): Promise<void> {
    try {
      const scheme = await this.getCurrentScheme();

      if (this.isOffline) {
        this.isOffline = false;
        this.schemeBackoff = 1000;
        this.offlineCallbacks.forEach(cb => cb(false));
      }

      if (!this.currentScheme || JSON.stringify(this.currentScheme) !== JSON.stringify(scheme)) {
        this.currentScheme = scheme;
        this.schemeCallbacks.forEach(cb => cb(scheme));
      }

      this.schemeInterval = setTimeout(() => this.pollScheme(), this.schemeBackoff);
    } catch {
      if (!this.isOffline) {
        this.isOffline = true;
        this.offlineCallbacks.forEach(cb => cb(true));
      }

      this.schemeInterval = setTimeout(() => this.pollScheme(), this.schemeBackoff);
      this.schemeBackoff = Math.min(this.schemeBackoff * 2, 8000);
    }
  }

  private async pollVisualCommands(): Promise<void> {
    try {
      const commands = await this.getVisualCommands();

      this.cleanupProcessedCommandIds();

      const newCommands = commands.filter(cmd => !this.processedCommandIds.has(cmd.commandId));

      for (const command of newCommands) {
        this.processedCommandIds.set(command.commandId, new Date(command.expiresAt).getTime());
        this.visualCommandCallbacks.forEach(cb => cb(command));
        await this.ackVisualCommands([command.commandId]);
      }

      this.visualCommandInterval = setTimeout(() => this.pollVisualCommands(), this.visualCommandBackoff);
    } catch {
      this.visualCommandBackoff = Math.min(this.visualCommandBackoff * 2, 8000);
      this.visualCommandInterval = setTimeout(() => this.pollVisualCommands(), this.visualCommandBackoff);
    }
  }

  private async pollConfigStatus(): Promise<void> {
    try {
      const result = await this.fetchConfigStatus();
      const errors = result.configs
        .filter((c) => c.status === 'failed')
        .map((c) => ({ path: c.path, error: c.error ?? 'unknown error' }));
      this.configErrorCallbacks.forEach((cb) => cb(errors));
      this.configStatusInterval = setTimeout(() => this.pollConfigStatus(), this.schemeBackoff);
    } catch {
      this.configStatusInterval = setTimeout(() => this.pollConfigStatus(), this.schemeBackoff);
    }
  }

  private cleanupProcessedCommandIds(): void {
    const now = Date.now();
    for (const [id, expiresAt] of this.processedCommandIds.entries()) {
      if (expiresAt <= now) {
        this.processedCommandIds.delete(id);
      }
    }
  }

  dispose(): void {
    if (this.schemeInterval) clearTimeout(this.schemeInterval);
    if (this.visualCommandInterval) clearTimeout(this.visualCommandInterval);
    if (this.configStatusInterval) clearTimeout(this.configStatusInterval);
    this.processedCommandIds.clear();
  }
}
