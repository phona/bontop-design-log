import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pinyin } from 'pinyin-pro';
import type {
  ArchivedScheme,
  CurrentScheme,
  DiffEntry,
  TopicSelection,
} from '../shared/types.js';

function generateSlug(name: string): string {
  let slug: string;
  try {
    slug = pinyin(name, { toneType: 'none', type: 'array' }).join('').toLowerCase();
  } catch {
    slug = name.toLowerCase();
  }
  slug = slug.replace(/[^a-z0-9]+/g, '-');
  slug = slug.replace(/^-+|-+$/g, '');
  slug = slug.slice(0, 30);
  slug = slug.replace(/^-+|-+$/g, '');
  if (!slug) slug = 'archive';
  return slug;
}

function generateTimestamp(): string {
  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${y}${mo}${d}_${h}${mi}${s}`;
}

export class ArchivedSchemesStore {
  private schemes: ArchivedScheme[] = [];
  private readonly filePath: string;

  constructor(dataDir = './data') {
    this.filePath = `${dataDir}/archived-schemes.json`;
    this.schemes = this.loadFromDisk();
  }

  private loadFromDisk(): ArchivedScheme[] {
    if (!existsSync(this.filePath)) return [];
    return JSON.parse(readFileSync(this.filePath, 'utf8')) as ArchivedScheme[];
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.schemes, null, 2));
  }

  private generateId(name: string): string {
    const timestamp = generateTimestamp();
    let slug = generateSlug(name);
    const baseId = `archived_${timestamp}_${slug}`;
    if (!this.schemes.some((s) => s.id === baseId)) return baseId;
    let n = 2;
    while (this.schemes.some((s) => s.id === `${baseId}-${n}`)) n++;
    return `${baseId}-${n}`;
  }

  list(): Array<Pick<ArchivedScheme, 'id' | 'name' | 'createdAt'>> {
    return this.schemes.map((s) => ({
      id: s.id,
      name: s.name,
      createdAt: s.createdAt,
    }));
  }

  get(id: string): ArchivedScheme | undefined {
    return this.schemes.find((s) => s.id === id);
  }

  create(
    scheme: CurrentScheme,
    name: string,
    reason?: string
  ): { scheme: ArchivedScheme; error?: string } {
    if (this.schemes.some((s) => s.name === name)) {
      return { scheme: null as any, error: 'name_conflict' };
    }
    const id = this.generateId(name);
    const archived: ArchivedScheme = {
      id,
      name,
      selections: structuredClone(scheme.selections),
      reason,
      createdAt: new Date().toISOString(),
    };
    this.schemes.push(archived);
    this.persist();
    return { scheme: archived };
  }

  delete(id: string): boolean {
    const idx = this.schemes.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    this.schemes.splice(idx, 1);
    this.persist();
    return true;
  }

  diff(archivedId: string, current: CurrentScheme): DiffEntry[] | undefined {
    const archived = this.get(archivedId);
    if (!archived) return undefined;

    const entries: DiffEntry[] = [];
    const allTopics = new Set([
      ...Object.keys(archived.selections),
      ...Object.keys(current.selections),
    ]);

    for (const topic of allTopics) {
      const archSel: TopicSelection = archived.selections[topic] ?? {
        default: null,
        roomOverrides: {},
      };
      const curSel: TopicSelection = current.selections[topic] ?? {
        default: null,
        roomOverrides: {},
      };

      if (archSel.default !== curSel.default) {
        entries.push({
          path: `${topic}.default`,
          current: curSel.default,
          archived: archSel.default,
        });
      }

      const allRooms = new Set([
        ...Object.keys(archSel.roomOverrides),
        ...Object.keys(curSel.roomOverrides),
      ]);

      for (const roomId of allRooms) {
        const archOverride = archSel.roomOverrides[roomId] ?? null;
        const curOverride = curSel.roomOverrides[roomId] ?? null;
        if (archOverride !== curOverride) {
          entries.push({
            path: `${topic}.roomOverrides.${roomId}`,
            current: curOverride,
            archived: archOverride,
          });
        }
      }
    }

    return entries;
  }
}

export { generateSlug };
