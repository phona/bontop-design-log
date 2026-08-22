import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { load } from 'js-yaml';
import type {
  MaterialsYaml,
  RoomLayout,
  DesignOption,
  CatalogTopic,
  MaterialItem,
  CadLayoutYaml,
  HouseYaml,
  LayoutRoom,
  PlatformLayout,
  LayoutOption,
  FurnishingsYaml,
  RoomFurnishings,
  ElectricalMarker,
  WallSegment,
  DataConfidence,
} from '../shared/types.js';
import { hvacSchemes } from '../shared/houseData.js';
import { resolveLayout } from './layout-resolver.js';
import type { VertexLayoutYaml, ResolvedRoom, WallDef, RoomDef, ResolvedOpening } from '../shared/types.js';

export interface BudgetCategory {
  key: string;
  budget: number;
  actual: number;
  status: string;
  notes: string;
}

function materialToOption(m: MaterialItem): DesignOption | null {
  const topicId = m.topic_id;
  if (!topicId) return null;
  return {
    id: m.id,
    topicId,
    name: m.name,
    description: `${m.brand} ${m.model} · ${m.price_per_unit} 元/${m.unit}`,
    price_per_unit: m.price_per_unit,
    coverage_per_unit: m.coverage_per_unit,
    loss_rate: m.loss_rate,
    data: {
      ...m,
      alternative_group: m.alternative_group,
      calc_mode: m.calc_mode,
      pros: m.pros,
      cons: m.cons,
      price_source: m.price_source,
      appearance: m.appearance,
    },
  };
}

function mergeRoom(layoutRoom: LayoutRoom, meta?: HouseYaml['rooms'][number]): RoomLayout {
  return {
    id: layoutRoom.id,
    name: meta?.name ?? layoutRoom.name,
    x: layoutRoom.x,
    z: layoutRoom.z,
    width: layoutRoom.width,
    depth: layoutRoom.depth,
    height: layoutRoom.height,
    type: meta?.type ?? 'public',
    needs_waterproof: meta?.needs_waterproof,
    area: layoutRoom.area,
  };
}

function findRoomsForWall(wall: WallDef, rooms: RoomDef[]): string[] {
  return rooms
    .filter(r => r.boundary.includes(wall.from) && r.boundary.includes(wall.to))
    .map(r => r.id);
}

function mergePlatform(layoutPlatform: PlatformLayout): RoomLayout {
  return {
    id: layoutPlatform.id,
    name: layoutPlatform.name,
    x: layoutPlatform.x,
    z: layoutPlatform.z,
    width: layoutPlatform.width,
    depth: layoutPlatform.depth,
    height: layoutPlatform.height,
    type: 'service',
  };
}

export class ProjectCatalog {
  private topics = new Map<string, CatalogTopic>();
  private rooms = new Map<string, RoomLayout>();
  private platform: RoomLayout | undefined;
  private budgetCategories: BudgetCategory[] = [];
  private furnishings: FurnishingsYaml = {};
  private electricalMarkers: ElectricalMarker[] = [];
  private walls: WallSegment[] = [];
  private layoutSource: string = '';
  private rawMaterials: MaterialItem[] = [];
  private dataPrecision: Record<string, unknown> = {};

