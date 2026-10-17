import * as THREE from 'three';
import type { LightingRenderConfig, RenderLightingFixture } from '@shared/types';
import { getResolvedTrackLightHeads, getTrackLightConfig } from '@shared/render/TrackLightLayout';
import { buildWallLampVisual, getWallLampConfig, getWallLampLensPosition, wallSideNormal } from '@shared/render/WallLampGeometry';
import { buildNightLightVisual, getNightLightMountNormal } from '@shared/render/NightLightGeometry';
import { buildMultiGlobeChandelierVisual, getMultiGlobeChandelierConfig, getMultiGlobeGlobeCenters } from '@shared/render/MultiGlobeChandelierGeometry';
import { buildCloudOrbCeilingLightVisual, getCloudOrbCeilingLightConfig } from '@shared/render/CloudOrbCeilingLightGeometry';

/**
 * 室内灯光系统（spec: 2026-08-12-interior-lighting-design.md）
 * 数据源 = shared render-facts projection，施工点位与渲染锚点保持分离。
 * 阴影预算：≤2 个投影光源（pendant 类型）；其余零阴影保帧率。
 */

const MAX_SHADOW_LIGHTS = 2;

/**
 * 浏览器渲染显示校准：当前灯具能量是人为设定的 Three.js intensity，
 * 不是灯具流明值。统一压低到 60% 以收敛夜景亮斑，不能用于反推照度或选型。
 */
const LIGHTING_ENERGY_VISUAL_SCALE = 0.6;
export type ColorAppearanceMode = 'eye-adapted' | 'raw-cct';
const DEFAULT_COLOR_APPEARANCE: ColorAppearanceMode = 'eye-adapted';
// A partial adaptation is deliberately used for preview: it moves the source
// white point 70% toward D65 in Linear-sRGB, while retaining some CCT character.
const EYE_ADAPTATION_D65_MIX = 0.7;
const D65_LINEAR_WHITE = new THREE.Color().setRGB(1, 1, 1, THREE.LinearSRGBColorSpace);

interface LightEntry {
  id: string;
  room: string;
  light: THREE.Light;
  lights: THREE.Light[];
  visual: THREE.Object3D;
  fixtureMats: THREE.MeshStandardMaterial[];
  baseEnergies: number[];
  baseColors: THREE.Color[];
}

// Keep every ceiling-mounted visual and its light source below the ceiling bottom.
const CEILING_VISUAL_CLEARANCE = 0.05;
// The point/spot light is the illumination source. The visible diffuser only
// needs a restrained glow; making it emit the full Kelvin color as well causes
// the fixture mesh to add a second, warm light source to the scene.
const FIXTURE_EMISSIVE_ON = 0.35 * LIGHTING_ENERGY_VISUAL_SCALE;
const FIXTURE_EMISSIVE_OFF = 0.05;
const FIXTURE_DIFFUSER_COLOR = 0xf7f7f2;
// 多头球泡按每个球罩一个 PointLight，光源位置与可见球罩共用同一中心计算。
// 每头强度只是夜景预演参数，不代表灯具流明或照度。
const MULTI_GLOBE_PER_HEAD_ENERGY = 1.2;
const MULTI_GLOBE_PER_HEAD_DISTANCE = 3.5;

/**
 * Approximate the blackbody/Planckian locus in CIE 1931 xy, then convert the
 * chromaticity to the renderer's Linear-sRGB working space.
 *
 * The xy polynomials are the standard Planckian-locus approximation over the
 * range used by this preview (roughly 1667K–25000K). The historical
 * 1000K–40000K input clamp is retained for API compatibility; values outside
 * that useful range are extrapolated and gamut-clipped rather than presented as
 * spectrally exact. The 3000/3500/4000K presets retain their existing meaning.
 */
function kelvinToColor(temperatureK: number): THREE.Color {
  const temperature = Math.max(1000, Math.min(40000, temperatureK));
  let x: number;
  if (temperature <= 4000) {
    x = -0.2661239e9 / temperature ** 3
      - 0.2343580e6 / temperature ** 2
      + 0.8776956e3 / temperature
      + 0.179910;
  } else {
    x = -3.0258469e9 / temperature ** 3
      + 2.1070379e6 / temperature ** 2
      + 0.2226347e3 / temperature
      + 0.240390;
  }

  const y = temperature < 2222
    ? -1.1063814 * x ** 3 - 1.34811020 * x ** 2 + 2.18555832 * x - 0.20219683
    : temperature < 4000
      ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
      : 3.0817580 * x ** 3 - 5.87338670 * x ** 2 + 3.75112997 * x - 0.37001483;

  // XYZ with Y=1, followed by the CIE XYZ (D65) → Linear-sRGB matrix.
  const X = x / y;
  const Y = 1;
  const Z = (1 - x - y) / y;
  const red = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  const green = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  const blue = 0.0557 * X - 0.2040 * Y + 1.0570 * Z;
  const scale = Math.max(red, green, blue, 1e-6);

  return new THREE.Color().setRGB(
    Math.max(0, red) / scale,
    Math.max(0, green) / scale,
    Math.max(0, blue) / scale,
    THREE.LinearSRGBColorSpace,
  );
}

