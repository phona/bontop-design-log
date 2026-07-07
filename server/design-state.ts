import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  CurrentScheme,
  DecisionLogEntry,
  TopicSelection,
  VisualCommand,
  ViewContext,
} from '../shared/types.js';
import type { ProjectCatalog } from './project-catalog.js';

export interface SelectionPatch {
  topic: string;
  optionId: string | null;
  roomId?: string | null;
  reason?: string;
}

export interface ApplyResult {
  updated: boolean;
  conflict?: boolean;
  entries: DecisionLogEntry[];
}

let globalCounter = 0;
function makeId(prefix: string): string {
  const now = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  globalCounter += 1;
  return `${prefix}_${now}_${String(globalCounter).padStart(4, '0')}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class DesignState {
  private scheme: CurrentScheme;
  private decisionLog: DecisionLogEntry[];
  private visualCommands: VisualCommand[] = [];
  private viewContext: ViewContext | null = null;

  constructor(
    private catalog: ProjectCatalog,
    private dataDir = './data'
  ) {
    this.scheme = this.loadOrInitScheme();
    this.decisionLog = this.loadOrInitDecisionLog();
  }

  static load(catalog: ProjectCatalog, dataDir = './data'): DesignState {
    return new DesignState(catalog, dataDir);
  }

  private schemePath(): string {
    return `${this.dataDir}/current-scheme.json`;
  }

  private decisionLogPath(): string {
    return `${this.dataDir}/decision-log.json`;
  }

  private loadOrInitScheme(): CurrentScheme {
    const path = this.schemePath();
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf8')) as CurrentScheme;
    }
    const selections: Record<string, TopicSelection> = {};
    for (const topic of this.catalog.getTopics()) {
      selections[topic.id] = {
        default: topic.options[0]?.id ?? null,
        roomOverrides: {},
      };
    }
    const scheme: CurrentScheme = { updatedAt: nowIso(), selections };
    mkdirSync(dirname(this.schemePath()), { recursive: true });
    writeFileSync(this.schemePath(), JSON.stringify(scheme, null, 2));
    return scheme;
  }

  private loadOrInitDecisionLog(): DecisionLogEntry[] {
    const path = this.decisionLogPath();
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf8')) as DecisionLogEntry[];
    }
    return [];
  }

  persist(): void {
    mkdirSync(dirname(this.decisionLogPath()), { recursive: true });
    writeFileSync(this.decisionLogPath(), JSON.stringify(this.decisionLog, null, 2));
    writeFileSync(this.schemePath(), JSON.stringify(this.scheme, null, 2));
  }

  getCurrentScheme(): CurrentScheme {
    return structuredClone(this.scheme);
  }

  getDecisionLog(): DecisionLogEntry[] {
    return this.decisionLog;
  }

  private validatePatch(p: SelectionPatch, index: number): void {
    if (!this.catalog.isValidTopic(p.topic)) {
      throw new Error(`selections[${index}]: unknown topic "${p.topic}"`);
    }
    const topic = this.catalog.getTopic(p.topic)!;
    const roomId = p.roomId ?? undefined;
    if (roomId !== undefined) {
      if (!topic.perRoom) {
        throw new Error(`selections[${index}]: topic "${p.topic}" does not support per-room overrides`);
      }
      if (!this.catalog.isValidRoom(roomId)) {
        throw new Error(`selections[${index}]: unknown room "${roomId}"`);
      }
    }
    if (p.optionId === null) {
      if (roomId === undefined) {
        throw new Error(`selections[${index}]: optionId null requires roomId`);
      }
    } else if (!this.catalog.isValidOption(p.topic, p.optionId)) {
      throw new Error(`selections[${index}]: unknown option "${p.optionId}" for topic "${p.topic}"`);
    }
  }

  applySelections(
    patches: SelectionPatch[],
    reason?: string,
    source = 'ai',
    expectedUpdatedAt?: string
  ): ApplyResult {
    if (expectedUpdatedAt && this.scheme.updatedAt !== expectedUpdatedAt) {
      return { updated: false, conflict: true, entries: [] };
    }

    patches.forEach((p, i) => this.validatePatch(p, i));

    const map = new Map<string, SelectionPatch>();
    for (const p of patches) {
      const key = `${p.topic}:${p.roomId ?? ''}`;
      map.set(key, p);
    }
    const uniquePatches = [...map.values()];

    const entries: DecisionLogEntry[] = [];
    let changed = false;

    for (const p of uniquePatches) {
      const topicSel = this.scheme.selections[p.topic] ?? {
        default: this.catalog.getTopic(p.topic)!.options[0]?.id ?? null,
        roomOverrides: {},
      };
      const roomId = p.roomId ?? undefined;
      const isRoomOverride = roomId !== undefined;
      const previousOptionId = isRoomOverride
        ? (topicSel.roomOverrides[roomId] ?? null)
        : topicSel.default;
      const newOptionId = isRoomOverride
        ? (p.optionId === null ? null : p.optionId)
        : (p.optionId as string);

      if (previousOptionId === newOptionId) continue;

      if (isRoomOverride) {
        if (newOptionId === null) {
          delete topicSel.roomOverrides[roomId];
        } else {
          topicSel.roomOverrides[roomId] = newOptionId;
        }
      } else {
        topicSel.default = newOptionId;
      }
      this.scheme.selections[p.topic] = topicSel;
      changed = true;

      entries.push({
        id: makeId('dec'),
        topic: p.topic,
        roomId: isRoomOverride ? roomId : null,
        optionId: newOptionId,
        previousOptionId,
        archiveId: null,
        path: isRoomOverride
          ? `${p.topic}.roomOverrides.${roomId}`
          : `${p.topic}.default`,
        reason: p.reason ?? reason,
        source,
        createdAt: nowIso(),
      });
    }

    if (changed) {
      this.scheme.updatedAt = nowIso();
      this.decisionLog.push(...entries);
      this.persist();
    }

    return { updated: changed, entries };
  }

  recordDecision(partial: {
    topic?: string;
    roomId?: string | null;
    optionId?: string | null;
    reason?: string;
    source?: string;
  }): DecisionLogEntry {
    if (!partial.topic && !partial.roomId && partial.optionId === undefined) {
      throw new Error('at least one of topic, roomId, optionId is required');
    }
    if (partial.topic && !this.catalog.isValidTopic(partial.topic)) {
      throw new Error(`unknown topic "${partial.topic}"`);
    }
    if (partial.roomId && !this.catalog.isValidRoom(partial.roomId)) {
      throw new Error(`unknown room "${partial.roomId}"`);
    }
    if (
      partial.topic &&
      partial.optionId !== undefined &&
      partial.optionId !== null &&
      !this.catalog.isValidOption(partial.topic, partial.optionId)
    ) {
      throw new Error(`unknown option "${partial.optionId}" for topic "${partial.topic}"`);
    }

    const topic = partial.topic ?? '';
    const roomId = partial.roomId ?? null;
    const entry: DecisionLogEntry = {
      id: makeId('dec'),
      topic,
      roomId,
      optionId: partial.optionId ?? null,
      previousOptionId: null,
      archiveId: null,
      path:
        topic && roomId
          ? `${topic}.roomOverrides.${roomId}`
          : topic
          ? `${topic}.default`
          : 'general',
      reason: partial.reason,
      source: partial.source ?? 'ai',
      createdAt: nowIso(),
    };
    this.decisionLog.push(entry);
    this.persist();
    return entry;
  }

  getVisualCommands(): VisualCommand[] {
    const now = Date.now();
    this.visualCommands = this.visualCommands.filter((c) => new Date(c.expiresAt).getTime() > now);
    return this.visualCommands;
  }

  appendVisualCommand(type: VisualCommand['type'], payload: unknown): VisualCommand {
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + 10000).toISOString();
    const cmd: VisualCommand = {
      commandId: makeId('vc'),
      type,
      payload,
      createdAt,
      expiresAt,
    };
    this.visualCommands.push(cmd);
    return cmd;
  }

  ackVisualCommands(ids: string[]): void {
    const set = new Set(ids);
    this.visualCommands = this.visualCommands.filter((c) => !set.has(c.commandId));
  }

  getViewContext(): ViewContext | null {
    return this.viewContext;
  }

  setViewContext(objectId: string): ViewContext {
    this.viewContext = { objectId, updatedAt: nowIso() };
    return this.viewContext;
  }
}
