import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
// TopicRegistry → designData → TextureFactory 会在 jsdom（无 canvas 包）里炸 canvas 2d context；
// 本测试只碰 HouseScene 的构件状态叠加层方法，按既有做法把 TopicRegistry 掉。
vi.mock('../topics/TopicRegistry.js', () => ({
  TopicRegistry: class {
    constructor() {}
    get() { return undefined; }
    list() { return []; }
    register() {}
  },
}));
import { HouseScene } from './HouseScene.js';
import {
  ELEMENT_STATUS_COLOR,
  type ElementStateLike,
} from './analysis/element-state-colors.js';

/**
 * 构件级工程状态叠加层（DEC-2026-10-09-E01）。
 * 断言六件事：
 *  ① **默认关闭 = 视觉零变化**（最重要）：注入 states 但不开高亮，材质/可见性/renderOrder 与注入前逐项一致；
 *  ② 开启后非合批 mesh 的 color 变成对应 status 色，快照-还原不写死默认值；
 *  ③ solo：只剩目标 status/构件是亮的，其余压暗；取消恢复；
 *  ④ 合批构件（电气点）走**独立标记层**：生成标记、按 status 上色、关闭后整组移除；
 *  ⑤ 状态词到颜色覆盖全部 6 个 status；
 *  ⑥ 聚合 inspectElementStates / 状态摘要 getElementStateHighlightStatus 口径正确。
 */

interface FakeElement {
  id: string;
  kind: string;
  status: ElementStateLike['status'];
  batched: boolean;
  /** 合批点位的世界坐标（电气/给排水点有 x/z/height）。 */
  position?: [number, number, number];
  openQuestion?: { ref: string; summary: string; blockedBy: string };
  decision?: string;
  conflicts?: string[];
}

function makeScene(elements: FakeElement[]) {
  const scene = Object.create(HouseScene.prototype) as any;
  const root = new THREE.Scene();
  const exportRoot = new THREE.Group();
  const viewOnly = new THREE.Group(); // decorations.root 模拟：给排水点位落这里
  root.add(exportRoot);
  root.add(viewOnly);
  scene.scene = root;
  scene.exportRoot = exportRoot;
  scene.rooms = {};
  // 类字段初始化只在构造函数里跑；Object.create(prototype) 需显式补上叠加层状态
  scene.elementStateOriginalMaterials = new Map();
  scene.elementStateHighlightActive = false;
  scene.elementStateSoloTarget = null;
  scene.elementStateStates = [];
  scene.elementStateById = new Map();
  scene.elementStateMarkerGroup = null;
  scene.elementStateMarkerGeometry = null;
  scene.requestRender = vi.fn();

  const states: ElementStateLike[] = [];
  for (const element of elements) {
    states.push({
      id: element.id,
      kind: element.kind,
      label: element.id,
      status: element.status,
      statusSource: `test:${element.id}`,
      ...(element.openQuestion ? { openQuestion: element.openQuestion } : {}),
      ...(element.decision ? { decision: element.decision } : {}),
      conflicts: element.conflicts ?? [],
    });
    if (element.batched) {
      // 合批点位的 unit 组：合批后零件 mesh 被摘下，但 unit 组本身留在场景里、带坐标与 objectId。
      const unit = new THREE.Group();
      unit.name = element.id;
      unit.userData = { type: element.kind, objectId: element.id, hoverable: true };
      if (element.position) unit.position.set(...element.position);
      (element.kind === 'plumbing' ? viewOnly : exportRoot).add(unit);
    } else {
      // 非合批 mesh（吊顶分区/墙/地）：直接上色的对象。
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(),
        new THREE.MeshStandardMaterial({ color: 0xf5f5f5 }),
      );
      mesh.userData = { type: 'ceiling_zone_solid', objectId: element.id, roomId: 'r' };
      exportRoot.add(mesh);
    }
  }
  scene.elementStateStates = states;
  scene.elementStateById = new Map(states.map((s) => [s.id, s]));
  return scene;
}

