import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
// TopicRegistry → designData → TextureFactory 会在 jsdom（无 canvas 包）里炸 canvas 2d context；
// 本测试只碰 HouseScene 的吊顶分区高亮方法，按既有做法把 TopicRegistry 掉。
vi.mock('../topics/TopicRegistry.js', () => ({
  TopicRegistry: class {
    constructor() {}
    get() { return undefined; }
    list() { return []; }
    register() {}
  },
}));
import { HouseScene } from './HouseScene.js';
/**
 * 吊顶分区高亮子系统（DEC-2026-10-08-C01）。
 * 断言四件事：① 每个分区都上色且同工艺内颜色互不相同；② persistent 分区（不在 ceilingMeshes
 * 里的圆角/阴角区）也被覆盖；③ 关闭时按快照可逆恢复；④ setMode/重建重写天花后高亮仍存活。
 * 另外守住与贴砖/HVAC 的隔离（源码级）。
 */

interface FakeZone {
  id: string;
  room: string;
  trade: 'gypsum_board' | 'aluminum_buckle' | 'curtain_box' | 'drying_rack';
  type: string;
  area: [number, number, number, number];
  thickness: number;
  corner_radius?: number;
  corner_radii?: Record<string, number>;
  concave_fillets?: Record<string, number>;
  buckle_panel?: { module: number };
  persistent?: boolean;
}

function makeScene(zones: FakeZone[], opts: { withCeilingMeshes?: boolean } = {}) {
  const scene = Object.create(HouseScene.prototype) as any;
  const exportRoot = new THREE.Group();
  scene.exportRoot = exportRoot;
  scene.rooms = {};
  for (const zone of zones) {
    if (!scene.rooms[zone.room]) scene.rooms[zone.room] = { id: zone.room, name: zone.room, height: 2.8 };
    const group = new THREE.Group();
    group.userData = {
      type: 'ceiling_zone',
      objectId: `ceiling:${zone.id}`,
      roomId: zone.room,
      ceiling: {
        area: zone.area, thickness: zone.thickness, corner_radius: zone.corner_radius,
        corner_radii: zone.corner_radii, concave_fillets: zone.concave_fillets,
        buckle_panel: zone.buckle_panel, trade: zone.trade, type: zone.type, room: zone.room,
      },
    };
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: 0xf5f5f5 }));
    mesh.userData = { part: 'slab', type: 'ceiling_zone_solid', objectId: `ceiling:${zone.id}`, roomId: zone.room, ceiling: group.userData.ceiling };
    if (zone.persistent) mesh.userData.ceilingPersistent = true;
    group.add(mesh);
    exportRoot.add(group);
  }
  scene.ceilingMeshes = opts.withCeilingMeshes === false
    ? []
    : exportRoot.children.flatMap((group: any) => group.children.filter((child: any) => child.userData?.ceilingPersistent !== true));
  scene.hvacRenderer = { isCoordinationVisible: () => false };
  scene._mode = 'orbit';
  // 类字段初始化只在构造函数里跑；Object.create(prototype) 需要显式补上高亮状态
  scene.ceilingZoneOriginalMaterials = new Map();
  scene.ceilingZoneHighlightActive = false;
  scene.ceilingZoneHighlightMode = 'zone';
  scene.ceilingZoneSoloId = null;
  scene.requestRender = vi.fn();
  return scene;
}

const meshesOf = (scene: any, zoneId: string): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  scene.exportRoot.traverse((object: any) => {
    if (object.userData?.objectId === `ceiling:${zoneId}` && (object as THREE.Mesh).isMesh) out.push(object);
  });
  return out;
};

const ZONES: FakeZone[] = [
  { id: 'ceiling_living', room: 'living_dining', trade: 'gypsum_board', type: 'drop', area: [7.2, 4.3, 13.4, 5.2], thickness: 0.3, corner_radius: 0.1 },
  { id: 'ceiling_main_corridor', room: 'living_dining', trade: 'gypsum_board', type: 'drop', area: [4.2, 4.3, 7.2, 5.55], thickness: 0.3 },
  { id: 'ceiling_master_ac', room: 'master_bedroom', trade: 'gypsum_board', type: 'drop', area: [2.925, 4.55, 4.2, 5.6], thickness: 0.3, corner_radius: 0.1, persistent: true },
  { id: 'ceiling_kitchen', room: 'kitchen', trade: 'aluminum_buckle', type: 'aluminum_buckle', area: [7.2, 0, 10.8, 2.4], thickness: 0.15, buckle_panel: { module: 0.3 } },
  { id: 'curtain_box_living', room: 'living_dining', trade: 'curtain_box', type: 'drop', area: [9, 9.55, 13.4, 9.8], thickness: 0.15 },
  { id: 'drying_rack_living', room: 'living_dining', trade: 'drying_rack', type: 'drop', area: [7.2, 9.2, 9, 9.8], thickness: 0.15 },
];

