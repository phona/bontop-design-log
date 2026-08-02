import * as THREE from 'three';
import { getSolarPosition, getSunriseSunset } from '@shared/solar';
import type { EnvironmentManager } from './EnvironmentManager.js';

const HOURS_PER_SECOND = 24 / 10;

export class SunlightSystem {
  private month = 12;
  private day = 22;
  private hour = 12;
  private playing = false;
  private trajectory: THREE.Line | null = null;
  private sunDisc: THREE.Sprite | null = null;
  private onPlayingChange?: (playing: boolean) => void;
  private lastAltitude = 0;
  private lastAzimuth = 0;

  constructor(
    private scene: THREE.Scene,
    private envManager: EnvironmentManager,
    private location: { latitude: number; longitude: number; timezone: number },
    private center: { x: number; z: number }
  ) {
    this.apply();
  }

  setDate(month: number, day: number): void {
    this.month = month;
    this.day = day;
    this.apply();
    if (this.trajectory) {
      this.hideTrajectory();
      this.showTrajectory();
    }
  }

  setHour(hour: number): void {
    this.hour = ((hour % 24) + 24) % 24;
    this.apply();
  }

  getDate(): { month: number; day: number } {
    return { month: this.month, day: this.day };
  }

  getHour(): number {
    return this.hour;
  }

  getSolarReadout(): { altitudeDeg: number; azimuthDeg: number } {
    return { altitudeDeg: this.lastAltitude, azimuthDeg: this.lastAzimuth };
  }

  togglePlay(): boolean {
    this.playing = !this.playing;
    this.onPlayingChange?.(this.playing);
    return this.playing;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  setPlayingListener(cb: (playing: boolean) => void): void {
    this.onPlayingChange = cb;
  }

  update(dtSeconds: number): void {
    if (!this.playing) return;
    this.setHour(this.hour + dtSeconds * HOURS_PER_SECOND);
  }

  showTrajectory(): void {
    if (this.trajectory) return;
    const { sunriseHour, sunsetHour } = getSunriseSunset(
      this.month,
      this.day,
      this.location.latitude,
      this.location.longitude,
      this.location.timezone
    );
    const points: THREE.Vector3[] = [];
    for (let t = sunriseHour; t <= sunsetHour; t += 10 / 60) {
      const pos = getSolarPosition({
        month: this.month,
        day: this.day,
        hour: t,
        latitudeDeg: this.location.latitude,
        longitudeDeg: this.location.longitude,
        timezoneHours: this.location.timezone,
      });
      if (pos.altitudeDeg <= 0) continue;
      points.push(this.worldPoint(pos.altitudeDeg, pos.azimuthDeg, 45));
    }
    if (points.length < 2) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setFromPoints(points);
    this.trajectory = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffcc44 }));
    this.scene.add(this.trajectory);

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffdd55';
      ctx.beginPath();
      ctx.arc(32, 32, 28, 0, Math.PI * 2);
      ctx.fill();
    }
    this.sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas) }));
    this.sunDisc.scale.set(2.5, 2.5, 1);
    this.scene.add(this.sunDisc);
    this.updateSunDisc();
  }

  hideTrajectory(): void {
    if (this.trajectory) {
      this.scene.remove(this.trajectory);
      this.trajectory.geometry.dispose();
      (this.trajectory.material as THREE.LineBasicMaterial).dispose();
      this.trajectory = null;
    }
    if (this.sunDisc) {
      this.scene.remove(this.sunDisc);
      const material = this.sunDisc.material as THREE.SpriteMaterial;
      material.map?.dispose();
      material.dispose();
      this.sunDisc = null;
    }
  }

  dispose(): void {
    this.hideTrajectory();
  }

  private apply(): void {
    const pos = getSolarPosition({
      month: this.month,
      day: this.day,
      hour: this.hour,
      latitudeDeg: this.location.latitude,
      longitudeDeg: this.location.longitude,
      timezoneHours: this.location.timezone,
    });
    this.lastAltitude = pos.altitudeDeg;
    this.lastAzimuth = pos.azimuthDeg;
    this.envManager.setSolarState(pos);
    this.updateSunDisc();
  }

  private updateSunDisc(): void {
    if (!this.sunDisc) return;
    const p = this.worldPoint(this.lastAltitude, this.lastAzimuth, 45);
    this.sunDisc.position.x = p.x;
    this.sunDisc.position.y = p.y;
    this.sunDisc.position.z = p.z;
    this.sunDisc.visible = this.lastAltitude > 0;
  }

  private worldPoint(altitudeDeg: number, azimuthDeg: number, radius: number): THREE.Vector3 {
    const a = altitudeDeg * (Math.PI / 180);
    const az = azimuthDeg * (Math.PI / 180);
    return new THREE.Vector3(
      this.center.x + Math.cos(a) * Math.sin(az) * radius,
      Math.max(Math.sin(a) * radius, 0.2),
      this.center.z - Math.cos(a) * Math.cos(az) * radius
    );
  }
}
