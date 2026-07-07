import * as THREE from 'three';
import { StateSync } from './state/StateSync.js';
import { HouseScene } from './render/HouseScene.js';
import { SchemePanel } from './ui/SchemePanel.js';
import { InfoPanel } from './ui/InfoPanel.js';
import { OfflineIndicator } from './ui/OfflineIndicator.js';
import { Crosshair } from './ui/Crosshair.js';
import { HoverTooltip } from './ui/HoverTooltip.js';
import { OverviewMenu } from './ui/OverviewMenu.js';
import { CollisionDetector } from './scene/CollisionDetector.js';
import { FirstPersonController } from './scene/FirstPersonController.js';
import { rooms } from '@shared/houseData';
import { TopicRegistry } from './topics/TopicRegistry.js';
import type { CurrentScheme, DecisionLogEntry, Topic, SelectionPatch } from '@shared/types';

const ENTRY_GARDEN = rooms.find((r) => r.id === 'entry_garden')!;
const ORBIT_DISTANCE = 15;

export class App {
  private stateSync: StateSync;
  private houseScene: HouseScene;
  private schemePanel: SchemePanel;
  private infoPanel: InfoPanel;
  private offlineIndicator: OfflineIndicator;
  private crosshair: Crosshair;
  private hoverTooltip: HoverTooltip;
  private overviewMenu: OverviewMenu;
  private collision: CollisionDetector;
  private fpController: FirstPersonController;
  private projectData: any = null;
  private topics: Topic[] = [];
  private rafId?: number;
  private lastTime = 0;
  private modeIndicator: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private toastTimer?: number;

  constructor(canvas: HTMLCanvasElement) {
    this.stateSync = new StateSync();
    this.houseScene = new HouseScene(canvas);
    this.collision = new CollisionDetector(rooms);
    this.fpController = new FirstPersonController(this.houseScene.camera, canvas, this.collision);
    this.schemePanel = new SchemePanel({
      topicTabs: document.getElementById('topic-tabs')!,
      topicOptions: document.getElementById('topic-options')!,
      schemeName: document.getElementById('scheme-name')!,
      schemeDesc: document.getElementById('scheme-desc')!,
      schemePros: document.getElementById('scheme-pros')!,
      schemeCons: document.getElementById('scheme-cons')!,
      warnings: document.getElementById('warnings')!,
    });
    this.infoPanel = new InfoPanel({
      onSelectOption: (topicId, optionId, roomId) => {
        void this.handleOptionSelect(topicId, optionId, roomId);
      },
    });
    this.offlineIndicator = new OfflineIndicator('offline-indicator');
    this.crosshair = new Crosshair();
    this.hoverTooltip = new HoverTooltip();
    this.overviewMenu = new OverviewMenu({
      onArchive: (name, reason) => void this.handleArchive(name, reason),
      onRestore: (id) => void this.handleRestore(id),
      onDeleteArchive: (id) => void this.handleDeleteArchive(id),
    });
    this.modeIndicator = document.getElementById('mode-indicator') as HTMLDivElement;
    this.toastEl = document.getElementById('pointer-lock-toast') as HTMLDivElement;

    this.setupEventHandlers();
    this.setupKeyboard();
    this.setupPointerLockEvents();

    this.houseScene.cameraAnimator.setOnComplete((mode) => {
      this.houseScene.setMode(mode);
      if (mode === 'first-person') {
        this.crosshair.show();
      } else {
        this.crosshair.hide();
        this.hoverTooltip.clear();
      }
      this.updateModeIndicator();
    });
  }

