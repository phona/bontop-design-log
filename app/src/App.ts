import { StateSync } from './state/StateSync.js';
import { HouseScene } from './render/HouseScene.js';
import { SchemePanel } from './ui/SchemePanel.js';
import { InfoPanel } from './ui/InfoPanel.js';
import { OfflineIndicator } from './ui/OfflineIndicator.js';
import type { CurrentScheme } from '@shared/types';

export class App {
  private stateSync: StateSync;
  private houseScene: HouseScene;
  private schemePanel: SchemePanel;
  private infoPanel: InfoPanel;
  private offlineIndicator: OfflineIndicator;
  private projectData: any = null;
  private rafId?: number;

  constructor(canvas: HTMLCanvasElement) {
    this.stateSync = new StateSync();
    this.houseScene = new HouseScene(canvas);
    this.schemePanel = new SchemePanel({
      topicTabs: document.getElementById('topic-tabs')!,
      topicOptions: document.getElementById('topic-options')!,
      schemeName: document.getElementById('scheme-name')!,
      schemeDesc: document.getElementById('scheme-desc')!,
      schemePros: document.getElementById('scheme-pros')!,
      schemeCons: document.getElementById('scheme-cons')!,
      warnings: document.getElementById('warnings')!,
    });
    this.infoPanel = new InfoPanel('info-panel');
    this.offlineIndicator = new OfflineIndicator('offline-indicator');

    this.setupEventHandlers();
  }

  async start(): Promise<void> {
    const response = await fetch('/api/project');
    this.projectData = await response.json();

    await this.houseScene.buildFromCatalog(this.projectData);

    this.stateSync.start();

    this.renderLoop();
  }

  private setupEventHandlers(): void {
    this.stateSync.onSchemeChange((scheme: CurrentScheme) => {
      for (const [topicId, selection] of Object.entries(scheme.selections)) {
        if (selection.default) {
          this.houseScene.setSelection(topicId, selection.default);
        }
      }
    });

    this.stateSync.onVisualCommand((command) => {
      if (command.type === 'set_camera_target') {
        const payload = command.payload as { targetId: string };
        this.houseScene.setCameraTarget(payload.targetId);
      } else if (command.type === 'highlight_object') {
        const payload = command.payload as { objectId: string };
        this.houseScene.highlightObject(payload.objectId);
      }
    });

    this.stateSync.onOfflineChange((offline) => {
      this.offlineIndicator.setOffline(offline);
    });

    this.houseScene.onObjectClick((objectId) => {
      this.infoPanel.showObjectInfo(objectId);
      this.stateSync.postViewContext(objectId);
    });
  }

  private renderLoop(): void {
    this.houseScene.render();
    this.rafId = requestAnimationFrame(() => this.renderLoop());
  }
}
