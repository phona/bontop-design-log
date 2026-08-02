import * as THREE from 'three';
import type { HouseScene } from '../HouseScene.js';

const COLOR_MIN = new THREE.Color('#4a5568');
const COLOR_MAX = new THREE.Color('#ed8936');
const MAX_HOURS = 4;

interface RoomResult {
  id: string;
  name: string;
  directHours: number;
  westSunWarning: boolean;
}

export class DaylightHeatmap {
  private active = false;
  private date = '12-22';
  private originalMaterials = new Map<THREE.Mesh, THREE.Material>();
  private labels: THREE.Sprite[] = [];
  private enabledTopDown = false;

  constructor(private houseScene: HouseScene) {}

  isActive(): boolean {
    return this.active;
  }

  async toggle(): Promise<void> {
    if (this.active) {
      this.deactivate();
    } else {
      await this.activate();
    }
  }

  async refresh(date: string): Promise<void> {
    this.date = date;
    if (this.active) {
      this.clearLabels();
      await this.applyAnalysis();
    }
  }

  private async activate(): Promise<void> {
    await this.applyAnalysis();
    if (!this.houseScene.topDownView.isEnabled()) {
      this.houseScene.topDownView.enable();
      this.enabledTopDown = true;
    }
    this.active = true;
  }

  private deactivate(): void {
    for (const [mesh, material] of this.originalMaterials) {
      mesh.material = material;
    }
    this.originalMaterials.clear();
    this.clearLabels();
    if (this.enabledTopDown) {
      this.houseScene.topDownView.disable();
      this.enabledTopDown = false;
    }
    this.active = false;
  }

  private async applyAnalysis(): Promise<void> {
    const res = await fetch(`/api/analysis/sunlight?date=${this.date}`);
    if (!res.ok) return;
    const data = (await res.json()) as { rooms: RoomResult[] };
    const byId = new Map(data.rooms.map((r) => [r.id, r]));

    for (const mesh of this.houseScene.getFloorMeshes()) {
      const roomId = mesh.userData.roomId as string | undefined;
      if (!roomId) continue;
      if (!this.originalMaterials.has(mesh)) {
        this.originalMaterials.set(mesh, (mesh.material as THREE.MeshStandardMaterial).clone());
      }
      const result = byId.get(roomId);
      const t = Math.min((result?.directHours ?? 0) / MAX_HOURS, 1);
      const color = new THREE.Color(COLOR_MIN);
      color.lerp(COLOR_MAX, t);
      (mesh.material as THREE.MeshStandardMaterial).color.set(color);
    }

    for (const result of data.rooms) {
      const room = (this.houseScene.rooms as Record<string, { x: number; z: number }>)[result.id];
      if (!room) continue;
      this.labels.push(this.makeLabel(`${result.directHours.toFixed(1)}h`, room.x, room.z));
    }
  }

  private makeLabel(text: string, x: number, z: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'rgba(20,20,35,0.85)';
      ctx.fillRect(0, 0, 128, 64);
      ctx.fillStyle = '#ffd591';
      ctx.font = 'bold 32px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 64, 32);
    }
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas) }));
    sprite.position.set(x, 1.2, z);
    sprite.scale.set(1.6, 0.8, 1);
    this.houseScene.scene.add(sprite);
    return sprite;
  }

  private clearLabels(): void {
    for (const label of this.labels) {
      this.houseScene.scene.remove(label);
      const material = label.material as THREE.SpriteMaterial;
      material.map?.dispose();
      material.dispose();
    }
    this.labels = [];
  }
}
