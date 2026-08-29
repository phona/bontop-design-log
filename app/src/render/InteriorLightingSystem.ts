import * as THREE from 'three';
import type { LightingRenderConfig, RenderLightingFixture } from '@shared/types';
import { getResolvedTrackLightHeads, getTrackLightConfig } from '@shared/render/TrackLightLayout';

/**
 * 室内灯光系统（spec: 2026-08-12-interior-lighting-design.md）
 * 数据源 = shared render-facts projection，施工点位与渲染锚点保持分离。
 * 阴影预算：≤2 个投影光源（pendant 类型）；其余零阴影保帧率。
 */

const MAX_SHADOW_LIGHTS = 2;

interface LightEntry {
  id: string;
  room: string;
  light: THREE.Light;
  lights: THREE.Light[];
  visual: THREE.Object3D;
  fixtureMats: THREE.MeshStandardMaterial[];
}

// Keep every ceiling-mounted visual and its light source below the ceiling bottom.
const CEILING_VISUAL_CLEARANCE = 0.05;
const FIXTURE_EMISSIVE_ON = 1.4;
const FIXTURE_EMISSIVE_OFF = 0.05;

function kelvinToColor(temperatureK: number): THREE.Color {
  const temperature = Math.max(1000, Math.min(40000, temperatureK)) / 100;
  let red: number;
  let green: number;
  let blue: number;

  if (temperature <= 66) {
    red = 255;
    green = 99.4708025861 * Math.log(temperature) - 161.1195681661;
    blue = temperature <= 19 ? 0 : 138.5177312231 * Math.log(temperature - 10) - 305.0447927307;
  } else {
    red = 329.698727446 * Math.pow(temperature - 60, -0.1332047592);
    green = 288.1221695283 * Math.pow(temperature - 60, -0.0755148492);
    blue = 255;
  }

  return new THREE.Color(
    Math.max(0, Math.min(255, red)) / 255,
    Math.max(0, Math.min(255, green)) / 255,
    Math.max(0, Math.min(255, blue)) / 255,
  );
}

export class InteriorLightingSystem {
  private group = new THREE.Group();
  private entries: LightEntry[] = [];
  private on = false;
  private roomOverrides = new Map<string, boolean>();
  private shadowCount = 0;

  constructor(
    private scene: THREE.Scene,
    fixtures: RenderLightingFixture[],
    private lighting?: LightingRenderConfig,
  ) {
    for (const fixture of fixtures) {
      if (fixture.enabled) this.addLight(fixture);
    }
    this.scene.add(this.group);
    this.applyVisibility();
  }