const ELEMENTS: FakeElement[] = [
  // 非合批（kind 非 electrical/plumbing）：ceiling + hvac(ceiling:ac_*)
  { id: 'ceiling:ceiling_living', kind: 'ceiling', status: 'confirmed', batched: false },
  { id: 'ceiling:curtain_box_living', kind: 'ceiling', status: 'pending', batched: false, openQuestion: { ref: '7', summary: '分区边界', blockedBy: '卡在业主裁定' }, conflicts: ['ceiling.overlap'] },
  { id: 'ceiling:ac_child', kind: 'hvac', status: 'confirmed', batched: false, decision: 'DEC-2026-10-09' },
  // 合批 electrical
  { id: 'electrical:sock_child_ac', kind: 'electrical', status: 'pending', batched: true, position: [3, 1.2, 4], openQuestion: { ref: '42', summary: '儿童房空调电源', blockedBy: '卡在空调厂家深化图' } },
  { id: 'electrical:sock_kitchen', kind: 'electrical', status: 'measured', batched: true, position: [1, 0.4, 2] },
  { id: 'electrical:panel_strong', kind: 'electrical', status: 'conflicted', batched: true, position: [13.4, 1.8, 3.6], conflicts: ['spatial.collision'] },
  // 合批 plumbing
  { id: 'plumbing:drain_kitchen', kind: 'plumbing', status: 'undeclared', batched: true, position: [2, 0, 3] },
  { id: 'plumbing:faucet_main', kind: 'plumbing', status: 'inferred', batched: true, position: [5, 0.5, 6] },
];

const colorHex = (mesh: THREE.Mesh): string => `#${(mesh.material as THREE.MeshStandardMaterial).color.getHexString()}`;
const meshOf = (scene: any, objectId: string): THREE.Mesh =>
  scene.exportRoot.children.find((child: any) => child.userData?.objectId === objectId) as THREE.Mesh;
const markerGroup = (scene: any): THREE.Group | null =>
  scene.scene.children.find((child: any) => child.name === 'ELEMENT_STATE_MARKERS') ?? null;
const markerFor = (scene: any, id: string): THREE.Mesh | undefined => {
  const group = markerGroup(scene);
  return group?.children.find((child: any) => child.userData?.elementStateId === id) as THREE.Mesh | undefined;
};

interface MeshSnapshot {
  sameMaterial: boolean; color: string; opacity: number; transparent: boolean;
  depthTest: boolean; depthWrite: boolean; visible: boolean; renderOrder: number;
}
const snapshotMesh = (mesh: THREE.Mesh): MeshSnapshot => {
  const material = mesh.material as THREE.MeshStandardMaterial;
  return {
    sameMaterial: true, color: colorHex(mesh), opacity: material.opacity, transparent: material.transparent,
    depthTest: material.depthTest, depthWrite: material.depthWrite, visible: mesh.visible, renderOrder: mesh.renderOrder,
  };
};
const expectUnchanged = (mesh: THREE.Mesh, snap: MeshSnapshot, originalMaterial: THREE.Material | THREE.Material[]): void => {
  const material = mesh.material as THREE.MeshStandardMaterial;
  expect(mesh.material).toBe(originalMaterial);
  expect(colorHex(mesh)).toBe(snap.color);
  expect(material.opacity).toBe(snap.opacity);
  expect(material.transparent).toBe(snap.transparent);
  expect(material.depthTest).toBe(snap.depthTest);
  expect(material.depthWrite).toBe(snap.depthWrite);
  expect(mesh.visible).toBe(snap.visible);
  expect(mesh.renderOrder).toBe(snap.renderOrder);
};

