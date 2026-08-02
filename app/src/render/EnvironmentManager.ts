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
    this.scene.environment = envMap;
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
    const dir = sunDirection(pos.altitudeDeg, pos.azimuthDeg);

    this.dirLight.visible = !light.isNight;
    this.dirLight.intensity = light.sunIntensity;
    this.dirLight.color.setHex(light.sunColorHex);
    this.dirLight.position.set(dir.x * SUN_RADIUS, Math.max(dir.y * SUN_RADIUS, 0.5), dir.z * SUN_RADIUS);
    this.ambientLight.intensity = light.ambientIntensity;
    this.scene.background = light.isNight ? NIGHT_BACKGROUND : DAY_BACKGROUND;

    this.lastState = { altitudeDeg: pos.altitudeDeg, azimuthDeg: pos.azimuthDeg, isNight: light.isNight };
  }

  toggleIBL(enabled: boolean): void {
    this.scene.environment = enabled ? this.envMap : null;
  }

  getLightingState(): { altitudeDeg: number; azimuthDeg: number; isNight: boolean; iblEnabled: boolean } {
    return { ...this.lastState, iblEnabled: this.scene.environment !== null };
  }
}