  private addLight(fixture: RenderLightingFixture): void {
    const color = kelvinToColor(fixture.temperatureK);
    const { x, y, z } = fixture.position;
    let light: THREE.Light;
    let lights: THREE.Light[];
    const targets: THREE.Object3D[] = [];
    let visual: THREE.Object3D;

    switch (fixture.type) {
      case 'pendant': {
        const spot = new THREE.SpotLight(color, 25, 9, 0.95, 0.5, 1.5);
        spot.position.set(x, y, z);
        spot.target.position.set(x, 0, z);
        this.group.add(spot.target);
        targets.push(spot.target);
        if (this.shadowCount < MAX_SHADOW_LIGHTS) {
          spot.castShadow = true;
          spot.shadow.mapSize.set(512, 512);
          spot.shadow.bias = -0.002;
          this.shadowCount++;
        }
        light = spot;
        lights = [spot];
        visual = this.makePendantFixture(fixture, color);
        break;
      }
      case 'track_light': {
        const trackGroup = new THREE.Group();
        const config = getTrackLightConfig(this.lighting, fixture.id, fixture.heads);
        lights = getResolvedTrackLightHeads(fixture.position, config).map((resolved) => {
          const spot = new THREE.SpotLight(color, config.energy, 5.5, config.beam, 0.45, 1.5);
          spot.position.set(resolved.position.x, resolved.position.y, resolved.position.z);
          spot.target.position.set(resolved.target.x, resolved.target.y, resolved.target.z);
          trackGroup.add(spot, spot.target);
          return spot;
        });
        light = lights[0];
        visual = this.makeTrackFixture(fixture, color);
        visual.add(trackGroup);
        break;
      }
      case 'downlight': {
        const spot = new THREE.SpotLight(color, 10, 4.5, 0.85, 0.5, 1.5);
        spot.position.set(x, y - (fixture.recessed ? 0.03 : CEILING_VISUAL_CLEARANCE), z);
        spot.target.position.set(x, 0, z);
        this.group.add(spot.target);
        targets.push(spot.target);
        light = spot;
        lights = [spot];
        visual = this.makeDownlightFixture(fixture, color);
        break;
      }
      case 'wall_lamp': {
        const point = new THREE.PointLight(color, 3, 3.5, 1.5);
        point.position.set(x, y, z);
        light = point;
        lights = [point];
        visual = this.makeWallLampFixture(fixture, color);
        break;
      }
      case 'led_strip': {
        const point = new THREE.PointLight(color, 5, 4.5, 1.2);
        point.position.set(x, y, z);
        light = point;
        lights = [point];
        visual = this.makeStripFixture(fixture, color);
        break;
      }
      case 'dome':
      case 'ceiling_light':
      default: {
        const point = new THREE.PointLight(color, 8, 7, 1.5);
        point.position.set(x, y, z);
        light = point;
        lights = [point];
        visual = this.makeDomeFixture(fixture, color);
        break;
      }
    }

    visual.userData = {
      type: 'lighting_fixture',
      objectId: `electrical:${fixture.id}`,
      fixtureType: fixture.type,
      roomId: fixture.room,
    };

    const fixtureMats: THREE.MeshStandardMaterial[] = [];
    visual.traverse((object) => {
      if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial && object.material.emissiveIntensity > 0) {
        fixtureMats.push(object.material);
      }
    });
    if (fixture.type === 'track_light') {
      this.group.add(visual);
    } else {
      this.group.add(...lights, ...targets, visual);
    }
    this.entries.push({ id: fixture.id, room: fixture.room, light, lights, visual, fixtureMats });
  }

  // ── 灯具示意网格（通用体，不预览 SKU 外观）──

  private emissiveMat(color: THREE.Color): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: 0xfff5e0,
      emissive: color,
      emissiveIntensity: 1.4,
      roughness: 0.6,
    });
  }

  private makePendantFixture(fixture: RenderLightingFixture, color: THREE.Color): THREE.Group {
    const { x, y, z } = fixture.position;
    const group = new THREE.Group();
    const cord = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.6 }),
    );
    cord.position.set(x, y - 0.45, z);
    const shade = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 16, 12, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65),
      this.emissiveMat(color),
    );
    shade.position.set(x, y - 0.9, z);
    group.add(cord, shade);
    return group;
  }

  private makeTrackFixture(fixture: RenderLightingFixture, color: THREE.Color): THREE.Group {
    const { x, y, z } = fixture.position;
    const group = new THREE.Group();
    const black = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.35, metalness: 0.75 });
    const config = getTrackLightConfig(this.lighting, fixture.id, fixture.heads);
    const track = new THREE.Mesh(new THREE.BoxGeometry(config.length, 0.045, 0.08), black);
    track.rotation.set(config.rotation.x, config.rotation.y, config.rotation.z);
    track.position.set(x, y - CEILING_VISUAL_CLEARANCE, z);
    group.add(track);
    for (const resolved of getResolvedTrackLightHeads(fixture.position, config)) {
      const direction = new THREE.Vector3(resolved.direction.x, resolved.direction.y, resolved.direction.z);
      const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.08, 12), black);
      mount.position.set(resolved.mountPosition.x, resolved.mountPosition.y - CEILING_VISUAL_CLEARANCE, resolved.mountPosition.z);
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.065, 0.14, 12), black);
      head.position.set(resolved.headPosition.x, resolved.headPosition.y - CEILING_VISUAL_CLEARANCE, resolved.headPosition.z);
      head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.038, 16), this.emissiveMat(color));
      lens.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
      lens.position.set(resolved.lensPosition.x, resolved.lensPosition.y - CEILING_VISUAL_CLEARANCE, resolved.lensPosition.z);
      group.add(mount, head, lens);
    }
    return group;
  }

  private makeDomeFixture(fixture: RenderLightingFixture, color: THREE.Color): THREE.Group {
    const group = new THREE.Group();
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      this.emissiveMat(color),
    );
    dome.scale.y = 0.4;
    dome.rotation.x = Math.PI;
    dome.position.copy(fixture.position);
    group.add(dome);
    return group;
  }

  private makeDownlightFixture(fixture: RenderLightingFixture, color: THREE.Color): THREE.Group {
    const { x, y, z } = fixture.position;
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.065, 0.08, 20),
      new THREE.MeshStandardMaterial({ color: 0xd8d5ce, roughness: 0.45, metalness: 0.15 }),
    );
    body.position.set(x, y + (fixture.recessed ? 0.04 : -CEILING_VISUAL_CLEARANCE - 0.04), z);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.068, 0.012, 8, 20),
      new THREE.MeshStandardMaterial({ color: 0xb4afa6, roughness: 0.4, metalness: 0.3 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, y + (fixture.recessed ? -0.002 : -CEILING_VISUAL_CLEARANCE - 0.082), z);
    const lens = new THREE.Mesh(
      new THREE.CircleGeometry(0.052, 20),
      this.emissiveMat(color),
    );
    lens.rotation.x = Math.PI / 2;
    lens.position.set(x, y + (fixture.recessed ? -0.006 : -CEILING_VISUAL_CLEARANCE - 0.083), z);
    group.add(body, ring, lens);
    return group;
  }

  private makeWallLampFixture(fixture: RenderLightingFixture, color: THREE.Color): THREE.Group {
    const { x, y, z } = fixture.position;
    const group = new THREE.Group();
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x8a6d3b, roughness: 0.4, metalness: 0.7 }),
    );
    base.rotation.z = Math.PI / 2;
    base.position.set(x, y + 0.08, z);
    const shade = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), this.emissiveMat(color));
    shade.position.set(x, y - 0.05, z);
    group.add(base, shade);
    return group;
  }

  private makeStripFixture(fixture: RenderLightingFixture, color: THREE.Color): THREE.Group {
    const group = new THREE.Group();
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 2.4), this.emissiveMat(color));
    strip.position.copy(fixture.position);
    group.add(strip);
    return group;
  }

  // ── 开关与联动 ──

  private applyVisibility(): void {
    for (const entry of this.entries) {
      const roomOn = this.roomOverrides.get(entry.room) ?? true;
      const visible = this.on && roomOn;
      for (const fixtureLight of entry.lights) fixtureLight.visible = visible;
      entry.light.visible = visible;
      entry.visual.visible = true;
      for (const material of entry.fixtureMats) material.emissiveIntensity = visible ? FIXTURE_EMISSIVE_ON : FIXTURE_EMISSIVE_OFF;
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