describe('构件级工程状态叠加层', () => {
  it('默认关闭 = 视觉零变化（最重要）：注入 states 后不开高亮，场景逐项不变', () => {
    const scene = makeScene(ELEMENTS);
    const directMeshes = ['ceiling:ceiling_living', 'ceiling:curtain_box_living', 'ceiling:ac_child'].map((id) => meshOf(scene, id));
    const before = directMeshes.map((mesh) => ({ mesh, snap: snapshotMesh(mesh), material: mesh.material }));
    const sceneChildrenBefore = scene.scene.children.length;

    scene.setElementStates(ELEMENTS.map((e) => ({
      id: e.id, kind: e.kind, label: e.id, status: e.status, statusSource: `test:${e.id}`, conflicts: e.conflicts ?? [],
    })));

    for (const entry of before) expectUnchanged(entry.mesh, entry.snap, entry.material);
    // 不建标记层、不加任何对象到场景、不置激活
    expect(markerGroup(scene)).toBeNull();
    expect(scene.scene.children.length).toBe(sceneChildrenBefore);
    expect(scene.elementStateHighlightActive).toBe(false);
    expect(scene.elementStateOriginalMaterials.size).toBe(0);
  });

  it('开启后非合批 mesh 上 status 色；关闭后按快照还原（不写死默认值）', () => {
    const scene = makeScene(ELEMENTS);
    scene.setElementStates(ELEMENTS.map((e) => ({ id: e.id, kind: e.kind, label: e.id, status: e.status, statusSource: `x`, conflicts: [] })));
    const living = meshOf(scene, 'ceiling:ceiling_living');
    const curtain = meshOf(scene, 'ceiling:curtain_box_living');
    const acChild = meshOf(scene, 'ceiling:ac_child');
    const originals = [living, curtain, acChild].map((mesh) => ({ mesh, material: mesh.material, snap: snapshotMesh(mesh) }));

    scene.setElementStateHighlightVisible(true);
    expect(colorHex(living)).toBe(`#${ELEMENT_STATUS_COLOR.confirmed.toString(16).padStart(6, '0')}`);
    expect(colorHex(acChild)).toBe(`#${ELEMENT_STATUS_COLOR.confirmed.toString(16).padStart(6, '0')}`);
    expect(colorHex(curtain)).toBe(`#${ELEMENT_STATUS_COLOR.pending.toString(16).padStart(6, '0')}`);
    for (const mesh of [living, curtain, acChild]) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      expect(material.opacity).toBeCloseTo(0.9);
      expect(material.depthTest).toBe(false);
      expect(material.depthWrite).toBe(false);
      expect(mesh.visible).toBe(true);
      expect(mesh.renderOrder).toBe(70);
    }

    scene.setElementStateHighlightVisible(false);
    for (const entry of originals) expectUnchanged(entry.mesh, entry.snap, entry.material);
    expect(markerGroup(scene)).toBeNull();
    // 反复开关不累积快照
    scene.setElementStateHighlightVisible(true);
    scene.setElementStateHighlightVisible(false);
    expect(scene.elementStateOriginalMaterials.size).toBe(0);
  });

  it('solo：只剩目标 status/构件是亮的，其余压暗；取消恢复', () => {
    const scene = makeScene(ELEMENTS);
    scene.setElementStates(ELEMENTS.map((e) => ({ id: e.id, kind: e.kind, label: e.id, status: e.status, statusSource: `x`, conflicts: [] })));
    scene.setElementStateHighlightVisible(true);

    // solo 一个 status：confirmed 满色，其余压暗
    scene.setElementStateSolo('confirmed');
    const living = meshOf(scene, 'ceiling:ceiling_living');       // confirmed → 亮
    const curtain = meshOf(scene, 'ceiling:curtain_box_living');  // pending → 暗
    expect((living.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.9);
    expect((curtain.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.12);
    // 标记层同步：confirmed 无合批点 → 全暗；sock_kitchen(measured) 暗、sock_child_ac(pending) 暗
    expect((markerFor(scene, 'electrical:sock_kitchen')!.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.12);

    // solo 一个构件 id：只有它亮
    scene.setElementStateSolo('electrical:sock_kitchen');
    expect((markerFor(scene, 'electrical:sock_kitchen')!.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(1);
    expect((markerFor(scene, 'plumbing:faucet_main')!.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.12);
    expect(scene.getElementStateSolo()).toBe('electrical:sock_kitchen');

    // 取消 solo：恢复全亮
    scene.setElementStateSolo(null);
    expect((curtain.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.9);
    expect((markerFor(scene, 'plumbing:faucet_main')!.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(1);
    expect(scene.getElementStateSolo()).toBeNull();
  });

  it('合批 split：电气点走独立标记层，按 status 上色，关闭后整组移除', () => {
    const scene = makeScene(ELEMENTS);
    scene.setElementStates(ELEMENTS.map((e) => ({ id: e.id, kind: e.kind, label: e.id, status: e.status, statusSource: `x`, conflicts: [] })));
    expect(markerGroup(scene)).toBeNull();

    scene.setElementStateHighlightVisible(true);
    const group = markerGroup(scene);
    expect(group).toBeTruthy();
    // 5 个合批点各一个标记，按各自 status 上色
    for (const element of ELEMENTS.filter((e) => e.batched)) {
      const marker = markerFor(scene, element.id);
      expect(marker, `${element.id} 应有标记`).toBeTruthy();
      const expected = `#${ELEMENT_STATUS_COLOR[element.status].toString(16).padStart(6, '0')}`;
      expect(`#${(marker!.material as THREE.MeshBasicMaterial).color.getHexString()}`).toBe(expected);
      // 标记落在点位世界坐标上
      expect(marker!.position.x).toBeCloseTo(element.position![0]);
      expect(marker!.position.y).toBeCloseTo(element.position![1]);
      expect(marker!.position.z).toBeCloseTo(element.position![2]);
    }
    // 非合批的 ceiling 不产生标记
    expect(markerFor(scene, 'ceiling:ceiling_living')).toBeUndefined();

    scene.setElementStateHighlightVisible(false);
    expect(markerGroup(scene)).toBeNull();
    expect(scene.elementStateMarkerGeometry).toBeNull();
  });

  it('状态词到颜色覆盖全部 6 个 status', () => {
    const statuses: Array<ElementStateLike['status']> = ['measured', 'confirmed', 'inferred', 'pending', 'conflicted', 'undeclared'];
    const elements: FakeElement[] = statuses.map((status, i) => ({ id: `electrical:p${i}`, kind: 'electrical', status, batched: true, position: [i, 0, 0] }));
    const scene = makeScene(elements);
    scene.setElementStates(elements.map((e) => ({ id: e.id, kind: e.kind, label: e.id, status: e.status, statusSource: `x`, conflicts: [] })));
    scene.setElementStateHighlightVisible(true);
    const seen = new Set<string>();
    for (const element of elements) {
      const marker = markerFor(scene, element.id)!;
      const hex = `#${(marker.material as THREE.MeshBasicMaterial).color.getHexString()}`;
      expect(hex).toBe(`#${ELEMENT_STATUS_COLOR[element.status].toString(16).padStart(6, '0')}`);
      seen.add(hex);
    }
    expect(seen.size).toBe(6);
  });

  it('inspectElementStates 聚合 + getElementStateHighlightStatus 口径正确', () => {
    const scene = makeScene(ELEMENTS);
    scene.setElementStates(ELEMENTS.map((e) => ({ id: e.id, kind: e.kind, label: e.id, status: e.status, statusSource: `x`, conflicts: e.conflicts ?? [], ...(e.openQuestion ? { openQuestion: e.openQuestion } : {}) })));
    const inspection = scene.inspectElementStates();
    expect(inspection.summary.total).toBe(ELEMENTS.length);
    expect(inspection.summary.byStatus.confirmed).toBe(2);
    expect(inspection.summary.byStatus.pending).toBe(2);
    expect(inspection.summary.byStatus.undeclared).toBe(1);
    expect(inspection.summary.byKind.electrical).toBe(3);
    expect(inspection.summary.byKind.plumbing).toBe(2);
    // 每个构件都在场景里落位 → inScene 全 true，无 unmatched
    expect(inspection.elements.every((e: any) => e.inScene)).toBe(true);
    expect(inspection.elements.find((e: any) => e.id === 'electrical:sock_child_ac').batched).toBe(true);
    expect(inspection.elements.find((e: any) => e.id === 'ceiling:ceiling_living').batched).toBe(false);

    const status = scene.getElementStateHighlightStatus();
    expect(status.required).toBe(true);
    expect(status.ready).toBe(true);
    expect(status.active).toBe(false);
    expect(status.total).toBe(ELEMENTS.length);
    expect(status.undeclared).toBe(1);
    expect(status.conflicted).toBe(1);
    expect(status.pending).toBe(2);
    expect(status.unmatchedIds).toEqual([]);
  });

  it('未落图的申报点：不造幽灵标记，计入 unmatchedIds', () => {
    const scene = makeScene(ELEMENTS);
    const withGhost = ELEMENTS.map((e) => ({ id: e.id, kind: e.kind, label: e.id, status: e.status, statusSource: `x`, conflicts: [] }));
    withGhost.push({ id: 'electrical:ghost', kind: 'electrical', label: 'ghost', status: 'pending', statusSource: 'x', conflicts: [] } as any);
    scene.setElementStates(withGhost);
    scene.setElementStateHighlightVisible(true);
    expect(markerFor(scene, 'electrical:ghost')).toBeUndefined();
    expect(scene.getElementStateHighlightStatus().unmatchedIds).toEqual(['electrical:ghost']);
  });
});

describe('构件状态叠加层·隔离铁律', () => {
  it('合批 split 有据：非合批直接上色、合批走标记层，且不引用 SceneBatcher 逐件上色（源码级）', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/render/HouseScene.ts', 'utf8');
    for (const fn of ['setElementStates', 'setElementStateHighlightVisible', 'applyElementStateColors', 'restoreElementStateMaterials', 'setElementStateSolo', 'getElementStateHighlightStatus', 'inspectElementStates']) {
      const body = new RegExp(`\\n  (?:private )?${fn}\\([^)]*\\)[^{]*\\{[\\s\\S]*?\\n  \\}`).exec(source);
      expect(body, `应存在 ${fn}`).toBeTruthy();
      // 叠加层不得直接调 SceneBatcher 的逐件上色（不存在的能力）或碰 HVAC/贴砖路径
      expect(/updateScopeMaterials|setUnitVisible|new SceneBatcher/.test(body![0]), `${fn} 不得借用 SceneBatcher 逐件上色`).toBe(false);
    }
    // 合批类别集合必须显式声明，且注释说明原因
    expect(/BATCHED_ELEMENT_KINDS = new Set/.test(source)).toBe(true);
  });
});
