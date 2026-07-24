import * as THREE from 'three';
import { MeasurementTool } from './MeasurementTool.js';
import { MeasurementPanel } from './MeasurementPanel.js';

export class AnalysisTools {
  measurement: MeasurementTool;
  panel: MeasurementPanel;

  constructor(scene: THREE.Scene, camera: THREE.Camera, container: HTMLElement) {
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
}
