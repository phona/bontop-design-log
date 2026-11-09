import * as THREE from 'three';
import { createSocketIcon, createSwitchIcon, createFloorSocketIcon, createNetworkIcon, createFaucetIcon, createShowerIcon, createToiletIcon, createDrainIcon, createWasherIcon, createCeilingZoneIndicator, createACIndoorIcon } from './icons.js';
import { ProblemDetector, type ElectricalPoint as ProblemElectricalPoint, type PlumbingPoint as ProblemPlumbingPoint } from './ProblemDetector.js';
import type { Problem, FurnitureItem, WallInfo } from './ProblemDetector.js';
import { resolvePointPlacementInWalls, type PointMountHost, type PointWall } from '@shared/point-placement';

/** 点位声明（/api/annotations/* 原始数组）：x/z 是迁移期断言字段，图标落位走解析器。 */
interface ElectricalPoint extends ProblemElectricalPoint {
  id: string;
  room: string;
  wall?: string;
  wallSide?: 'north' | 'south' | 'east' | 'west';
  along?: number;
  face_offset?: number;
  absolute?: boolean;
  mount?: { furniture_id: string; face: 'north' | 'south' | 'east' | 'west'; surface_gap?: number; along: number; face_offset?: number };
  anchor?: { source: string; id: string };
  height: number;
}

interface PlumbingPoint extends ProblemPlumbingPoint {
  id: string;
  room: string;
  wall?: string;
  wallSide?: 'north' | 'south' | 'east' | 'west';
  along?: number;
  face_offset?: number;
  absolute?: boolean;
  mount?: { furniture_id: string; face: 'north' | 'south' | 'east' | 'west'; surface_gap?: number; along: number; face_offset?: number };
  anchor?: { source: string; id: string };
  height?: number;
}

interface CeilingZone {
  id: string;
  room: string;
  type: 'drop' | 'integrated' | 'cove' | 'none' | 'ac_indoor' | 'aluminum_buckle';
  thickness?: number;
  area?: [number, number, number, number];
  x?: number;
  z?: number;
  height?: number;
  model?: string;
  note?: string;
}

const LABEL_DISTANCE_THRESHOLD = 2;

/**
 * 标注定位诊断（issue #98「宽容读取」，2026-11-10 修 Codex blocking）：解算失败的点位不画
 * 标注，但必须被点名——`pointId` + 解算器原因 + 当时的索引尺寸，供页面 toast / console 清单
 * 与后续排障使用。诊断的存在即「这里少了一个标注」，不是静默。
 */
export interface AnnotationPlacementDiagnostic {
  category: 'electrical' | 'plumbing';
  pointId: string;
  /** 原 throw 文案的信息量保留：解算器诊断原文 + pointWalls/mountHosts 尺寸。 */
  reason: string;
}

/**
 * planOf 结果：`placed` 才有坐标可画；`skipped` = 已记入诊断列表、该点不画。
 * **没有第三态**——尤其没有「解析失败返回 (0,0)」：那正是疗法①（PR #162）消灭的静默错位。
 */
type PlanResolution =
  | { kind: 'placed'; x: number; z: number }
  | { kind: 'skipped'; diagnostic: AnnotationPlacementDiagnostic };

