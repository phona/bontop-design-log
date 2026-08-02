import * as THREE from 'three';
import type { HouseScene } from '../HouseScene.js';

const TIER_COLORS: Record<string, string> = {
  low: '#48bb78',
  medium: '#ecc94b',
  high: '#f56565',
};

const OVERLAY_OPACITY = 0.35;
const DEFAULT_DATE = '03-15';

interface RoomResult {
  id: string;
  name: string;
  score: number;
  tier: string;
  factors: Array<{ label: string; delta: number }>;
  declared: boolean;
}

interface SurfaceResult {
  id: string;
  room: string;
  kind: string;
  faces?: string;
  score: number;
  tier: string;
}

export class HumidityOverlay {
  private active = false;
  private date = DEFAULT_DATE;
  private originalMaterials = new Map<THREE.Mesh, THREE.Material>();
  private markers: THREE.Sprite[] = [];
  private roomsResult: RoomResult[] = [];
  private panel: HTMLDivElement | null = null;
  private pulsePhase = 0;
  private boundOnClick: () => void;

  constructor(private houseScene: HouseScene) {
    this.boundOnClick = () => this.onClick();
  }

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
      this.clearMarkers();
      await this.applyAnalysis();
    }
  }

  updatePulse(): void {
    if (!this.active || this.markers.length === 0) return;
    this.pulsePhase += 0.08;
    const s = 1.2 * (1 + 0.2 * Math.sin(this.pulsePhase));
    for (const marker of this.markers) {
      marker.scale.set(s, s, 1);
    }
  }

  private async activate(): Promise<void> {
    await this.applyAnalysis();
    this.houseScene.renderer.domElement.addEventListener('click', this.boundOnClick);
    this.active = true;
  }

  private deactivate(): void {
    this.restoreFloors();
    this.clearMarkers();
    this.hidePanel();
    this.houseScene.renderer.domElement.removeEventListener('click', this.boundOnClick);
    this.active = false;
  }

  private async applyAnalysis(): Promise<void> {
    const res = await fetch(`/api/analysis/humidity?date=${this.date}`);
    if (!res.ok) return;
    const data = (await res.json()) as { rooms: RoomResult[]; surfaces: SurfaceResult[] };
    this.roomsResult = data.rooms;
    const byId = new Map(data.rooms.map((r) => [r.id, r]));

    for (const mesh of this.houseScene.getFloorMeshes()) {
      const roomId = mesh.userData.roomId as string | undefined;
      if (!roomId) continue;
      if (!this.originalMaterials.has(mesh)) {
        this.originalMaterials.set(mesh, (mesh.material as THREE.MeshStandardMaterial).clone());
      }
      const result = byId.get(roomId);
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.color.set(TIER_COLORS[result?.tier ?? 'low']);
      mat.transparent = true;
      mat.opacity = OVERLAY_OPACITY;
    }

    for (const surface of data.surfaces) {
      if (surface.tier !== 'high') continue;
      const room = (this.houseScene.rooms as Record<string, { x: number; z: number }>)[surface.room];
      if (!room) continue;
      const y = surface.kind === 'slab' ? 0.3 : 1.4;
      this.markers.push(this.makeMarker(surface, room.x, y, room.z));
    }
  }

  private makeMarker(surface: SurfaceResult, x: number, y: number, z: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#f56565';
      ctx.beginPath();
      ctx.arc(32, 32, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff5f5';
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas) }));
    sprite.position.set(x, y, z);
    sprite.scale.set(1.2, 1.2, 1);
    this.houseScene.scene.add(sprite);
    return sprite;
  }

  private restoreFloors(): void {
    for (const [mesh, material] of this.originalMaterials) {
      mesh.material = material;
    }
    this.originalMaterials.clear();
  }

  private clearMarkers(): void {
    for (const marker of this.markers) {
      this.houseScene.scene.remove(marker);
      const material = marker.material as THREE.SpriteMaterial;
      material.map?.dispose();
      material.dispose();
    }
    this.markers = [];
  }

  private onClick(): void {
    const roomId = this.houseScene.raycastRoomAtPointer();
    const room = roomId ? this.roomsResult.find((r) => r.id === roomId) : undefined;
    if (!room) {
      this.hidePanel();
      return;
    }
    this.showPanel(room);
  }

  private showPanel(room: RoomResult): void {
    if (!this.panel) {
      this.panel = document.createElement('div');
      this.panel.id = 'humidity-info-panel';
      document.body.appendChild(this.panel);
    }
    const tierLabel: Record<string, string> = { low: '低风险', medium: '中风险', high: '高风险' };
    const factors = room.factors.length > 0
      ? room.factors.map((f) => `<div class="humidity-factor"><span>${f.label}</span><span>${f.delta > 0 ? '+' : ''}${f.delta}</span></div>`).join('')
      : '<div class="humidity-factor"><span>无显著风险因子</span><span>0</span></div>';
    this.panel.innerHTML = `
      <div class="humidity-info-header">
        <span>${room.name} · ${tierLabel[room.tier] ?? room.tier} · ${room.score} 分</span>
        <button id="humidity-info-close">×</button>
      </div>
      <div class="humidity-factors">${factors}</div>
      ${room.declared ? '' : '<div class="humidity-undeclared">未声明湿度因子，使用默认值</div>'}
    `;
    this.panel.style.display = 'block';
    this.panel.querySelector('#humidity-info-close')?.addEventListener('click', () => this.hidePanel());
  }

  private hidePanel(): void {
    if (this.panel) this.panel.style.display = 'none';
  }
}
