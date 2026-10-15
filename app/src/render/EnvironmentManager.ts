import * as THREE from 'three';
import { computeLightState, sunDirection } from '@shared/solar';

const SUN_RADIUS = 60;
const DAY_BACKGROUND = new THREE.Color('#1a1a20');
const NIGHT_BACKGROUND = new THREE.Color('#0a0a18');

export interface SolarStateInput {
  altitudeDeg: number;
  azimuthDeg: number;
}

export class EnvironmentManager {
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private dirLight!: THREE.DirectionalLight;
  private fillLight!: THREE.DirectionalLight;
  private ambientLight!: THREE.AmbientLight;
  private envMap: THREE.Texture | null = null;
  private iblEnabled = true;
  private sunlightEnabled = false;
  private interiorOnlyNightPreview = false;
  private lastState: { altitudeDeg: number; azimuthDeg: number; isNight: boolean } = {
    altitudeDeg: 60,
    azimuthDeg: 180,
    isNight: false,
  };

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    this.renderer = renderer;
  }

  setup(): void {
    this.setupSkybox();
    this.setupLights();
    this.setupShadows();
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
  }

  private setupSkybox(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0, '#4a90d9');
    gradient.addColorStop(0.5, '#c8d8e8');
    gradient.addColorStop(1, '#888888');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1, 512);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const tempScene = new THREE.Scene();
    tempScene.background = texture;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envMap = pmrem.fromScene(tempScene, 0, 0.1, 100).texture;
    pmrem.dispose();
    texture.dispose();

    this.envMap = envMap;
    this.scene.environment = this.iblEnabled ? envMap : null;
  }

  private setupLights(): void {
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(this.ambientLight);

    this.dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    this.dirLight.position.set(12, 20, 8);
    this.dirLight.castShadow = true;
    this.scene.add(this.dirLight);

    this.fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    this.fillLight.position.set(-10, 8, -10);
    this.scene.add(this.fillLight);
  }

  private setupShadows(): void {
    this.dirLight.shadow.mapSize.set(2048, 2048);
    this.dirLight.shadow.bias = -0.001;
    const cam = this.dirLight.shadow.camera as THREE.OrthographicCamera;
    cam.left = -25;
    cam.right = 25;
    cam.top = 25;
    cam.bottom = -25;
    cam.near = 1;
    cam.far = 150;
    cam.updateProjectionMatrix();
  }

  setSolarState(pos: SolarStateInput): void {
    const light = computeLightState(pos.altitudeDeg);
    this.lastState = { altitudeDeg: pos.altitudeDeg, azimuthDeg: pos.azimuthDeg, isNight: light.isNight };
    this.applyCurrentState();
    this.requestShadowUpdate();
  }

  setSunlightEnabled(enabled: boolean): void {
    if (this.sunlightEnabled === enabled) return;
    this.sunlightEnabled = enabled;
    this.applyCurrentState();
    this.requestShadowUpdate();
  }

  /** Manual night lighting preview: disable all global illumination, even when solar simulation is off. */
  setInteriorOnlyNightPreview(enabled: boolean): void {
    if (this.interiorOnlyNightPreview === enabled) return;
    this.interiorOnlyNightPreview = enabled;
    this.applyCurrentState();
    this.requestShadowUpdate();
  }

  getSunlightEnabled(): boolean {
    return this.sunlightEnabled;
  }

  requestShadowUpdate(): void {
    this.renderer.shadowMap.needsUpdate = true;
  }

  private applySolarState(): void {
    const light = computeLightState(this.lastState.altitudeDeg);
    const dir = sunDirection(this.lastState.altitudeDeg, this.lastState.azimuthDeg);

    this.dirLight.visible = !light.isNight;
    this.dirLight.intensity = light.sunIntensity;
    this.dirLight.color.setHex(light.sunColorHex);
    this.dirLight.position.set(dir.x * SUN_RADIUS, Math.max(dir.y * SUN_RADIUS, 0.5), dir.z * SUN_RADIUS);
    if (light.isNight) {
      this.applyNightOnlyState();
    } else {
      this.ambientLight.intensity = light.ambientIntensity;
      this.scene.environment = this.iblEnabled ? this.envMap : null;
      this.fillLight.color.setHex(0xffffff);
      this.fillLight.intensity = 0.3;
      this.ambientLight.color.setHex(0xffffff);
    }
    this.scene.background = light.isNight ? NIGHT_BACKGROUND : DAY_BACKGROUND;
  }

  private applyCurrentState(): void {
    if (this.interiorOnlyNightPreview || this.lastState.isNight) {
      this.applyNightOnlyState();
    } else if (this.sunlightEnabled) {
      this.applySolarState();
    } else {
      this.applyStaticPreset();
    }
  }

  private applyNightOnlyState(): void {
    // This includes both real solar night and the explicit manual night preview.
    this.dirLight.visible = false;
    this.dirLight.intensity = 0;
    this.ambientLight.intensity = 0;
    this.ambientLight.color.setHex(0x9aa6cf);
    this.fillLight.color.setHex(0x7f8ab0);
    this.fillLight.intensity = 0;
    this.scene.environment = null;
    this.scene.background = NIGHT_BACKGROUND;
  }

  private applyStaticPreset(): void {
    this.dirLight.visible = true;
    this.dirLight.intensity = 0.9;
    this.dirLight.color.setHex(0xffffff);
    this.dirLight.position.set(12, 20, 8);
    this.ambientLight.intensity = 0.55;
    this.ambientLight.color.setHex(0xffffff);
    this.fillLight.color.setHex(0xffffff);
    this.fillLight.intensity = 0.3;
    this.scene.environment = this.iblEnabled ? this.envMap : null;
    this.scene.background = DAY_BACKGROUND;
  }

  toggleIBL(enabled: boolean): void {
    this.iblEnabled = enabled;
    const night = this.interiorOnlyNightPreview || this.lastState.isNight;
    this.scene.environment = enabled && !night ? this.envMap : null;
  }

  getLightingState(): { altitudeDeg: number; azimuthDeg: number; isNight: boolean; iblEnabled: boolean } {
    return { ...this.lastState, iblEnabled: this.iblEnabled };
  }
}
