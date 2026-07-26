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
import { extractCollisionWalls } from './scene/collision-utils.js';
import { TopicRegistry } from './topics/TopicRegistry.js';
import { AnalysisTools } from './render/analysis/AnalysisTools.js';
import { AnnotationRenderer } from './render/annotations/AnnotationRenderer.js';
import type { CurrentScheme, DecisionLogEntry, Topic, SelectionPatch } from '@shared/types';

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
  private compareActive = false;
  private analysisTools: AnalysisTools;
  private compareShowing = false;
  private annotationRenderer?: AnnotationRenderer;
  private annotationGroupVisible = true;

  constructor(canvas: HTMLCanvasElement) {
    this.stateSync = new StateSync();
    this.houseScene = new HouseScene(canvas);
    this.collision = new CollisionDetector();
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
    this.analysisTools = new AnalysisTools(
      this.houseScene.scene,
      this.houseScene.camera,
      document.getElementById('app')!,
    );
    this.overviewMenu = new OverviewMenu({
      onArchive: (name, reason) => void this.handleArchive(name, reason),
      onRestore: (id) => void this.handleRestore(id),
      onDeleteArchive: (id) => void this.handleDeleteArchive(id),
      onLayoutChange: (layoutName) => void this.handleLayoutChange(layoutName),
      onCompare: (archiveId) => void this.handleCompare(archiveId),
      onClearCompare: () => this.handleClearCompare(),
    });
    this.modeIndicator = document.getElementById('mode-indicator') as HTMLDivElement;
    this.toastEl = document.getElementById('pointer-lock-toast') as HTMLDivElement;

    this.setupEventHandlers();
    this.setupKeyboard();
    this.setupPointerLockEvents();
    this.setupMeasurementHandlers(canvas);

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
    this.collision.setWalls(this.extractWalls(this.projectData?.house?.sceneElements));

    await this.houseScene.buildFromCatalog(this.projectData);
    this.annotationRenderer = new AnnotationRenderer(
      this.houseScene.scene,
      this.houseScene.camera,
    );
    await this.annotationRenderer.load();
    this.analysisTools.setFurnitureMeshes(this.houseScene.getFurnitureMeshes());
    this.analysisTools.setRooms(this.projectData?.house?.rooms ?? []);
    this.analysisTools.checkFurnitureCollisions();

    this.topics = new TopicRegistry(this.houseScene).list();
    this.schemePanel.init(this.topics, (topicId: string, optionId: string) => {
      this.stateSync.updateScheme([{ topic: topicId, optionId }]);
    });
    this.infoPanel.setTopics(this.topics);
    this.overviewMenu.setTopics(this.topics);

    try {
      const layoutsRes = await fetch('/api/layouts');
      const layoutsData = await layoutsRes.json();
      this.overviewMenu.setLayouts(layoutsData.layouts);
      this.overviewMenu.setActiveLayout(this.projectData.house.layoutSource ?? 'model-geometry');
    } catch (e) {
      // layouts not critical
    }

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

  async captureFloorPlan(): Promise<string> {
    return this.houseScene.captureFloorPlan();
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

    this.stateSync.onConfigError((errors) => {
      if (errors.length > 0) {
        this.showConfigErrorBanner(errors);
      } else {
        this.hideConfigErrorBanner();
      }
    });

    this.houseScene.setOnObjectClick((target) => {
      if (this.analysisTools.measurement.active) return;
      this.infoPanel.showObject(target);
      this.stateSync.postViewContext(target.objectId);
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
      if (e.code === 'KeyW' && !e.repeat) {
        e.preventDefault();
        this.analysisTools.toggleSeeThrough();
        this.updateModeIndicator();
      }
      if (e.code === 'KeyP' && !e.repeat) {
        e.preventDefault();
        this.annotationGroupVisible = !this.annotationGroupVisible;
        this.annotationRenderer?.setVisible('all', this.annotationGroupVisible);
      }
      if (e.code === 'KeyL' && !e.repeat) {
        e.preventDefault();
        this.analysisTools.toggleMeasurement();
        if (this.houseScene.mode === 'orbit') {
          this.houseScene.controls.enabled = !this.analysisTools.measurement.active;
        }
        this.updateModeIndicator();
        this.updateCrosshairStyle();
      }
      if (e.code === 'Tab' && this.compareActive) {
        e.preventDefault();
        this.compareShowing = !this.compareShowing;
        if (this.compareShowing) {
          this.houseScene.applyCompareScheme();
        } else {
          this.stateSync.fetchScheme().then((s) => { if (s) this.applyScheme(s); });
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

  private savedOrbitPos: THREE.Vector3 | null = null;
  private savedOrbitTarget: THREE.Vector3 | null = null;

  private switchToFirstPerson(): void {
    const rooms = (this.projectData?.house?.rooms ?? []) as Array<{ id: string; x: number; z: number; width: number; depth: number }>;
    const spawnRoom = rooms.find((r) => r.id === 'living_dining') ?? rooms.find((r) => r.id === 'entry_garden');
    const spawnX = spawnRoom?.x ?? 7.4;
    const spawnZ = spawnRoom?.z ?? 3.65;
    const fpPos = new THREE.Vector3(spawnX, 1.7, spawnZ);
    const fpDir = new THREE.Vector3(0, 0, 1);

    const camPos = this.houseScene.camera.position;
    const insideRoom = camPos.y < 3 && rooms.some(r => {
      const hw = r.width / 2, hd = r.depth / 2;
      return camPos.x >= r.x - hw && camPos.x <= r.x + hw &&
             camPos.z >= r.z - hd && camPos.z <= r.z + hd;
    });
    if (insideRoom) {
      fpPos.set(camPos.x, 1.7, camPos.z);
    }

    this.savedOrbitPos = this.houseScene.camera.position.clone();
    this.savedOrbitTarget = this.houseScene.controls.target.clone();

    this.fpController.enable();
    this.fpController.requestLock();
    this.houseScene.cameraAnimator.transitionToFirstPerson(fpPos, fpDir);
    this.crosshair.show();
    this.updateModeIndicator();
    this.updateCrosshairStyle();
  }

  private switchToOrbit(): void {
    this.fpController.disable();
    this.crosshair.hide();
    this.hoverTooltip.clear();

    const orbitPos = this.savedOrbitPos ?? new THREE.Vector3(7.4, 14, 19.2);
    const orbitTarget = this.savedOrbitTarget ?? new THREE.Vector3(7.4, 0, 3.65);

    this.houseScene.cameraAnimator.transitionToOrbit(orbitPos, orbitTarget);
    this.updateModeIndicator();
  }

  private handleCenterClick(): void {
    if (this.analysisTools.measurement.active) {
      this.analysisTools.measurement.onFirstPersonAction();
      return;
    }
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

  private async handleLayoutChange(layoutName: string): Promise<void> {
    const response = await fetch(`/api/project?layout=${layoutName}`);
    this.projectData = await response.json();
    this.collision.setWalls(this.extractWalls(this.projectData?.house?.sceneElements));
    await this.houseScene.buildFromCatalog(this.projectData);
    this.annotationRenderer?.clear();
    this.annotationRenderer = new AnnotationRenderer(
      this.houseScene.scene,
      this.houseScene.camera,
    );
    await this.annotationRenderer.load();
    this.analysisTools.setFurnitureMeshes(this.houseScene.getFurnitureMeshes());
    this.analysisTools.setRooms(this.projectData?.house?.rooms ?? []);
    this.analysisTools.checkFurnitureCollisions();
    const scheme = await this.stateSync.fetchScheme();
    if (scheme) this.applyScheme(scheme);
  }

  private async handleCompare(archiveId: string): Promise<void> {
    const response = await fetch(`/api/schemes/compare?other=${archiveId}`);
    const data = await response.json();
    this.schemePanel.initCompare(archiveId, data.diff);
    this.houseScene.setCompareScheme(data.compare.scheme);
    this.compareActive = true;
  }

  private handleClearCompare(): void {
    this.schemePanel.clearCompare();
    this.compareActive = false;
    this.compareShowing = false;
    this.stateSync.fetchScheme().then((s) => { if (s) this.applyScheme(s); });
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
    const measSuffix = this.analysisTools?.measurement.active ? ' · 📏 测量开启' : '';
    const seeThroughSuffix = this.analysisTools?.isSeeThrough() ? ' · 👁 透视' : '';
    if (this.houseScene.mode === 'orbit') {
      this.modeIndicator.textContent = `轨道模式 · 按 V 切换第一人称${measSuffix}${seeThroughSuffix}`;
    } else {
      this.modeIndicator.textContent = `第一人称 · WASD 移动 · 按 V 切换轨道 · 按 M 总览${measSuffix}${seeThroughSuffix}`;
    }
  }

  private updateCrosshairStyle(): void {
    const isMeasuring = this.analysisTools?.measurement.active;
    if (this.houseScene.mode === 'first-person') {
      this.crosshair.setStyle(isMeasuring ? 'measure' : 'default');
    }
  }

  private setupMeasurementHandlers(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', (e: PointerEvent) => {
      if (this.houseScene.mode === 'orbit' && this.analysisTools.measurement.active) {
        this.analysisTools.measurement.onPointerClick(e);
      }
    });
  }

  private showToast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.style.display = 'block';
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.style.display = 'none';
    }, 3000);
  }

  private showConfigErrorBanner(errors: Array<{ path: string; error: string }>): void {
    let banner = document.getElementById('config-error-banner') as HTMLDivElement | null;
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'config-error-banner';
      document.body.prepend(banner);
    }
    banner.textContent = `配置文件加载失败：${errors.map((e) => `${e.path} — ${e.error}`).join('; ')}`;
    banner.style.display = 'block';
  }

  private hideConfigErrorBanner(): void {
    const banner = document.getElementById('config-error-banner') as HTMLDivElement | null;
    if (banner) banner.style.display = 'none';
  }

  private extractWalls(sceneElements: any[] | undefined): import('@shared/types').WallSegment[] {
    return extractCollisionWalls(sceneElements);
  }

  private renderLoop = (time: number) => {
    const dt = this.lastTime === 0 ? 0.016 : Math.min((time - this.lastTime) / 1000, 0.1);
    this.lastTime = time;

    this.houseScene.render();
    this.annotationRenderer?.updateLabels();
    this.analysisTools.updatePulse();

    if (this.houseScene.mode === 'first-person' && !this.houseScene.cameraAnimator.isAnimating()) {
      this.fpController.update(dt);
      const target = this.houseScene.raycastFromScreenCenter({ hoverableOnly: true });
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
