import * as THREE from 'three';
import { FURNITURE_DIMS } from '@shared/types';

/** Browser-only scene objects which must never enter shared/ or CLI exports. */
export class BrowserSceneDecorations {
  readonly root = new THREE.Group();
  private gridHelper?: THREE.GridHelper;
  private groundPlane?: THREE.Mesh;
  private ghostMesh: THREE.Mesh | null = null;
  private readonly markers = new Set<THREE.Object3D>();

  constructor(private readonly scene: THREE.Scene) {
    this.root.name = 'HOUSE_VIEW_ONLY';
    this.scene.add(this.root);
    this.buildBase();
  }

  private buildBase(): void {
    const grid = new THREE.GridHelper(40, 40, 0x444444, 0x2a2a2a);
    const materials = grid.material as THREE.Material | THREE.Material[];
    for (const material of Array.isArray(materials) ? materials : [materials]) {
      material.transparent = true;
      material.opacity = 1;
    }
    this.root.add(grid);
    this.gridHelper = grid;

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.9 }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.01;
    plane.receiveShadow = true;
    this.root.add(plane);
    this.groundPlane = plane;
  }

  getGridOpacity(): number {
    const material = this.gridHelper?.material as THREE.Material | THREE.Material[] | undefined;
    if (!material) return 1;
    return (Array.isArray(material) ? material[0] : material).opacity;
  }

  setGridOpacity(opacity: number): void {
    if (!this.gridHelper) return;
    const materials = this.gridHelper.material as THREE.Material | THREE.Material[];
    for (const material of Array.isArray(materials) ? materials : [materials]) material.opacity = opacity;
    for (const material of Array.isArray(materials) ? materials : [materials]) material.transparent = true;
  }

  addMarker(object: THREE.Object3D): void {
    this.root.add(object);
    this.markers.add(object);
  }

  clearMarkers(): void {
    for (const marker of this.markers) this.root.remove(marker);
    this.markers.clear();
  }

  clearDynamic(): void {
    this.clearMarkers();
    this.hideGhost();
  }

  showGhost(x: number, z: number, rotation: number, type: string): void {
    this.hideGhost();
    const dims = FURNITURE_DIMS[type];
    this.ghostMesh = new THREE.Mesh(
      new THREE.BoxGeometry(dims?.width ?? 1, 0.8, dims?.depth ?? 1),
      new THREE.MeshBasicMaterial({ color: 0x44aaff, transparent: true, opacity: 0.4, depthWrite: false }),
    );
    this.ghostMesh.position.set(x, 0, z);
    this.ghostMesh.rotation.y = rotation * Math.PI / 180;
    this.root.add(this.ghostMesh);
  }

  hideGhost(): void {
    if (!this.ghostMesh) return;
    this.root.remove(this.ghostMesh);
    this.ghostMesh.geometry.dispose();
    (this.ghostMesh.material as THREE.Material).dispose();
    this.ghostMesh = null;
  }

  updateGhostPosition(x: number, z: number, rotation?: number): void {
    if (!this.ghostMesh) return;
    this.ghostMesh.position.set(x, 0, z);
    if (rotation !== undefined) this.ghostMesh.rotation.y = rotation * Math.PI / 180;
  }

  getGhostPosition(): { x: number; z: number } | null {
    return this.ghostMesh ? { x: this.ghostMesh.position.x, z: this.ghostMesh.position.z } : null;
  }

  dispose(): void {
    this.hideGhost();
    this.clearDynamic();
    this.scene.remove(this.root);
    if (this.gridHelper) {
      this.gridHelper.geometry?.dispose();
      const materials = this.gridHelper.material as THREE.Material | THREE.Material[];
      for (const material of Array.isArray(materials) ? materials : [materials]) material.dispose?.();
      this.gridHelper = undefined;
    }
    if (this.groundPlane) {
      this.groundPlane.geometry?.dispose?.();
      (this.groundPlane.material as THREE.Material).dispose?.();
      this.groundPlane = undefined;
    }
  }
}
