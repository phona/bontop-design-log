import { HouseScene } from './render/HouseScene.js';
import { StateManager, type StateListener } from './state/StateManager.js';
import { TopicRegistry } from './topics/TopicRegistry.js';
import { SchemePanel } from './ui/SchemePanel.js';
import type { Command, CameraState } from '@shared/types';

export class App implements StateListener {
  private scene: HouseScene;
  private stateManager = new StateManager();
  private registry: TopicRegistry;
  private panel: SchemePanel;
  private rafId?: number;

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new HouseScene(canvas);
    this.registry = new TopicRegistry(this.scene);
    this.panel = new SchemePanel({
      topicTabs: document.getElementById('topic-tabs')!,
      topicOptions: document.getElementById('topic-options')!,
      schemeName: document.getElementById('scheme-name')!,
      schemeDesc: document.getElementById('scheme-desc')!,
      schemePros: document.getElementById('scheme-pros')!,
      schemeCons: document.getElementById('scheme-cons')!,
      warnings: document.getElementById('warnings')!,
    });
    this.scene.setOnObjectClick((objectId, type, room) => {
      this.stateManager.writeSnapshot();
      // eslint-disable-next-line no-console
      console.log('clicked', objectId, type, room);
    });
  }

  async start() {
    this.stateManager.setListener(this);
    await this.stateManager.loadSnapshot();

    this.panel.init(this.registry.list(), (topicId, optionId) => {
      void this.applySelection(topicId, optionId);
    });

    const initial = this.stateManager.getSelections();
    for (const [topicId, optionId] of Object.entries(initial)) {
      this.applySelection(topicId, optionId, false);
    }
    this.panel.setActiveOption('hvac', initial.hvac ?? 'A2', []);

    this.stateManager.startPolling();
    this.animate();
  }

  private async applySelection(topicId: string, optionId: string, writeSnapshot = true) {
    const topic = this.registry.get(topicId);
    if (!topic) return;

    const objectIds = topic.apply(this.scene, optionId);
    const warnings = topic.validate ? topic.validate(this.scene, optionId) : [];

    this.panel.setActiveOption(topicId, optionId, warnings);
    this.stateManager.setActiveTopic(topicId);

    if (writeSnapshot) {
      await this.stateManager.writeSnapshot();
    }

    // eslint-disable-next-line no-console
    console.log(`[App] applied ${topicId}=${optionId}`, objectIds, warnings);
  }

  onSelectionChanged(topic: string, optionId: string): void {
    void this.applySelection(topic, optionId);
  }

  onCommand(command: Command): void {
    if (command.type === 'set_camera_target') {
      const payload = command.payload as { targetId: string };
      this.scene.setCameraTarget(payload.targetId);
      void this.stateManager.writeSnapshot();
    } else if (command.type === 'highlight_object') {
      const payload = command.payload as { objectId: string };
      this.scene.highlightObject(payload.objectId);
    } else if (command.type === 'run_design_check') {
      // snapshot already updated; UI can refresh if needed
    }
  }

  getCameraState(): CameraState {
    return this.scene.getCameraState();
  }

  getActiveObject(): { objectId: string; type: string; room?: string } | undefined {
    return undefined;
  }

  getVisibleObjects(): string[] {
    return this.scene.getVisibleObjects();
  }

  getSelectedObjects(): string[] {
    return this.scene.getSelectedObjects();
  }

  private animate() {
    this.rafId = requestAnimationFrame(() => this.animate());
    this.scene.render();
  }
}