  async start(): Promise<void> {
    const response = await fetch('/api/project');
    this.projectData = await response.json();

    await this.houseScene.buildFromCatalog(this.projectData);

    this.topics = new TopicRegistry(this.houseScene).list();
    this.schemePanel.init(this.topics, (topicId: string, optionId: string) => {
      this.stateSync.updateScheme([{ topic: topicId, optionId }]);
    });
    this.infoPanel.setTopics(this.topics);
    this.overviewMenu.setTopics(this.topics);

    this.stateSync.start();

    const scheme = await this.stateSync.fetchScheme();
    if (scheme) {
      this.applyScheme(scheme);
      this.infoPanel.setScheme(scheme);
      this.overviewMenu.setScheme(scheme);
    }

    const decisions = await this.stateSync.fetchDecisions();
    this.overviewMenu.setDecisionLog(decisions);

    await this.refreshOverviewData();

    this.updateModeIndicator();
    this.rafId = requestAnimationFrame(this.renderLoop);
  }

  private setupEventHandlers(): void {
    this.stateSync.onSchemeChange((scheme: CurrentScheme) => {
      this.applyScheme(scheme);
      this.infoPanel.setScheme(scheme);
      this.overviewMenu.setScheme(scheme);
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

    this.houseScene.setOnObjectClick((objectId, type, room) => {
      this.infoPanel.showObject({ objectId, name: room ? this.houseScene.getRoom(room)?.name ?? objectId : objectId, type, room });
      this.stateSync.postViewContext(objectId);
    });
  }

  private setupKeyboard(): void {
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.code === 'KeyV' && !e.repeat) {
        e.preventDefault();
        this.toggleMode();
      }
      if (e.code === 'KeyM' && !e.repeat) {
        e.preventDefault();
        if (this.overviewMenu.isVisible()) {
          this.overviewMenu.hide();
        } else {
          void this.refreshOverviewData();
          this.overviewMenu.show();
        }
      }
      if (e.code === 'Escape') {
        if (this.overviewMenu.isVisible()) {
          this.overviewMenu.hide();
        }
      }
      if (this.houseScene.cameraAnimator.isAnimating()) {
        if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code) || e.code === 'KeyV') {
          this.houseScene.cameraAnimator.interrupt();
        }
      }
    });

    document.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (this.houseScene.mode === 'first-person' && !this.fpController.isLocked) {
        this.fpController.requestLock();
        return;
      }
      if (this.houseScene.mode === 'first-person' && this.fpController.isLocked) {
        this.handleCenterClick();
      }
    });
  }

  private setupPointerLockEvents(): void {
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.houseScene.mode === 'first-person') {
        this.hoverTooltip.clear();
      }
    });

    document.addEventListener('pointerlockerror', () => {
      this.showToast('请允许鼠标锁定以使用第一人称');
    });
  }

  private toggleMode(): void {
    if (this.houseScene.cameraAnimator.isAnimating()) {
      this.houseScene.cameraAnimator.interrupt();
      return;
    }

    if (this.houseScene.mode === 'orbit') {
      this.switchToFirstPerson();
    } else {
      this.switchToOrbit();
    }
  }

  private switchToFirstPerson(): void {
    const spawnX = ENTRY_GARDEN.x;
    const spawnZ = ENTRY_GARDEN.z;
    const fpPos = new THREE.Vector3(spawnX, 1.6, spawnZ);
    const fpDir = new THREE.Vector3(0, 0, 1);

    const camPos = this.houseScene.camera.position;
    if (camPos.y < 3) {
      fpPos.set(camPos.x, 1.6, camPos.z);
    }

    this.houseScene.setMode('first-person');
    this.fpController.enable();
    this.fpController.requestLock();
    this.houseScene.cameraAnimator.transitionToFirstPerson(fpPos, fpDir);
    this.crosshair.show();
    this.updateModeIndicator();
  }

  private switchToOrbit(): void {
    this.fpController.disable();
    this.crosshair.hide();
    this.hoverTooltip.clear();

    const camPos = this.houseScene.camera.position;
    const orbitPos = new THREE.Vector3(camPos.x, ORBIT_DISTANCE, camPos.z + ORBIT_DISTANCE);
    const orbitTarget = new THREE.Vector3(camPos.x, 0, camPos.z);

    this.houseScene.setMode('orbit');
    this.houseScene.cameraAnimator.transitionToOrbit(orbitPos, orbitTarget);
    this.updateModeIndicator();
  }

  private handleCenterClick(): void {
    const target = this.houseScene.raycastFromScreenCenter();
    if (!target) return;

    this.infoPanel.showObject(target);
    this.stateSync.postViewContext(target.objectId);
  }

  private async handleOptionSelect(topicId: string, optionId: string, roomId: string | null): Promise<void> {
    const patch: SelectionPatch = { topic: topicId, optionId, roomId: roomId ?? null };
    await this.stateSync.updateScheme([patch]);

    const scheme = await this.stateSync.fetchScheme();
    if (scheme) {
      this.applyScheme(scheme);
      this.infoPanel.setScheme(scheme);
      this.overviewMenu.setScheme(scheme);
    }

    const decisions = await this.stateSync.fetchDecisions();
    this.overviewMenu.setDecisionLog(decisions);
  }

  private async refreshOverviewData(): Promise<void> {
    const [scheme, decisions, budget, risks, archives] = await Promise.all([
      this.stateSync.fetchScheme(),
      this.stateSync.fetchDecisions(),
      this.stateSync.fetchBudget(),
      this.stateSync.fetchRisks(),
      this.stateSync.fetchArchivedSchemes(),
    ]);
    this.infoPanel.setScheme(scheme);
    this.overviewMenu.setScheme(scheme);
    this.overviewMenu.setDecisionLog(decisions);
    this.overviewMenu.setBudget(budget);
    this.overviewMenu.setRisks(risks);
    this.overviewMenu.setArchivedSchemes(archives);
  }

  private async handleArchive(name: string, reason?: string): Promise<void> {
    await this.stateSync.archiveScheme(name, reason);
    const archives = await this.stateSync.fetchArchivedSchemes();
    this.overviewMenu.setArchivedSchemes(archives);
  }

  private async handleRestore(id: string): Promise<void> {
    await this.stateSync.restoreScheme(id);
    const scheme = await this.stateSync.fetchScheme();
    if (scheme) {
      this.applyScheme(scheme);
      this.infoPanel.setScheme(scheme);
      this.overviewMenu.setScheme(scheme);
    }
    await this.refreshOverviewData();
  }

  private async handleDeleteArchive(id: string): Promise<void> {
    await this.stateSync.deleteArchivedScheme(id);
    const archives = await this.stateSync.fetchArchivedSchemes();
    this.overviewMenu.setArchivedSchemes(archives);
  }

  private applyScheme(scheme: CurrentScheme): void {
    for (const [topicId, selection] of Object.entries(scheme.selections)) {
      const effective = selection.default;
      if (effective) {
        this.houseScene.setSelection(topicId, effective);
        this.schemePanel.setActiveOption(topicId, effective, []);
      }
    }
  }

  private updateModeIndicator(): void {
    if (this.houseScene.mode === 'orbit') {
      this.modeIndicator.textContent = '轨道模式 · 按 V 切换第一人称';
    } else {
      this.modeIndicator.textContent = '第一人称 · WASD 移动 · 按 V 切换轨道 · 按 M 总览';
    }
  }

  private showToast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.style.display = 'block';
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.style.display = 'none';
    }, 3000);
  }

  private renderLoop = (time: number) => {
    const dt = this.lastTime === 0 ? 0.016 : Math.min((time - this.lastTime) / 1000, 0.1);
    this.lastTime = time;

    this.houseScene.render();

    if (this.houseScene.mode === 'first-person' && !this.houseScene.cameraAnimator.isAnimating()) {
      this.fpController.update(dt);
      const target = this.houseScene.raycastFromScreenCenter();
      this.hoverTooltip.update(target);
    }

    this.rafId = requestAnimationFrame(this.renderLoop);
  };

  dispose(): void {
    if (this.rafId !== undefined) {
      cancelAnimationFrame(this.rafId);
    }
    this.fpController.dispose();
    this.stateSync.dispose();
  }
}
