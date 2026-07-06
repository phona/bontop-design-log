import type { CurrentScheme, VisualCommand, SelectionPatch } from '@shared/types';

type SchemeCallback = (scheme: CurrentScheme) => void;
type VisualCommandCallback = (command: VisualCommand) => void;
type OfflineCallback = (offline: boolean) => void;

export class StateSync {
  private schemeInterval: ReturnType<typeof setTimeout> | null = null;
  private visualCommandInterval: ReturnType<typeof setTimeout> | null = null;
  private schemeBackoff = 1000;
  private visualCommandBackoff = 500;
  private isOffline = false;
  private schemeCallbacks: SchemeCallback[] = [];
  private visualCommandCallbacks: VisualCommandCallback[] = [];
  private offlineCallbacks: OfflineCallback[] = [];
  private currentScheme: CurrentScheme | null = null;
  private processedCommandIds = new Set<string>();

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

  start(): void {
    this.pollScheme();
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

  startVisualCommandPolling(): void {
    this.pollVisualCommands();
  }

  private async pollVisualCommands(): Promise<void> {
    try {
      const commands = await this.getVisualCommands();

      const newCommands = commands.filter(cmd => !this.processedCommandIds.has(cmd.commandId));

      for (const command of newCommands) {
        this.processedCommandIds.add(command.commandId);
        this.visualCommandCallbacks.forEach(cb => cb(command));
        await this.ackVisualCommands([command.commandId]);
      }

      this.visualCommandInterval = setTimeout(() => this.pollVisualCommands(), this.visualCommandBackoff);
    } catch {
      this.visualCommandBackoff = Math.min(this.visualCommandBackoff * 2, 8000);
      this.visualCommandInterval = setTimeout(() => this.pollVisualCommands(), this.visualCommandBackoff);
    }
  }

  dispose(): void {
    if (this.schemeInterval) clearTimeout(this.schemeInterval);
    if (this.visualCommandInterval) clearTimeout(this.visualCommandInterval);
  }
}