  constructor(
    materials: MaterialsYaml,
    budgetBase: {
      total_budget: number;
      categories: Record<string, Omit<BudgetCategory, 'key'>>;
    },
    layout: CadLayoutYaml,
    houseMeta?: HouseYaml,
    layoutSource?: string
  ) {
    this.rawMaterials = materials.materials;
    this.dataPrecision = (houseMeta?.project?.data_precision as Record<string, unknown>) ?? {};
    for (const m of materials.materials) {
      const opt = materialToOption(m);
      if (!opt) continue;
      let topic = this.topics.get(opt.topicId);
      if (!topic) {
        topic = {
          id: opt.topicId,
          name: m.category,
          perRoom: true,
          options: [],
        };
        this.topics.set(opt.topicId, topic);
      }
      topic.options.push(opt);
    }

    this.topics.set('hvac', {
      id: 'hvac',
      name: '空调方案',
      perRoom: false,
      options: hvacSchemes.map((s) => ({
        id: s.id,
        topicId: 'hvac',
        name: s.name,
        description: s.desc,
        price_per_unit: s.price_per_unit,
        coverage_per_unit: 1,
        loss_rate: 1,
        data: s,
      })),
    });

    this.furnishings = houseMeta?.furnishings ?? {};
    this.electricalMarkers = houseMeta?.electrical ?? [];
    this.walls = layout.walls ?? [];
    this.layoutSource = layoutSource ?? layout.source;

    const allMeta = [...(houseMeta?.rooms ?? []), ...(houseMeta?.gift_areas ?? [])];
    const metaMap = new Map(allMeta.map((r) => [r.id, r] as [string, HouseYaml['rooms'][number]]));
    if ('vertices' in layout && (layout as unknown as VertexLayoutYaml).vertices) {
      const vlayout = layout as unknown as VertexLayoutYaml;
      const resolved = resolveLayout(vlayout);

      const wallOpeningsByRoom = new Map<string, ResolvedOpening[]>();
      for (let i = 0; i < resolved.walls.length; i++) {
        const w = resolved.walls[i];
        if (!w.openings) continue;
        const rawWall = vlayout.walls[i];
        for (const op of w.openings) {
          const roomIds = op.room
            ? [op.room]
            : findRoomsForWall(rawWall, vlayout.rooms);
          for (const rid of roomIds) {
            if (!wallOpeningsByRoom.has(rid)) wallOpeningsByRoom.set(rid, []);
            wallOpeningsByRoom.get(rid)!.push(op);
          }
        }
      }

      this.rooms.clear();
      for (const r of resolved.rooms) {
        const meta = metaMap.get(r.id);
        this.rooms.set(r.id, {
          ...r,
          type: (meta?.type ?? 'public') as RoomLayout['type'],
          needs_waterproof: meta?.needs_waterproof,
          wallOpenings: wallOpeningsByRoom.get(r.id),
        });
      }
      if (resolved.platform) {
        this.platform = {
          ...resolved.platform,
          type: 'service',
        };
      }
      this.walls = resolved.walls.map((w, i) => {
        // 墙→房间归属：复用 findRoomsForWall 拓扑（boundary 同时含 from/to 顶点），渲染端据此给厨卫墙挂砖
        const wallRooms = findRoomsForWall(vlayout.walls[i], vlayout.rooms);
        return { id: w.id, x1: w.x1, z1: w.z1, x2: w.x2, z2: w.z2, segments: w.segments, fromX: w.fromX, fromZ: w.fromZ, fromRadius: w.fromRadius, arcCenterX: w.arcCenterX, arcCenterZ: w.arcCenterZ, openings: w.openings, ...(wallRooms.length ? { rooms: wallRooms } : {}) };
      });
    } else {
      for (const r of layout.rooms) {
        this.rooms.set(r.id, mergeRoom(r, metaMap.get(r.id)));
      }
      if (layout.platform) {
        this.platform = mergePlatform(layout.platform);
      }
    }

    this.budgetCategories = Object.entries(budgetBase.categories).map(([key, c]) => ({
      key,
      ...c,
    }));
  }

  static getLayouts(configDir = '.'): LayoutOption[] {
    const layoutDir = join(configDir, 'config/layout');
    const results: LayoutOption[] = [];
    try {
      const files = readdirSync(layoutDir).filter((f) => f.endsWith('.yaml'));
      for (const file of files) {
        const yaml = load(readFileSync(join(layoutDir, file), 'utf8')) as CadLayoutYaml;
        results.push({
          name: basename(file, '.yaml'),
          path: `config/layout/${file}`,
          rooms: yaml.rooms.map((r) => ({ id: r.id, name: r.name })),
          platform: yaml.platform ? { id: yaml.platform.id, name: yaml.platform.name } : undefined,
        });
      }
    } catch {
      // directory may not exist or be empty
    }
    return results;
  }

  static load(configDir = '.', layoutName?: string): ProjectCatalog {
    const materials = load(readFileSync(`${configDir}/config/materials.yaml`, 'utf8')) as MaterialsYaml;
    const budgetBase = JSON.parse(readFileSync(`${configDir}/config/budget/base.json`, 'utf8')) as {
      total_budget: number;
      categories: Record<string, Omit<BudgetCategory, 'key'>>;
    };
    const layoutPath = layoutName
      ? `${configDir}/config/layout/${layoutName}.yaml`
      : `${configDir}/config/layout/model-geometry.yaml`;
    const layout = load(readFileSync(layoutPath, 'utf8')) as CadLayoutYaml;
    const houseMeta = load(readFileSync(`${configDir}/config/house.yaml`, 'utf8')) as HouseYaml;
    return new ProjectCatalog(materials, budgetBase, layout, houseMeta, basename(layoutPath, '.yaml'));
  }

  static fromMaterials(
    materials: MaterialsYaml,
    budgetBase: {
      total_budget: number;
      categories: Record<string, Omit<BudgetCategory, 'key'>>;
    },
    layout: CadLayoutYaml,
    houseMeta?: HouseYaml,
    layoutSource?: string
  ): ProjectCatalog {
    return new ProjectCatalog(materials, budgetBase, layout, houseMeta, layoutSource);
  }

