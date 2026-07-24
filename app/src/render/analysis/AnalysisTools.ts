import * as THREE from 'three';
import { MeasurementTool } from './MeasurementTool.js';
import { MeasurementPanel } from './MeasurementPanel.js';

export class AnalysisTools {
  measurement: MeasurementTool;
  panel: MeasurementPanel;
  private scene: THREE.Scene;
  private seeThrough = false;
  furnitureMeshes: THREE.Group[] = [];
  private rooms: Array<{ x: number; z: number; width: number; depth: number }> = [];
  private highlightedFurniture: Set<THREE.Group> = new Set();
  private pulsePhase = 0;

  constructor(scene: THREE.Scene, camera: THREE.Camera, container: HTMLElement) {
    this.scene = scene;
    this.measurement = new MeasurementTool(scene, camera);
    this.panel = new MeasurementPanel(container);

    this.measurement.onMeasurement((data) => {
      this.panel.showMeasurement(data.distance, data.dx, data.dz, this.measurement.pointCount);
      console.log(`[Measurement] ${data.distance.toFixed(2)}m (E-W: ${data.dx.toFixed(2)}m N-S: ${data.dz.toFixed(2)}m)`);
    });

    this.panel.setOnClear(() => {
      this.measurement.clear();
      this.panel.showPrompt();
    });

    this.panel.setOnSave(() => {
      const last = this.measurement.lastMeasurement;
      if (last) {
        console.log('[Measurement] Saved to log:', {
          distance: last.distance.toFixed(2),
          dx: last.dx.toFixed(2),
          dz: last.dz.toFixed(2),
          points: last.points.map(p => ({ x: p.x.toFixed(3), y: p.y.toFixed(3), z: p.z.toFixed(3) })),
        });
      }
    });
  }

  toggleMeasurement(): void {
    const active = !this.measurement.active;
    this.measurement.setActive(active);
    if (active) {
      this.panel.show();
      this.panel.showPrompt();
    } else {
      this.panel.hide();
    }
  }

  setFurnitureMeshes(meshes: THREE.Group[]): void {
    this.furnitureMeshes = meshes;
  }

  setRooms(rooms: Array<{ x: number; z: number; width: number; depth: number }>): void {
    this.rooms = rooms;
  }

  toggleSeeThrough(): void {
    this.seeThrough = !this.seeThrough;
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh.userData.wallType && mesh.userData.wallType !== 'structure') {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (this.seeThrough) {
          mesh.userData.originalOpacity = mat.opacity;
          mesh.userData.originalTransparent = mat.transparent;
          mat.transparent = true;
          mat.opacity = 0.15;
          mat.depthWrite = false;
        } else {
          mat.opacity = mesh.userData.originalOpacity ?? 1;
          mat.transparent = mesh.userData.originalTransparent ?? false;
          mat.depthWrite = true;
        }
        mat.needsUpdate = true;
      }
    });
  }

  isSeeThrough(): boolean {
    return this.seeThrough;
  }

  checkFurnitureCollisions(): void {
    this.highlightedFurniture.clear();
    for (const group of this.furnitureMeshes) {
      const pos = new THREE.Vector3();
      group.getWorldPosition(pos);
      const inside = this.rooms.some(r => {
        const halfW = r.width / 2;
        const halfD = r.depth / 2;
        return pos.x >= r.x - halfW && pos.x <= r.x + halfW &&
               pos.z >= r.z - halfD && pos.z <= r.z + halfD;
      });
      if (!inside) {
        this.highlightedFurniture.add(group);
        group.traverse(obj => {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh) {
            const mat = mesh.material as THREE.MeshStandardMaterial;
            mat.emissive.setHex(0xff0000);
            mat.emissiveIntensity = 0.3;
          }
        });
      } else {
        group.traverse(obj => {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh) {
            const mat = mesh.material as THREE.MeshStandardMaterial;
            mat.emissive.setHex(0x000000);
            mat.emissiveIntensity = 0;
          }
        });
      }
    }
    this.pulsePhase = 0;
  }

  updatePulse(): void {
    if (this.highlightedFurniture.size === 0) return;
    this.pulsePhase += 0.05;
    const intensity = 0.3 + 0.5 * Math.sin(this.pulsePhase);
    for (const group of this.highlightedFurniture) {
      group.traverse(obj => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          const mat = mesh.material as THREE.MeshStandardMaterial;
          if (mat.emissive.getHex() === 0xff0000) {
            mat.emissiveIntensity = intensity;
          }
        }
      });
    }
  }
}
