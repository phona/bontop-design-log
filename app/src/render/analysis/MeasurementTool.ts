import * as THREE from 'three';

export interface MeasurementEvent {
  distance: number;
  dx: number;
  dy: number;
  dz: number;
  points: [THREE.Vector3, THREE.Vector3];
}

export class MeasurementTool {
  private points: THREE.Vector3[] = [];
  private markers: THREE.Object3D[] = [];
  private _active = false;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private measurementListeners: Array<(data: MeasurementEvent) => void> = [];
  private _lastMeasurement: MeasurementEvent | null = null;

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.Camera,
  ) {}

  get active(): boolean { return this._active; }

  get pointCount(): number { return this.points.length; }

  get lastMeasurement(): MeasurementEvent | null { return this._lastMeasurement; }

  setActive(active: boolean): void {
    this._active = active;
    if (!active) this.clear();
  }

  onMeasurement(cb: (data: MeasurementEvent) => void): void {
    this.measurementListeners.push(cb);
  }

  removeMeasurementListener(cb: (data: MeasurementEvent) => void): void {
    const idx = this.measurementListeners.indexOf(cb);
    if (idx !== -1) this.measurementListeners.splice(idx, 1);
  }

  onPointerClick(event: MouseEvent): void {
    if (!this._active) return;
    const point = this.raycastFromMouse(event);
    if (!point) return;
    this.addPoint(point);
  }

  onFirstPersonAction(): void {
    if (!this._active) return;
    const point = this.raycastFromCenter();
    if (!point) return;
    this.addPoint(point);
  }

  clear(): void {
    for (const obj of this.markers) {
      this.scene.remove(obj);
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      } else if (obj instanceof THREE.Line) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      } else if (obj instanceof THREE.Sprite) {
        (obj.material as THREE.SpriteMaterial).map?.dispose();
        (obj.material as THREE.Material).dispose();
      }
    }
    this.markers = [];
    this.points = [];
    this._lastMeasurement = null;
  }

  private addPoint(point: THREE.Vector3): void {
    this.points.push(point);
    this.createMarker(point);
    if (this.points.length >= 2) {
      this.drawMeasurement();
    }
  }

  private createMarker(point: THREE.Vector3): void {
    const dotGeo = new THREE.SphereGeometry(0.08, 8, 8);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const dot = new THREE.Mesh(dotGeo, dotMat);
    dot.position.copy(point);
    dot.position.y += 0.01;
    this.scene.add(dot);
    this.markers.push(dot);
  }

  private raycastFromMouse(event: MouseEvent): THREE.Vector3 | null {
    this.pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycastScene();
  }

  private raycastFromCenter(): THREE.Vector3 | null {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    return this.raycastScene();
  }

  private raycastScene(): THREE.Vector3 | null {
    const intersects = this.raycaster.intersectObjects(this.scene.children, true);
    for (const hit of intersects) {
      const data = hit.object.userData;
      if (data?.type === 'annotation') continue;
      return hit.point.clone();
    }
    return null;
  }

  private drawMeasurement(): void {
    const [a, b] = this.points.slice(-2);
    const distance = a.distanceTo(b);
    const dx = Math.abs(b.x - a.x);
    const dz = Math.abs(b.z - a.z);
    const dy = b.y - a.y;

    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = new THREE.LineDashedMaterial({
      color: 0x00ff00,
      dashSize: 0.1,
      gapSize: 0.05,
    });
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    this.scene.add(line);
    this.markers.push(line);

    const label = this.createLabelSprite(
      `${distance.toFixed(2)}m`,
      new THREE.Vector3(
        (a.x + b.x) / 2,
        Math.max(a.y, b.y) + 0.3,
        (a.z + b.z) / 2,
      )
    );
    this.scene.add(label);
    this.markers.push(label);

    const event: MeasurementEvent = {
      distance, dx, dy, dz,
      points: [a, b],
    };
    this._lastMeasurement = event;
    for (const cb of this.measurementListeners) {
      cb(event);
    }
  }

  private createLabelSprite(text: string, position: THREE.Vector3): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.beginPath();
    ctx.roundRect(0, 0, 256, 64, 8);
    ctx.fill();
    ctx.fillStyle = '#00ff00';
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 34);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(position);
    sprite.scale.set(1.2, 0.3, 1);
    return sprite;
  }
}
