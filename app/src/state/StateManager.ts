import type { CameraState } from '@shared/types';

interface Snapshot {
  mode: 'orbit' | 'first-person';
  camera: CameraState;
  lookingAt?: {
    objectId: string;
    type: string;
    room?: string;
  };
  visibleObjects: string[];
  selectedObjects: string[];
  activeTopic: string;
  selections: Record<string, string>;
  updatedAt: string;
}

interface Command {
  id: string;
  type:
    | 'set_selection'
    | 'batch_set_selections'
    | 'set_camera_target'
    | 'highlight_object'
    | 'run_design_check';
  payload: unknown;
  reason?: string;
  createdAt: string;
}

export interface StateListener {
  onSelectionChanged(topic: string, optionId: string): void;
  onCommand(command: Command): void;
  getCameraState(): CameraState;
  getActiveObject(): { objectId: string; type: string; room?: string } | undefined;
  getVisibleObjects(): string[];
  getSelectedObjects(): string[];
}

const DEFAULT_SELECTIONS: Record<string, string> = {
  hvac: 'A2',
  floor: 'floor_tile_01',
  wall: 'wall_tile_01',
  paint: 'latex_paint_01',
};

export class StateManager {
  private selections: Record<string, string> = { ...DEFAULT_SELECTIONS };

  private activeTopic = 'hvac';
  private appliedCommandIds = new Set<string>();
  private listener?: StateListener;
  private pollTimer?: number;

  setListener(listener: StateListener) {
    this.listener = listener;
  }

  async loadSnapshot() {
    try {
      const res = await fetch('/__state/snapshot');
      if (!res.ok) return;
      const snapshot = (await res.json()) as Partial<Snapshot>;
      if (snapshot.selections && Object.keys(snapshot.selections).length > 0) {
        this.selections = { ...DEFAULT_SELECTIONS, ...snapshot.selections };
      }
      if (snapshot.activeTopic) {
        this.activeTopic = snapshot.activeTopic;
      }
    } catch {
      // ignore
    }
  }

  getSelections(): Record<string, string> {
    return { ...this.selections };
  }

  getActiveTopic(): string {
    return this.activeTopic;
  }

  setActiveTopic(topic: string) {
    this.activeTopic = topic;
  }

  async setSelection(topic: string, optionId: string) {
    this.selections[topic] = optionId;
    this.listener?.onSelectionChanged(topic, optionId);
    await this.writeSnapshot();
  }

  startPolling(intervalMs = 1000) {
    this.stopPolling();
    this.pollTimer = window.setInterval(() => this.pollCommands(), intervalMs);
  }

  stopPolling() {
    if (this.pollTimer) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private async pollCommands() {
    try {
      const res = await fetch('/__state/commands');
      if (!res.ok) return;
      const commands = (await res.json()) as Command[];
      for (const cmd of commands) {
        if (this.appliedCommandIds.has(cmd.id)) continue;
        this.appliedCommandIds.add(cmd.id);
        this.applyCommand(cmd);
        this.listener?.onCommand(cmd);
      }
    } catch {
      // ignore network errors
    }
  }

  private applyCommand(cmd: Command) {
    if (cmd.type === 'set_selection') {
      const payload = cmd.payload as { topic: string; optionId: string };
      this.selections[payload.topic] = payload.optionId;
      this.listener?.onSelectionChanged(payload.topic, payload.optionId);
    } else if (cmd.type === 'batch_set_selections') {
      const payload = cmd.payload as Array<{ topic: string; optionId: string }>;
      for (const item of payload) {
        this.selections[item.topic] = item.optionId;
        this.listener?.onSelectionChanged(item.topic, item.optionId);
      }
    }
  }

  async writeSnapshot() {
    const camera = this.listener?.getCameraState() ?? {
      position: { x: 0, y: 12, z: 18 },
      target: { x: 0, y: 0, z: 0 },
    };
    const lookingAt = this.listener?.getActiveObject();
    const visible = this.listener?.getVisibleObjects() ?? [];
    const selected = this.listener?.getSelectedObjects() ?? [];
    const snapshot: Snapshot = {
      mode: 'orbit',
      camera,
      lookingAt,
      visibleObjects: visible,
      selectedObjects: selected,
      activeTopic: this.activeTopic,
      selections: { ...this.selections },
      updatedAt: new Date().toISOString(),
    };
    try {
      await fetch('/__state/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
      });
    } catch {
      // ignore
    }
  }
}
