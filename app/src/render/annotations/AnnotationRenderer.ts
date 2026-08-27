import * as THREE from 'three';
import { createSocketIcon, createSwitchIcon, createFloorSocketIcon, createNetworkIcon, createFaucetIcon, createShowerIcon, createToiletIcon, createDrainIcon, createWasherIcon, createCeilingZoneIndicator, createACIndoorIcon } from './icons.js';
import { ProblemDetector } from './ProblemDetector.js';
import type { Problem, FurnitureItem, WallInfo } from './ProblemDetector.js';

interface ElectricalPoint {
  id: string;
  room: string;
  wall: string;
  wallSide?: 'north' | 'south' | 'east' | 'west';
  type: 'socket' | 'switch' | 'switch_2way' | 'network' | 'usb' | 'floor_socket'
    | 'ceiling_light' | 'pendant' | 'dome' | 'wall_lamp' | 'downlight' | 'led_strip';
  x: number;
  z: number;
  height: number;
  count?: number;
  note?: string;
  temp?: number; // 色温（3000/4000），灯光点位用
}

interface PlumbingPoint {
  id: string;
  room: string;
  wall?: string;
  wallSide?: 'north' | 'south' | 'east' | 'west';
  type: 'faucet' | 'toilet' | 'shower' | 'drain' | 'washer' | 'faucet_outdoor';
  x: number;
  z: number;
  height?: number;
  note?: string;
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

  async load(): Promise<void> {
    const [electrical, plumbing, ceiling] = await Promise.all([
      fetch('/api/annotations/electrical').then(r => r.json()) as Promise<ElectricalPoint[]>,
      fetch('/api/annotations/plumbing').then(r => r.json()) as Promise<PlumbingPoint[]>,
      fetch('/api/annotations/ceiling').then(r => r.json()) as Promise<CeilingZone[]>,
    ]);

    this.electricalData = electrical;
    this.plumbingData = plumbing;
    this.ceilingData = ceiling;

    this.renderElectrical(electrical);
    this.renderPlumbing(plumbing);
    this.renderCeiling(ceiling);
  }

  detectProblems(furniture: FurnitureItem[], walls: WallInfo[]): Problem[] {
    const problems = this.detector.detectAll(
      this.electricalData,
      this.plumbingData,
      this.ceilingData,
      furniture,
      walls,
    );
    this.renderProblems(problems);
    console.log('[ProblemDetector]', problems.length, 'problems found:', problems);
    return problems;
  }

  private renderProblems(problems: Problem[]): void {
    while (this.problemGroup.children.length) {
      this.problemGroup.remove(this.problemGroup.children[0]);
    }
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
      const icon = p.type === 'switch' || p.type === 'switch_2way'
        ? createSwitchIcon()
        : p.type === 'floor_socket'
        ? createFloorSocketIcon()
        : p.type === 'network'
        ? createNetworkIcon()
        : createSocketIcon(p.count ?? 1);
      icon.position.set(p.x, p.type === 'floor_socket' ? 0.05 : p.height, p.z);
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
      const icon = (iconMap[p.type] ?? createFaucetIcon)();
      icon.position.set(p.x, p.height ?? 0.5, p.z);
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

  clear(): void {
    Object.values(this.layerGroups).forEach(g => {
      while (g.children.length) g.remove(g.children[0]);
    });
    while (this.problemGroup.children.length) {
      this.problemGroup.remove(this.problemGroup.children[0]);
    }
    this.labelSprites = [];
    this.electricalData = [];
    this.plumbingData = [];
    this.ceilingData = [];
  }
}
