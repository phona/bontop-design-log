import * as THREE from 'three';

const GLASS_COLOR = 0x88ccff;
const GLASS_OPACITY = 0.6;

interface GlassTransmissionSpec {
  transmission: number;
  ior: number;
  thickness: number;
  attenuationDistance: number;
}

/** Browser-only material factory for presentation-specific procedural materials. */
export class BrowserSceneMaterials {
  private flutedGlassTexture: THREE.CanvasTexture | null = null;
  private blindSlatTexture: THREE.CanvasTexture | null = null;
  // transmission>0 会让 three.js 每帧把整帧不透明场景先渲进 transmission render target
  // （全场景画两遍，draw call 翻倍），默认走 opacity 快路径，高保真仅在导出/取证时开启。
  private glassHighFidelity = false;
  private glassRegistry = new Map<THREE.MeshPhysicalMaterial, GlassTransmissionSpec>();

  get glassHighFidelityEnabled(): boolean {
    return this.glassHighFidelity;
  }

  setGlassHighFidelity(enabled: boolean): void {
    this.glassHighFidelity = enabled;
    for (const [material, spec] of this.glassRegistry) {
      this.applyGlassMode(material, spec);
    }
  }

  // 场景重建时旧玻璃材质随 mesh 一起销毁，注册表同步清空防泄漏。
  clearGlassRegistry(): void {
    this.glassRegistry.clear();
  }

  private registerGlass(material: THREE.MeshPhysicalMaterial, spec: GlassTransmissionSpec): THREE.MeshPhysicalMaterial {
    this.glassRegistry.set(material, spec);
    this.applyGlassMode(material, spec);
    return material;
  }

  private applyGlassMode(material: THREE.MeshPhysicalMaterial, spec: GlassTransmissionSpec): void {
    if (this.glassHighFidelity) {
      material.transmission = spec.transmission;
      material.ior = spec.ior;
      material.thickness = spec.thickness;
      material.attenuationDistance = spec.attenuationDistance;
    } else {
      material.transmission = 0;
    }
    material.needsUpdate = true;
  }

  makeFrostedPrivacyMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: 0xe8edf0,
      transparent: true,
      opacity: 0.62,
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  }

  makeLowEGlassMaterial(): THREE.MeshPhysicalMaterial {
    return this.registerGlass(new THREE.MeshPhysicalMaterial({
      color: GLASS_COLOR,
      transparent: true,
      opacity: GLASS_OPACITY,
      roughness: 0.12,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    }), { transmission: 0.92, ior: 1.5, thickness: 0.02, attenuationDistance: 0.5 });
  }

  makeShowerScreenMaterial(): THREE.MeshPhysicalMaterial {
    return this.registerGlass(new THREE.MeshPhysicalMaterial({
      color: 0xdff4ff,
      transparent: true,
      opacity: 0.24,
      roughness: 0.08,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    }), { transmission: 0.96, ior: 1.5, thickness: 0.012, attenuationDistance: 1 });
  }

  makeFlutedGlassMaterial(paneWidth: number): THREE.MeshPhysicalMaterial {
    if (!this.flutedGlassTexture) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 4;
      const context = canvas.getContext('2d');
      if (!context) {
        return this.registerGlass(new THREE.MeshPhysicalMaterial({
          color: GLASS_COLOR,
          transparent: true,
          opacity: GLASS_OPACITY,
          roughness: 0.05,
          metalness: 0,
          side: THREE.DoubleSide,
        }), { transmission: 0.92, ior: 1.5, thickness: 0.02, attenuationDistance: 0.5 });
      }
      const period = 32;
      for (let x = 0; x < canvas.width; x++) {
        const t = (x % period) / period;
        const value = Math.round(128 + 110 * Math.sin(t * Math.PI * 2));
        context.fillStyle = `rgb(${value},${value},${value})`;
        context.fillRect(x, 0, 1, canvas.height);
      }
      this.flutedGlassTexture = new THREE.CanvasTexture(canvas);
      this.flutedGlassTexture.wrapS = THREE.RepeatWrapping;
    }

    const stripes = this.flutedGlassTexture.clone();
    stripes.needsUpdate = true;
    stripes.repeat.x = Math.max(1, Math.round(paneWidth / 0.012));
    const material = this.registerGlass(new THREE.MeshPhysicalMaterial({
      color: GLASS_COLOR,
      transparent: true,
      opacity: GLASS_OPACITY,
      roughness: 0.05,
      metalness: 0,
      side: THREE.DoubleSide,
    }), { transmission: 0.92, ior: 1.5, thickness: 0.02, attenuationDistance: 0.5 });
    material.roughness = 0.5;
    material.roughnessMap = stripes;
    material.bumpMap = stripes;
    material.bumpScale = 0.3;
    return material;
  }

  makeSheerMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: 0xf5f2ea,
      transparent: true,
      opacity: 0.35,
      roughness: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  }

  makeBlackoutMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: 0xcfc8ba,
      roughness: 0.95,
      side: THREE.DoubleSide,
    });
  }

  makeBlindMaterial(elementHeight = 2.8): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({
      color: 0xdfe3e6,
      transparent: true,
      opacity: 0.75,
      roughness: 0.6,
      metalness: 0.2,
      side: THREE.DoubleSide,
    });
    if (!this.blindSlatTexture) {
      const canvas = document.createElement('canvas');
      canvas.width = 8;
      canvas.height = 64;
      const context = canvas.getContext('2d');
      if (context) {
        // 单片叶片周期：上部叶面带轻微纵向渐变（拟叶片微弧），底部深色缝隙线
        const gradient = context.createLinearGradient(0, 0, 0, 54);
        gradient.addColorStop(0, '#f2f4f6');
        gradient.addColorStop(0.7, '#d4d8dc');
        gradient.addColorStop(1, '#b8bdc3');
        context.fillStyle = gradient;
        context.fillRect(0, 0, 8, 54);
        context.fillStyle = '#7d838a';
        context.fillRect(0, 54, 8, 10);
        this.blindSlatTexture = new THREE.CanvasTexture(canvas);
        this.blindSlatTexture.wrapT = THREE.RepeatWrapping;
        this.blindSlatTexture.colorSpace = THREE.SRGBColorSpace;
      }
    }
    if (this.blindSlatTexture) {
      // 挤出几何侧面 v 以米为单位：按 ~5cm 视觉叶距重复（deployed 与 gathered 共用，收拢带叶片压缩属合理表现）
      const stripes = this.blindSlatTexture.clone();
      stripes.needsUpdate = true;
      stripes.repeat.y = Math.max(1, Math.round(elementHeight / 0.05));
      material.map = stripes;
      material.bumpMap = stripes;
      material.bumpScale = 0.15;
    }
    return material;
  }

  dispose(): void {
    this.flutedGlassTexture?.dispose();
    this.flutedGlassTexture = null;
    this.blindSlatTexture?.dispose();
    this.blindSlatTexture = null;
    this.glassRegistry.clear();
  }
}