export class AnnotationRenderer {
  private group = new THREE.Group();
  private layerGroups: Record<string, THREE.Group> = {
    electrical: new THREE.Group(),
    plumbing: new THREE.Group(),
    ceiling: new THREE.Group(),
  };
  private problemGroup = new THREE.Group();
  private labelSprites: THREE.Sprite[] = [];
  private detector = new ProblemDetector();
  private electricalData: ElectricalPoint[] = [];
  private plumbingData: PlumbingPoint[] = [];
  private ceilingData: CeilingZone[] = [];
  /** 点位宿主墙索引（issue #98 S1）：标注层与 ProblemDetector 的坐标一律经 shared/point-placement.ts 解算。 */
  private pointWalls: ReadonlyMap<string, PointWall> = new Map();
  /** mount 挂载点位的家具宿主索引（issue #98 S2）。 */
  private mountHosts: ReadonlyMap<string, PointMountHost> = new Map();
  /**
   * 解算失败的点位诊断（issue #98 宽容读取，2026-11-10）。按 `${category}:${pointId}` 去重，
   * 顺序 = 首次遇见的顺序；`clear()` 时随本轮数据清空（诊断描述的是**当前这次**渲染）。
   */
  private placementDiagnostics = new Map<string, AnnotationPlacementDiagnostic>();

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    private readonly viewOnlyRoot: THREE.Object3D = scene,
  ) {
    Object.values(this.layerGroups).forEach(g => this.group.add(g));
    this.group.add(this.problemGroup);
    this.group.visible = false;
    this.viewOnlyRoot.add(this.group);
  }

  /** 宿主墙索引由 App 从 HouseScene（buildScene 的 index.pointWalls）注入。 */
  setPointWalls(pointWalls: ReadonlyMap<string, PointWall>): void {
    this.pointWalls = pointWalls;
  }

  /** mount 宿主索引由 App 从 HouseScene（buildScene 的 index.mountHosts）注入（issue #98 S2）。 */
  setMountHosts(mountHosts: ReadonlyMap<string, PointMountHost>): void {
    this.mountHosts = mountHosts;
  }

  /**
   * 解析后平面坐标（issue #98 S1 单一解算）：沿墙点位 = 完成面基点（与 MEP 端点同源）。
   *
   * 三种结果，**没有第四种**：
   * - 解算成功 → `{kind:'placed'}`；
   * - 解算失败但有声明 x/z → 回落声明坐标 + console.warn（第四阶段 S3 删光 x/z 后只剩
   *   少数绝对点位走这条老路）；
   * - 解算失败且无声明坐标 → `{kind:'skipped'}`，原因进 `getPlacementDiagnostics()` 并
   *   console.error。**不回落 (0,0)**：那等于给标注发一个假坐标，界面照常、位置全错，
   *   是疗法①（PR #162）已经消灭的静默错位。**也不 throw**：标注层不是施工依据，权威判定
   *   在 verify 与正式 CAD/施工交付（那里对同样情况 fail-closed，严格输出）；页面按 issue
   *   #98「宽容读取 / 页面可显示问题并继续预览」的要求，一个点解算不出来只跳过该点，不许
   *   中断整个 load() → 页面初始化与阶段切换。
   *   走到这里的现实形态：宿主索引没注入（调用点漏 setPointWalls/setMountHosts）、宿主墙
   *   断引用、mount 宿主不在索引里（宿主 id 改动 / 被过滤 / count-only 无平面几何）——
   *   都会在下一次重建时随诊断清单显形。
   */
  private planOf(
    point: ElectricalPoint | PlumbingPoint,
    category: 'electrical' | 'plumbing',
  ): PlanResolution {
    const { placement, diagnostic } = resolvePointPlacementInWalls(point, this.pointWalls, this.mountHosts);
    if (placement) return { kind: 'placed', x: placement.x, z: placement.z };
    if (typeof point.x === 'number' && typeof point.z === 'number') {
      console.warn(`[annotations] ${point.id}: 定位解析失败，回落声明坐标（详见 verify:consistency）`);
      return { kind: 'placed', x: point.x, z: point.z };
    }
    const reason = `${diagnostic ?? '解算器未给出原因'}（pointWalls=${this.pointWalls.size} mountHosts=${this.mountHosts.size}；宿主索引未注入或宿主断引用？）`;
    return { kind: 'skipped', diagnostic: this.recordPlacementDiagnostic(category, point.id, reason) };
  }

  /** 登记一条定位诊断并当场 console.error（显形优先于列表读取；同一 `category:pointId` 去重）。 */
  private recordPlacementDiagnostic(
    category: 'electrical' | 'plumbing',
    pointId: string,
    reason: string,
  ): AnnotationPlacementDiagnostic {
    const key = `${category}:${pointId}`;
    const existing = this.placementDiagnostics.get(key);
    if (existing) return existing;
    const diagnostic: AnnotationPlacementDiagnostic = { category, pointId, reason };
    this.placementDiagnostics.set(key, diagnostic);
    console.error(
      `[annotations] ${category} 点位 ${pointId}: 定位解析失败，已跳过该点标注（不回落原点，不中断建场）——${reason}` +
      '。标注层不是施工依据：权威判定在 verify 与正式导出，请通过 AI 会话修复配置后重建。',
    );
    return diagnostic;
  }

  /** 本轮渲染的标注定位诊断清单（`length` 即「少画了几个标注」）。空 = 全部解算成功。 */
  getPlacementDiagnostics(): readonly AnnotationPlacementDiagnostic[] {
    return [...this.placementDiagnostics.values()];
  }

  /** 解算成功的点位（喂 ProblemDetector 用；失败点位没有可信坐标，不进检测器）。 */
  private placedPoints<T extends ElectricalPoint | PlumbingPoint>(
    points: readonly T[],
    category: 'electrical' | 'plumbing',
  ): Array<T & { x: number; z: number }> {
    const placed: Array<T & { x: number; z: number }> = [];
    for (const point of points) {
      const plan = this.planOf(point, category);
      if (plan.kind === 'skipped') continue;
      placed.push({ ...point, x: plan.x, z: plan.z });
    }
    return placed;
  }

  async load(): Promise<void> {
    const loadArray = async <T>(url: string): Promise<T[]> => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
      const value: unknown = await response.json();
      if (!Array.isArray(value)) throw new Error(`${url} returned a non-array response`);
      return value as T[];
    };
    const [electrical, plumbing, ceiling] = await Promise.all([
      loadArray<ElectricalPoint>('/api/annotations/electrical'),
      loadArray<PlumbingPoint>('/api/annotations/plumbing'),
      loadArray<CeilingZone>('/api/annotations/ceiling'),
    ]);

    this.clear();
    this.electricalData = electrical;
    this.plumbingData = plumbing;
    this.ceilingData = ceiling;

    this.renderElectrical(electrical);
    this.renderPlumbing(plumbing);
    this.renderCeiling(ceiling);
  }

  detectProblems(furniture: FurnitureItem[], walls: WallInfo[]): Problem[] {
    // ProblemDetector 的契约是「x/z = 解析后坐标」（见其文件头）：这里先把声明解算再喂进去，
    // 检测器自己不读声明 x/z 这个第二事实源。解算失败的点点位坐标不可信 → 跳过（已进诊断
    // 列表，detectProblems 不因为一个坏点中断，页面继续预览）。
    const problems = this.detector.detectAll(
      this.placedPoints(this.electricalData, 'electrical'),
      this.placedPoints(this.plumbingData, 'plumbing'),
      this.ceilingData,
      furniture,
      walls,
    );
    this.renderProblems(problems);
    console.log('[ProblemDetector]', problems.length, 'problems found:', problems);
    return problems;
  }

  private renderProblems(problems: Problem[]): void {
    this.clearChildren(this.problemGroup);
    for (const p of problems) {
      const color = p.severity === 'error' ? 0xff0000 : 0xff8800;
      const geo = new THREE.SphereGeometry(0.06, 8, 8);
      const mat = new THREE.MeshBasicMaterial({ color });
      const marker = new THREE.Mesh(geo, mat);
      marker.position.set(p.position.x, p.position.y, p.position.z);
      marker.userData = { type: 'problem', problemType: p.type, severity: p.severity };
      this.problemGroup.add(marker);
    }
  }

  setVisible(category: 'electrical' | 'plumbing' | 'ceiling' | 'problems' | 'all', visible: boolean): void {
    if (category === 'all') {
      this.group.visible = visible;
    } else if (category === 'problems') {
      this.problemGroup.visible = visible;
    } else {
      this.layerGroups[category].visible = visible;
    }
  }

  updateLabels(): void {
    if (!this.group.visible) return;
    const camPos = this.camera.position;
    for (const sprite of this.labelSprites) {
      if (!sprite.parent) continue;
      const worldPos = new THREE.Vector3();
      sprite.getWorldPosition(worldPos);
      const dist = camPos.distanceTo(worldPos);
      sprite.visible = dist < LABEL_DISTANCE_THRESHOLD;
    }
  }

  private renderElectrical(points: ElectricalPoint[]): void {
    const g = this.layerGroups.electrical;
    points.forEach(p => {
      // 先解算再建图标：解算失败就跳过该点（已进诊断列表），不为它创建永不入场景的 sprite。
      const plan = this.planOf(p, 'electrical');
      if (plan.kind === 'skipped') return;
      const icon = p.type === 'switch' || p.type === 'switch_2way' || p.type === 'ac_controller'
        ? createSwitchIcon()
        : p.type === 'floor_socket'
        ? createFloorSocketIcon()
        : p.type === 'network'
        ? createNetworkIcon()
        : createSocketIcon(p.count ?? 1);
      icon.position.set(plan.x, p.type === 'floor_socket' ? 0.05 : p.height, plan.z);
      icon.userData = { type: 'annotation', category: 'electrical', pointId: p.id, note: p.note, objectId: 'electrical:' + p.id, wallSide: p.wallSide };
      const label = this.createLabel(p.note ?? '');
      label.position.set(0, 0.3, 0);
      label.visible = false;
      icon.add(label);
      this.labelSprites.push(label);
      g.add(icon);
    });
  }

  private renderPlumbing(points: PlumbingPoint[]): void {
    const g = this.layerGroups.plumbing;
    points.forEach(p => {
      const iconMap: Record<string, () => THREE.Sprite> = {
        faucet: createFaucetIcon,
        shower: createShowerIcon,
        toilet: createToiletIcon,
        drain: createDrainIcon,
        washer: createWasherIcon,
        faucet_outdoor: createFaucetIcon,
      };
      const plan = this.planOf(p, 'plumbing');
      if (plan.kind === 'skipped') return;
      const icon = (iconMap[p.type] ?? createFaucetIcon)();
      icon.position.set(plan.x, p.height ?? 0.5, plan.z);
      icon.userData = { type: 'annotation', category: 'plumbing', pointId: p.id, note: p.note, objectId: 'plumbing:' + p.id, wallSide: p.wallSide };
      const label = this.createLabel(p.note ?? '');
      label.position.set(0, 0.3, 0);
      label.visible = false;
      icon.add(label);
      this.labelSprites.push(label);
      g.add(icon);
    });
  }

  private renderCeiling(zones: CeilingZone[]): void {
    const g = this.layerGroups.ceiling;
    zones.forEach(z => {
      if (z.type === 'ac_indoor') {
        const icon = createACIndoorIcon();
        icon.position.set(z.x!, z.height ?? 2.85, z.z!);
        icon.userData = { type: 'annotation', category: 'ceiling', zoneId: z.id, objectId: `ceiling:${z.id}`, note: `❄ ${z.note}` };
        const label = this.createLabel(z.note ?? '');
        label.position.set(0, 0.4, 0);
        label.visible = false;
        icon.add(label);
        this.labelSprites.push(label);
        g.add(icon);
        return;
      }
      const [x1, z1, x2, z2] = z.area!;
      const mesh = createCeilingZoneIndicator(x2 - x1, z2 - z1);
      mesh.position.set((x1 + x2) / 2, 2.9, (z1 + z2) / 2);
      mesh.rotation.x = -Math.PI / 2;
      mesh.userData = { type: 'annotation', category: 'ceiling', zoneId: z.id, objectId: `ceiling:${z.id}`, note: z.note };
      const label = this.createLabel(z.note ?? '');
      label.position.set(0, 0.5, 0);
      label.visible = false;
      mesh.add(label);
      this.labelSprites.push(label);
      g.add(mesh);
    });
  }

  private createLabel(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.beginPath();
    ctx.roundRect(0, 0, 256, 64, 8);
    ctx.fill();
    ctx.fillStyle = 'white';
    ctx.font = '16px sans-serif';
    ctx.fillText(text, 16, 38);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.8, 0.2, 1);
    return sprite;
  }

  getElectricalData(): ElectricalPoint[] { return this.electricalData; }
  getPlumbingData(): PlumbingPoint[] { return this.plumbingData; }

  private clearChildren(group: THREE.Group): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    for (const child of [...group.children]) {
      child.traverse((object) => {
        const renderable = object as THREE.Mesh | THREE.Sprite;
        if ('geometry' in renderable && renderable.geometry instanceof THREE.BufferGeometry) {
          geometries.add(renderable.geometry);
        }
        const objectMaterials = 'material' in renderable ? renderable.material : undefined;
        for (const material of Array.isArray(objectMaterials) ? objectMaterials : objectMaterials ? [objectMaterials] : []) {
          materials.add(material);
          for (const value of Object.values(material)) {
            if (value instanceof THREE.Texture) textures.add(value);
          }
        }
      });
      group.remove(child);
    }
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
  }

  clear(): void {
    Object.values(this.layerGroups).forEach((group) => this.clearChildren(group));
    this.clearChildren(this.problemGroup);
    // 诊断描述的是「当前这次」渲染：重建前清空，避免上一轮的点位在本轮显形。
    this.placementDiagnostics.clear();
    this.labelSprites = [];
    this.electricalData = [];
    this.plumbingData = [];
    this.ceilingData = [];
  }
}
