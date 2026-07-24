import * as THREE from 'three';

export class EnvironmentManager {
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private dirLight!: THREE.DirectionalLight;
  private fillLight!: THREE.DirectionalLight;
  private ambientLight!: THREE.AmbientLight;
  private envMap: THREE.Texture | null = null;

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
  }

  setTimeOfDay(hour: number): void {
    const azimuthDeg = ((hour - 6) / 12) * 180 + 90;
    const elevationDeg = Math.sin(((hour - 6) / 12) * Math.PI) * 55 + 5;
    const radius = 20;
    const azimuthRad = azimuthDeg * Math.PI / 180;
    const elevationRad = elevationDeg * Math.PI / 180;
    this.dirLight.position.set(
      Math.sin(azimuthRad) * Math.cos(elevationRad) * radius,
      Math.sin(elevationRad) * radius,
      Math.cos(azimuthRad) * Math.cos(elevationRad) * radius,
    );
  }

  toggleIBL(enabled: boolean): void {
    this.scene.environment = enabled ? this.envMap : null;
  }

  getLightingState(): { hour: number; azimuth: number; elevation: number; iblEnabled: boolean } {
    return {
      hour: 12,
      azimuth: 180,
      elevation: 60,
      iblEnabled: this.scene.environment !== null,
    };
  }
}
