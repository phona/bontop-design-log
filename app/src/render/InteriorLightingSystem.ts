import * as THREE from 'three';

/**
 * 室内灯光系统（spec: 2026-08-12-interior-lighting-design.md）
 * 数据源 = config/electrical.yaml 灯光点位（即水电交底单，一份配置两用）。
 * 全屋 3000K（0xffd9a8），厨卫 4000K（0xfff2e0）。
 * 阴影预算：≤2 个投影光源（pendant 类型）；其余零阴影保帧率。
 */

export interface InteriorLightPoint {
  id: string;
  room: string;
  type: string;
  x: number;
  z: number;
  height?: number;
  temp?: number;
}

const LIGHT_TYPES = new Set(['pendant', 'dome', 'wall_lamp', 'downlight', 'led_strip', 'ceiling_light']);
const MAX_SHADOW_LIGHTS = 2;
const WARM_3000K = 0xffd9a8;
const NEUTRAL_4000K = 0xfff2e0;

interface LightEntry {
  id: string;
  room: string;
  light: THREE.Light;
  fixtureMats: THREE.MeshStandardMaterial[];
}

export class InteriorLightingSystem {
  private group = new THREE.Group();
  private entries: LightEntry[] = [];
  private on = false;
  private roomOverrides = new Map<string, boolean>();
  private shadowCount = 0;

  constructor(
    private scene: THREE.Scene,
    points: InteriorLightPoint[],
  ) {
    for (const p of points) {
      if (!LIGHT_TYPES.has(p.type)) continue;
      this.addLight(p);
    }
    this.scene.add(this.group);
    this.applyVisibility();
  }

  private addLight(p: InteriorLightPoint): void {
    const color = p.temp === 4000 ? NEUTRAL_4000K : WARM_3000K;
    let light: THREE.Light;
    let fixture: THREE.Object3D;

    switch (p.type) {
      case 'pendant': {
        // SpotLight 向下打光池：锥形阴影每帧仅 1 次渲染（PointLight 立方体阴影为 6 次，两盏即 12 次/帧，实测卡顿根因）
        const sl = new THREE.SpotLight(color, 25, 9, 0.95, 0.5, 1.5);
        sl.position.set(p.x, 2.0, p.z);
        sl.target.position.set(p.x, 0, p.z);
        this.group.add(sl.target);
        if (this.shadowCount < MAX_SHADOW_LIGHTS) {
          sl.castShadow = true;
          sl.shadow.mapSize.set(512, 512);
          sl.shadow.bias = -0.002;
          this.shadowCount++;
        }
        light = sl;
        fixture = this.makePendantFixture(p);
        break;
      }
      case 'downlight': {
        const sl = new THREE.SpotLight(color, 10, 4.5, 0.85, 0.5, 1.5);
        sl.position.set(p.x, 2.75, p.z);
        sl.target.position.set(p.x, 0, p.z);
        this.group.add(sl.target);
        light = sl;
        fixture = this.makeDownlightFixture(p);
        break;
      }
      case 'wall_lamp': {
        const wl = new THREE.PointLight(color, 3, 3.5, 1.5);
        wl.position.set(p.x, p.height ?? 1.6, p.z);
        light = wl;
        fixture = this.makeWallLampFixture(p);
        break;
      }
      case 'led_strip': {
        const ll = new THREE.PointLight(color, 5, 4.5, 1.2);
        ll.position.set(p.x + 0.15, p.height ?? 2.0, p.z);
        light = ll;
        fixture = this.makeStripFixture(p);
        break;
      }
      case 'dome':
      case 'ceiling_light':
      default: {
        const dl = new THREE.PointLight(color, 8, 7, 1.5);
        dl.position.set(p.x, 2.5, p.z);
        light = dl;
        fixture = this.makeDomeFixture(p);
        break;
      }
    }

    const fixtureMats: THREE.MeshStandardMaterial[] = [];
    fixture.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial && o.material.emissiveIntensity > 0) {
        fixtureMats.push(o.material);
      }
    });
    this.group.add(light);
    this.group.add(fixture);
    this.entries.push({ id: p.id, room: p.room, light, fixtureMats });
  }

  // ── 灯具示意网格（通用体，不预览 SKU 外观）──

  private emissiveMat(color: number): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: 0xfff5e0,
      emissive: color,
      emissiveIntensity: 1.4,
      roughness: 0.6,
    });
  }

  private makePendantFixture(p: InteriorLightPoint): THREE.Group {
    const g = new THREE.Group();
    const cord = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.6 }),
    );
    cord.position.set(p.x, 2.35, p.z); // 天花 2.8 → 灯罩 1.9
    const shade = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 16, 12, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65),
      this.emissiveMat(p.temp === 4000 ? NEUTRAL_4000K : WARM_3000K),
    );
    shade.position.set(p.x, 1.9, p.z);
    g.add(cord, shade);
    return g;
  }

  private makeDomeFixture(p: InteriorLightPoint): THREE.Group {
    const g = new THREE.Group();
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      this.emissiveMat(p.temp === 4000 ? NEUTRAL_4000K : WARM_3000K),
    );
    dome.scale.y = 0.4;
    dome.rotation.x = Math.PI; // 开口朝下
    dome.position.set(p.x, 2.79, p.z);
    g.add(dome);
    return g;
  }

  private makeDownlightFixture(p: InteriorLightPoint): THREE.Group {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.015, 16),
      this.emissiveMat(p.temp === 4000 ? NEUTRAL_4000K : WARM_3000K),
    );
    ring.position.set(p.x, 2.78, p.z);
    g.add(ring);
    return g;
  }

  private makeWallLampFixture(p: InteriorLightPoint): THREE.Group {
    const g = new THREE.Group();
    const h = p.height ?? 1.6;
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x8a6d3b, roughness: 0.4, metalness: 0.7 }), // 黄铜示意
    );
    base.rotation.z = Math.PI / 2;
    base.position.set(p.x, h + 0.08, p.z);
    const shade = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 12, 10),
      this.emissiveMat(WARM_3000K),
    );
    shade.position.set(p.x, h - 0.05, p.z);
    g.add(base, shade);
    return g;
  }

  private makeStripFixture(p: InteriorLightPoint): THREE.Group {
    const g = new THREE.Group();
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.02, 2.4),
      this.emissiveMat(WARM_3000K),
    );
    strip.position.set(p.x, p.height ?? 2.0, p.z);
    g.add(strip);
    return g;
  }

  // ── 开关与联动 ──

  private applyVisibility(): void {
    for (const e of this.entries) {
      const roomOn = this.roomOverrides.get(e.room) ?? true;
      const visible = this.on && roomOn;
      e.light.visible = visible;
      for (const m of e.fixtureMats) m.emissiveIntensity = visible ? 1.4 : 0.05;
    }
  }

  toggle(): boolean {
    this.on = !this.on;
    this.applyVisibility();
    return this.on;
  }

  setOn(on: boolean): void {
    this.on = on;
    this.applyVisibility();
  }

  setRoomLights(roomId: string, on: boolean): void {
    this.roomOverrides.set(roomId, on);
    this.applyVisibility();
  }

  /** 太阳联动：夜晚或太阳高度角 <10°（黄昏掠射）自动开灯 */
  syncSolar(state: { isNight: boolean; altitudeDeg: number }): void {
    this.setOn(state.isNight || state.altitudeDeg < 10);
  }

  dispose(): void {
    this.scene.remove(this.group);
  }

  get isOn(): boolean {
    return this.on;
  }

  get lightCount(): number {
    return this.entries.length;
  }

  get shadowLightCount(): number {
    return this.shadowCount;
  }
}