function applyColorAppearance(color: THREE.Color, mode: ColorAppearanceMode): THREE.Color {
  if (mode === 'raw-cct') return color.clone();
  return color.clone().lerp(D65_LINEAR_WHITE, EYE_ADAPTATION_D65_MIX);
}

export class InteriorLightingSystem {
  private group = new THREE.Group();
  private entries: LightEntry[] = [];
  private on = false;
  private autoOn = false;
  private mode: 'auto' | 'manual' = 'auto';
  private temperatureOverrideK: number | null = null;
  private brightnessMultiplier = 1;
  private colorAppearanceMode: ColorAppearanceMode = DEFAULT_COLOR_APPEARANCE;
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
    // Apply the renderer calibration before the first solar sync as well.
    this.applyAppearance();
    this.applyVisibility();
  }

  private addLight(fixture: RenderLightingFixture): void {
    const rawColor = kelvinToColor(fixture.temperatureK);
    const color = applyColorAppearance(rawColor, this.colorAppearanceMode);
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
        const wallLampConfig = getWallLampConfig(this.lighting, fixture.id);
        point.position.copy(getWallLampLensPosition(fixture, wallLampConfig));
        light = point;
        lights = [point];
        visual = buildWallLampVisual(fixture, wallLampConfig, color);
        break;
      }
      case 'night_light': {
        const normal = getNightLightMountNormal(fixture);
        const sourceOffset = fixture.mountAnchor?.kind === 'furniture_face' ? 0.04 : 0.065;
        const guide = new THREE.SpotLight(color, 0.18, 0.95, Math.PI / 7, 0.96, 2);
        guide.castShadow = false;
        guide.position.set(
          x + normal.x * sourceOffset,
          Math.max(0.05, y - 0.045),
          z + normal.z * sourceOffset,
        );
        guide.target.position.set(
          x + normal.x * 0.42,
          0.015,
          z + normal.z * 0.42,
        );
        this.group.add(guide.target);
        targets.push(guide.target);
        light = guide;
        lights = [guide];
        visual = buildNightLightVisual(fixture, color);
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
        const multiGlobeConfig = getMultiGlobeChandelierConfig(this.lighting, fixture.id);
        if (multiGlobeConfig) {
          lights = getMultiGlobeGlobeCenters(fixture, multiGlobeConfig).map((center) => {
            const point = new THREE.PointLight(color, MULTI_GLOBE_PER_HEAD_ENERGY, MULTI_GLOBE_PER_HEAD_DISTANCE, 1.5);
            point.position.copy(center);
            return point;
          });
          light = lights[0];
        } else {
          const point = new THREE.PointLight(color, 8, 7, 1.5);
          point.position.set(x, y, z);
          light = point;
          lights = [point];
        }
        visual = this.makeDomeFixture(fixture, color);
        break;
      }
    }

    visual.userData = {
      ...visual.userData,
      type: 'lighting_fixture',
      objectId: `electrical:${fixture.id}`,
      fixtureType: fixture.type,
      roomId: fixture.room,
      ...(fixture.wallId !== undefined ? { wallId: fixture.wallId } : {}),
      ...(fixture.wallSide !== undefined ? { wallSide: fixture.wallSide } : {}),
      ...(fixture.mountAnchor !== undefined ? { mountAnchor: fixture.mountAnchor } : {}),
      ...(fixture.type === 'wall_lamp' && fixture.wallSide !== undefined
        ? { mountNormal: wallSideNormal(fixture.wallSide)?.toArray() }
        : {}),
      ...(fixture.type === 'wall_lamp' ? (() => {
        const config = getWallLampConfig(this.lighting, fixture.id);
        return {
          style: config.style,
          finish: config.finish,
          dimensions: {
            backplateDiameter: config.backplateDiameter,
            headDiameter: config.headDiameter,
            headLength: config.headLength,
            armLength: config.armLength,
            maxProjection: config.maxProjection,
          },
          control: config.control,
          adjustability: config.adjustability,
        };
      })() : {}),
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
    this.entries.push({
      id: fixture.id,
      room: fixture.room,
      light,
      lights,
      visual,
      fixtureMats,
      baseEnergies: lights.map((item) => item.intensity),
      // Keep the configured CCT in raw Linear-sRGB so changing appearance mode
      // can re-derive both the light and the visible diffuser without rebuilding.
      baseColors: lights.map(() => rawColor.clone()),
    });
  }

  // ── 灯具示意网格（通用体，不预览 SKU 外观）──

  private emissiveMat(color: THREE.Color): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      // The diffuser is a neutral visible surface; only its restrained emissive
      // channel carries the light's CCT. The light object does the actual lighting.
      color: new THREE.Color(FIXTURE_DIFFUSER_COLOR),
      emissive: color.clone(),
      emissiveIntensity: FIXTURE_EMISSIVE_ON,
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
    const multiGlobeConfig = getMultiGlobeChandelierConfig(this.lighting, fixture.id);
    if (multiGlobeConfig) return buildMultiGlobeChandelierVisual(fixture, multiGlobeConfig, color);

    const cloudOrbConfig = getCloudOrbCeilingLightConfig(this.lighting, fixture.id);
    if (cloudOrbConfig) return buildCloudOrbCeilingLightVisual(fixture, cloudOrbConfig, color);

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

  private makeStripFixture(fixture: RenderLightingFixture, color: THREE.Color): THREE.Group {
    const group = new THREE.Group();
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 2.4), this.emissiveMat(color));
    strip.position.copy(fixture.position);
    group.add(strip);
    return group;
  }

  // ── 开关与联动 ──

  private applyVisibility(): void {
    this.on = this.mode === 'auto' ? this.autoOn : this.on;
    for (const entry of this.entries) {
      const roomOn = this.roomOverrides.get(entry.room) ?? true;
      const visible = this.on && roomOn;
      for (const fixtureLight of entry.lights) fixtureLight.visible = visible;
      entry.light.visible = visible;
      entry.visual.visible = true;
      for (const material of entry.fixtureMats) {
        material.emissiveIntensity = visible
          ? FIXTURE_EMISSIVE_ON * this.brightnessMultiplier
          : FIXTURE_EMISSIVE_OFF;
      }
    }
  }

  toggle(): boolean {
    this.mode = 'manual';
    this.on = !this.on;
    this.applyVisibility();
    return this.on;
  }

  setOn(on: boolean): void {
    this.mode = 'manual';
    this.on = on;
    this.applyVisibility();
  }

  setRoomLights(roomId: string, on: boolean): void {
    this.roomOverrides.set(roomId, on);
    this.applyVisibility();
  }

  /** 太阳联动：夜晚或太阳高度角 <10°（黄昏掠射）自动开灯 */
  syncSolar(state: { isNight: boolean; altitudeDeg: number }): void {
    this.autoOn = state.isNight || state.altitudeDeg < 10;
    this.applyVisibility();
  }

  /** Switch between solar-following lights and the explicit preview switch. */
  setPreviewMode(mode: 'auto' | 'manual', manualOn = this.on): void {
    this.mode = mode;
    if (mode === 'manual') this.on = manualOn;
    this.applyVisibility();
  }

  setPreviewManualOn(on: boolean): void {
    this.mode = 'manual';
    this.on = on;
    this.applyVisibility();
  }

  setPreviewTemperature(temperatureK: number | null): void {
    this.temperatureOverrideK = temperatureK === null ? null : Math.max(1000, Math.min(10000, temperatureK));
    this.applyAppearance();
  }

  setPreviewBrightness(multiplier: number): void {
    this.brightnessMultiplier = Math.max(0, Math.min(2, Number.isFinite(multiplier) ? multiplier : 1));
    this.applyAppearance();
  }

  setPreviewColorAppearanceMode(mode: ColorAppearanceMode): void {
    this.colorAppearanceMode = mode === 'raw-cct' ? 'raw-cct' : DEFAULT_COLOR_APPEARANCE;
    this.applyAppearance();
  }

  /** Restore fixture temperatures and intensities from the active render config. */
  clearPreviewOverrides(): void {
    this.temperatureOverrideK = null;
    this.brightnessMultiplier = 1;
    this.colorAppearanceMode = DEFAULT_COLOR_APPEARANCE;
    this.roomOverrides.clear();
    this.mode = 'auto';
    this.applyAppearance();
    this.applyVisibility();
  }

  getPreviewRooms(): Array<{ id: string; enabled: boolean }> {
    return [...new Set(this.entries.map((entry) => entry.room))]
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
      .map((id) => ({ id, enabled: this.roomOverrides.get(id) ?? true }));
  }

  getPreviewState(): { mode: 'auto' | 'manual'; manualOn: boolean; temperatureK: number | null; brightness: number; colorAppearance: ColorAppearanceMode } {
    return {
      mode: this.mode,
      manualOn: this.on,
      temperatureK: this.temperatureOverrideK,
      brightness: this.brightnessMultiplier,
      colorAppearance: this.colorAppearanceMode,
    };
  }

  private applyAppearance(): void {
    for (const entry of this.entries) {
      const color = applyColorAppearance(
        this.temperatureOverrideK === null ? entry.baseColors[0] : kelvinToColor(this.temperatureOverrideK),
        this.colorAppearanceMode,
      );
      entry.lights.forEach((light, index) => {
        light.color.copy(this.temperatureOverrideK === null
          ? applyColorAppearance(entry.baseColors[index], this.colorAppearanceMode)
          : color);
        light.intensity = entry.baseEnergies[index] * LIGHTING_ENERGY_VISUAL_SCALE * this.brightnessMultiplier;
      });
      for (const material of entry.fixtureMats) {
        material.color.setHex(FIXTURE_DIFFUSER_COLOR);
        material.emissive.copy(color);
        const roomOn = this.roomOverrides.get(entry.room) ?? true;
        material.emissiveIntensity = this.on && roomOn
          ? FIXTURE_EMISSIVE_ON * this.brightnessMultiplier
          : FIXTURE_EMISSIVE_OFF;
      }
    }
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