  getTopics(): CatalogTopic[] {
    return [...this.topics.values()];
  }

  getTopic(id: string): CatalogTopic | undefined {
    return this.topics.get(id);
  }

  getOptions(topicId: string): DesignOption[] {
    return this.topics.get(topicId)?.options ?? [];
  }

  getOption(topicId: string, optionId: string): DesignOption | undefined {
    return this.getOptions(topicId).find((o) => o.id === optionId);
  }

  getRoom(id: string): RoomLayout | undefined {
    return this.rooms.get(id);
  }

  getRooms(): RoomLayout[] {
    return [...this.rooms.values()];
  }

  getPlatform(): RoomLayout | undefined {
    return this.platform;
  }

  getFurnishings(): FurnishingsYaml {
    return this.furnishings;
  }

  getFurnishingCounts(roomId: string): Record<string, number> {
    const items = this.furnishings[roomId];
    if (!items) return {};
    const counts: Record<string, number> = {};
    for (const item of items) {
      const placed = item.x !== undefined && item.z !== undefined;
      counts[item.type] = (counts[item.type] ?? 0) + (placed ? 1 : (item.count ?? 1));
    }
    return counts;
  }

  getElectricalMarkers(): ElectricalMarker[] {
    return this.electricalMarkers;
  }

  getWalls(): WallSegment[] {
    return this.walls;
  }

  getLayoutSource(): string {
    return this.layoutSource;
  }

  getBudgetCategories(): BudgetCategory[] {
    return this.budgetCategories;
  }

  isValidTopic(topicId: string): boolean {
    return this.topics.has(topicId);
  }

  isValidOption(topicId: string, optionId: string): boolean {
    return this.getOption(topicId, optionId) !== undefined;
  }

  isValidRoom(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  getAllMaterials(): MaterialItem[] {
    return this.rawMaterials;
  }

  getDataPrecision(): DataConfidence {
    const materials = this.rawMaterials;
    const candidate = materials.filter((m) => m.status === 'candidate').length;
    const confirmed = materials.filter((m) => m.status !== 'candidate').length;
    const str = (k: string) => String(this.dataPrecision[k] ?? 'inferred');
    const surveyCompleted = this.dataPrecision.survey_completed === true;
    const geometry = str('geometry');
    const overallMaturity: DataConfidence['overallMaturity'] =
      surveyCompleted && geometry === 'measured' && candidate === 0
        ? 'measured'
        : surveyCompleted || geometry === 'measured'
          ? 'partial'
          : 'inferred';
    return {
      geometry,
      structure: str('structure'),
      mep: str('mep'),
      materials: { candidate, confirmed, total: materials.length },
      surveyCompleted,
      sourceDoc: this.dataPrecision.source_doc as string | undefined,
      overallMaturity,
      warning:
        overallMaturity === 'measured'
          ? '数据已现场量房确认，预算/几何可靠'
          : '几何/MEP 为推断值、材料报价到店未确认；预算与尺寸仅供估算，决策前需现场量房复核',
    };
  }

  getRoomLayoutDetail(roomId: string): {
    room: RoomLayout;
    walls: WallSegment[];
    furnishings: RoomFurnishings;
    electricalMarkers: ElectricalMarker[];
    adjacentRooms: string[];
  } | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;

    const EPS = 0.01;
    const inRoom = (x: number, z: number, r: RoomLayout): boolean =>
      x >= r.x - r.width / 2 - EPS &&
      x <= r.x + r.width / 2 + EPS &&
      z >= r.z - r.depth / 2 - EPS &&
      z <= r.z + r.depth / 2 + EPS;

    const roomWalls = this.walls.filter(
      (w) => inRoom(w.x1, w.z1, room) || inRoom(w.x2, w.z2, room)
    );

    const adjacentRooms = new Set<string>();
    for (const w of roomWalls) {
      for (const [otherId, other] of this.rooms) {
        if (otherId === roomId) continue;
        if (inRoom(w.x1, w.z1, other) || inRoom(w.x2, w.z2, other)) {
          adjacentRooms.add(otherId);
        }
      }
    }

    const items = this.furnishings[roomId] ?? [];
    const placed = items
      .filter((i) => i.x !== undefined && i.z !== undefined)
      .map((i) => ({ type: i.type, x: i.x!, z: i.z!, rotation: i.rotation ?? 0 }));

    return {
      room,
      walls: roomWalls,
      furnishings: { placed, counts: this.getFurnishingCounts(roomId) },
      electricalMarkers: this.electricalMarkers.filter((m) => m.roomId === roomId),
      adjacentRooms: [...adjacentRooms],
    };
  }
}