const colorHex = (mesh: THREE.Mesh): string => `#${(mesh.material as THREE.MeshStandardMaterial).color.getHexString()}`;

describe('吊顶分区高亮', () => {
  it('每个分区都上色，同工艺内颜色互不相同', () => {
    const scene = makeScene(ZONES);
    scene.setCeilingZoneHighlightVisible(true);
    const colors = new Map<string, string>();
    for (const zone of ZONES) {
      for (const mesh of meshesOf(scene, zone.id)) {
        expect(mesh.visible).toBe(true);
        expect(mesh.renderOrder).toBe(60);
        const material = mesh.material as THREE.MeshStandardMaterial;
        expect(material.transparent).toBe(true);
        expect(material.opacity).toBeCloseTo(0.92);
      }
      colors.set(zone.id, colorHex(meshesOf(scene, zone.id)[0]));
    }
    // 19 个分区就要 19 个可分辨颜色：至少同族内不能撞色
    expect(new Set(colors.values()).size).toBe(ZONES.length);
    expect(colors.get('ceiling_living')).not.toBe(colors.get('curtain_box_living'));
  });

  it('覆盖 persistent 分区（主卧门头盒不在 ceilingMeshes 里）', () => {
    const scene = makeScene(ZONES);
    // ceilingMeshes 刻意排除 persistent 网格，模拟 SceneBuilder 的 index 语义
    expect(scene.ceilingMeshes.some((mesh: THREE.Mesh) => mesh.userData?.objectId === 'ceiling:ceiling_master_ac')).toBe(false);
    scene.setCeilingZoneHighlightVisible(true);
    const mesh = meshesOf(scene, 'ceiling_master_ac')[0];
    expect(mesh.visible).toBe(true);
    expect(colorHex(mesh)).not.toBe('#f5f5f5');
  });

  it('关闭时按快照可逆恢复（不写死默认值）', () => {
    const scene = makeScene(ZONES);
    const mesh = meshesOf(scene, 'ceiling_living')[0];
    const originalColor = colorHex(mesh);
    const originalOpacity = (mesh.material as THREE.MeshStandardMaterial).opacity;
    scene.setCeilingZoneHighlightVisible(true);
    const highlighted = mesh.material;
    expect(colorHex(mesh)).not.toBe(originalColor);
    scene.setCeilingZoneHighlightVisible(false);
    // 恢复的是快照材质：视觉值回到初始态（不写死默认值），且高亮材质不再被引用
    expect(mesh.material).not.toBe(highlighted);
    expect(colorHex(mesh)).toBe(originalColor);
    expect((mesh.material as THREE.MeshStandardMaterial).opacity).toBe(originalOpacity);
    expect(mesh.renderOrder).toBe(0);
    expect(scene.ceilingZoneHighlightActive).toBe(false);
    // 反复开关不累积快照
    scene.setCeilingZoneHighlightVisible(true);
    scene.setCeilingZoneHighlightVisible(false);
    expect(scene.ceilingZoneOriginalMaterials.size).toBe(0);
  });

  it('setMode / setCeilingVisible 重写天花后高亮仍然活着', () => {
    const scene = makeScene(ZONES);
    scene.setCeilingZoneHighlightVisible(true);
    const colored = colorHex(meshesOf(scene, 'ceiling_living')[0]);
    // 切到俯视：setCeilingVisible(false) 会把普通天花藏掉
    scene.setCeilingVisible(false);
    const mesh = meshesOf(scene, 'ceiling_living')[0];
    expect(mesh.visible).toBe(true);
    expect(colorHex(mesh)).toBe(colored);
    expect(mesh.renderOrder).toBe(60);
  });

  it('隔离（solo）：目标满色，其余压暗', () => {
    const scene = makeScene(ZONES);
    scene.setCeilingZoneHighlightVisible(true);
    scene.setCeilingZoneSolo('ceiling_kitchen');
    expect((meshesOf(scene, 'ceiling_kitchen')[0].material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.92);
    expect((meshesOf(scene, 'ceiling_living')[0].material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.14);
    expect(scene.getCeilingZoneSolo()).toBe('ceiling_kitchen');
    scene.setCeilingZoneSolo(null);
    expect((meshesOf(scene, 'ceiling_living')[0].material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.92);
  });

  it('按工艺归并模式：同族同色', () => {
    const scene = makeScene(ZONES);
    scene.setCeilingZoneHighlightVisible(true);
    scene.setCeilingZoneHighlightMode('trade');
    expect(colorHex(meshesOf(scene, 'ceiling_living')[0])).toBe(colorHex(meshesOf(scene, 'ceiling_main_corridor')[0]));
    expect(colorHex(meshesOf(scene, 'ceiling_living')[0])).not.toBe(colorHex(meshesOf(scene, 'ceiling_kitchen')[0]));
    scene.setCeilingZoneHighlightMode('zone');
    expect(colorHex(meshesOf(scene, 'ceiling_living')[0])).not.toBe(colorHex(meshesOf(scene, 'ceiling_main_corridor')[0]));
  });

  it('算量与 3D 同源：inspectCeilingZones 从场景声明反算（含圆角/阴角与板块数）', () => {
    const scene = makeScene(ZONES);
    const { zones, takeoff } = scene.inspectCeilingZones();
    expect(zones.map((zone: any) => zone.id).sort()).toEqual(ZONES.map((zone) => zone.id).sort());
    const living = zones.find((zone: any) => zone.id === 'ceiling_living');
    expect(living.trade).toBe('gypsum_board');
    // 6.20×0.90 − 4×0.10²(1−π/4) = 5.5714
    expect(living.netAreaM2).toBeCloseTo(5.58 - 4 * 0.01 * (1 - Math.PI / 4), 6);
    const kitchen = zones.find((zone: any) => zone.id === 'ceiling_kitchen');
    expect(kitchen.panelCount).toBe(96);
    expect(takeoff.byClass.curtain_box.zones).toBe(1);
    expect(takeoff.byClass.drying_rack.zones).toBe(1);
    expect(takeoverTotal(takeoff)).toBeCloseTo(
      5.58 - 4 * 0.01 * (1 - Math.PI / 4) + 3.75 + 1.33875 - 4 * 0.01 * (1 - Math.PI / 4) + 8.64 + 1.1 + 1.08, 6,
    );
  });

  it('状态摘要：ready/active/分类小计齐全', () => {
    const scene = makeScene(ZONES);
    scene.setCeilingZoneHighlightVisible(true);
    const status = scene.getCeilingZoneHighlightStatus();
    expect(status.required).toBe(true);
    expect(status.ready).toBe(true);
    expect(status.active).toBe(true);
    expect(status.zonesInScene).toBe(6);
    expect(status.aluminumBucklePanelCount).toBe(96);
    expect(status.curtainBoxLinearM).toBeCloseTo(4.4, 6);
    expect(status.totalNetAreaM2).toBeGreaterThan(20);
    expect(status.unclassifiedZoneIds).toEqual([]);
  });
});

function takeoverTotal(takeoff: any): number {
  return takeoff.totalNetAreaM2;
}

describe('吊顶分区高亮·隔离铁律', () => {
  it('与 HVAC / 贴砖检视态互不引用（源码级）', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/render/HouseScene.ts', 'utf8');
    for (const fn of ['setCeilingZoneHighlightVisible', 'setCeilingZoneSolo', 'getCeilingZoneHighlightStatus', 'inspectCeilingZones', 'applyCeilingZoneColors', 'restoreCeilingZoneMaterials']) {
      // 锚在声明行（\n  + 可选 private），否则会误匹配 buildFromCatalog 里的调用点
      const body = new RegExp(`\\n  (?:private )?${fn}\\([^)]*\\)[^{]*\\{[\\s\\S]*?\\n  \\}`).exec(source);
      expect(body, `应存在 ${fn}`).toBeTruthy();
      expect(/Hvac|hvac|WallTile|wall-tile/.test(body![0]), `${fn} 体内不得引用 HVAC / 贴砖`).toBe(false);
    }
    const app = readFileSync('src/App.ts', 'utf8');
    const toast = /if \(this\.ceilingZoneVisible\) \{[\s\S]*?showToast/.exec(app);
    expect(toast, '开启吊顶分区高亮应播报数字摘要').toBeTruthy();
    expect(/Hvac|hvac|WallTile|wall-tile/.test(toast![0])).toBe(false);
  });
});
