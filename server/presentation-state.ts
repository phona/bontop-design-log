import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CurtainPresentationState, CurtainState } from '../shared/types.js';
import { normalizeCurtainState } from '../shared/curtain-projection.js';
import { CurtainStateSchema, parseCurtainPresentationState } from '../shared/project-render-facts-schema.js';
import type { OverlayConfig } from './overlay-merge.js';

function nowIso(): string {
  return new Date().toISOString();
}

export class PresentationStateStore {
  private state: CurtainPresentationState;

  constructor(
    private dataDir = './data',
    private getOverlay: () => OverlayConfig | undefined,
  ) {
    this.state = this.loadOrInit();
  }

  private statePath(): string {
    return `${this.dataDir}/presentation-state.json`;
  }

  private loadOrInit(): CurtainPresentationState {
    const path = this.statePath();
    if (existsSync(path)) {
      return parseCurtainPresentationState(JSON.parse(readFileSync(path, 'utf8')));
    }
    const state: CurtainPresentationState = { default: 'open', roomOverrides: {}, updatedAt: nowIso() };
    this.persistState(state);
    return state;
  }

  private curtainRooms(): Map<string, 'sheer_blackout' | 'blinds'> {
    const rooms = new Map<string, 'sheer_blackout' | 'blinds'>();
    for (const element of this.getOverlay()?.elements ?? []) {
      if (element.type !== 'curtain' || !element.room) continue;
      const kind = element.kind ?? 'sheer_blackout';
      const previous = rooms.get(element.room);
      if (previous && previous !== kind) throw new Error(`room "${element.room}" mixes curtain kinds`);
      rooms.set(element.room, kind);
    }
    return rooms;
  }

  private persistState(state: CurtainPresentationState): void {
    const path = this.statePath();
    mkdirSync(dirname(path), { recursive: true });
    const tempPath = `${path}.${process.pid}.tmp`;
    writeFileSync(tempPath, JSON.stringify(state, null, 2) + '\n');
    renameSync(tempPath, path);
  }

  get(): CurtainPresentationState {
    return structuredClone(this.state);
  }

  getEffectiveStates(): Record<string, CurtainState> {
    const result: Record<string, CurtainState> = {};
    for (const [roomId, kind] of this.curtainRooms()) {
      result[roomId] = normalizeCurtainState(this.state.roomOverrides[roomId] ?? this.state.default, kind);
    }
    return result;
  }

  setCurtainState(args: { roomId?: string; state: CurtainState; expectedUpdatedAt?: string }): { conflict?: boolean; updated: boolean; state: CurtainPresentationState } {
    const requestedState = CurtainStateSchema.parse(args.state);
    if (args.expectedUpdatedAt && args.expectedUpdatedAt !== this.state.updatedAt) {
      return { conflict: true, updated: false, state: this.get() };
    }

    const rooms = this.curtainRooms();
    const next = this.get();
    if (args.roomId !== undefined) {
      const kind = rooms.get(args.roomId);
      if (!kind) throw new Error(`room "${args.roomId}" has no curtain`);
      const normalized = normalizeCurtainState(requestedState, kind);
      const previous = next.roomOverrides[args.roomId] ?? next.default;
      if (previous === normalized) return { updated: false, state: this.get() };
      next.roomOverrides[args.roomId] = normalized;
    } else {
      if (next.default === requestedState && Object.keys(next.roomOverrides).length === 0) {
        return { updated: false, state: this.get() };
      }
      next.default = requestedState;
      next.roomOverrides = {};
    }

    next.updatedAt = nowIso();
    this.persistState(next);
    this.state = next;
    return { updated: true, state: this.get() };
  }
}
