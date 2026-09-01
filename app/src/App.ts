import * as THREE from 'three';
import { StateSync } from './state/StateSync.js';
import { HouseScene } from './render/HouseScene.js';
import { SchemePanel } from './ui/SchemePanel.js';
import { InfoPanel } from './ui/InfoPanel.js';
import { OfflineIndicator } from './ui/OfflineIndicator.js';
import { Crosshair } from './ui/Crosshair.js';
import { SensitivitySlider } from './ui/SensitivitySlider.js';
import { HoverTooltip } from './ui/HoverTooltip.js';
import { OverviewMenu } from './ui/OverviewMenu.js';
import { CollisionDetector } from './scene/CollisionDetector.js';
import { FirstPersonController } from './scene/FirstPersonController.js';
import { extractCollisionWalls } from './scene/collision-utils.js';
import { resolveSpawnRoom } from './scene/spawn-utils.js';
import { shouldToggleSeeThrough, shouldInterruptCameraAnimation, shouldToggleInteriorLights } from './scene/mode-key-policy.js';
import { TopicRegistry } from './topics/TopicRegistry.js';
import { AnalysisTools } from './render/analysis/AnalysisTools.js';
import { AnnotationRenderer } from './render/annotations/AnnotationRenderer.js';
import { CommandPalette } from './ui/CommandPalette.js';
import { TopDownButton } from './ui/TopDownButton.js';
import { HvacCoordinationButton, type HvacCoordinationButtonState } from './ui/HvacCoordinationButton.js';
import { FurniturePanel } from './ui/FurniturePanel.js';
import { PlacementPanel } from './ui/PlacementPanel.js';
import { SunlightSystem } from './render/SunlightSystem.js';
import { InteriorLightingSystem } from './render/InteriorLightingSystem.js';
import { SunlightPanel } from './ui/SunlightPanel.js';
import { SunlightButton } from './ui/SunlightButton.js';
import { DaylightHeatmap } from './render/analysis/DaylightHeatmap.js';
import { HumidityOverlay } from './render/analysis/HumidityOverlay.js';
import { HumidityButton } from './ui/HumidityButton.js';
import { renderMepLintSummary } from './ui/MepLintSummary.js';
import { isInHuinanWindow } from '@shared/humidity-model';
import { exportObjectTreeToGlb } from './render/export-gltf.js';
import './ui/keybindings.js';
import { parseProjectRenderFactsProjection } from '@shared/project-render-facts-schema';
import { buildHvacBuilderSources } from '@shared/render/HvacBuilder';
import type { CaptureOptions, RoomAuditCaptureOptions } from '@shared/types';
import type { CurrentScheme, CurtainPresentationState, CurtainState, DecisionLogEntry, ProjectRenderFacts, ProjectRenderFactsProjection, Topic, SelectionPatch, ElectricalTopology, ElectricalCircuitPurpose } from '@shared/types';
import type { MepCoordination } from '@shared/mep-hvac-coordination-schema';
import type { MepLintResult } from '@shared/mep-hvac-lint';

const ORBIT_DISTANCE = 15;

export class App {
  private stateSync: StateSync;
  private houseScene: HouseScene;
  private schemePanel: SchemePanel;
  private infoPanel: InfoPanel;
  private offlineIndicator: OfflineIndicator;
  private crosshair: Crosshair;
  private sensitivitySlider: SensitivitySlider;
  private hoverTooltip: HoverTooltip;
  private overviewMenu: OverviewMenu;
  private topDownButton: TopDownButton | null = null;
  private hvacCoordinationButton: HvacCoordinationButton | null = null;
  private hvacCoordinationState: HvacCoordinationButtonState = 'loading';
  private hvacCoordinationVisible = false;
  private mepCoordinationVisible = false;
  private mepCoordinationReady = false;
  private mepLintResult: MepLintResult | null = null;
  private electricalTopology: (ElectricalTopology & { lint?: { counts: { circuits: number; uncoveredPoints: number; warnings: number } } }) | null = null;
  private electricalTopologyVisible = false;
  private mepOverviewVisible = false;
  private collision: CollisionDetector;
  private fpController: FirstPersonController;
  private projectData: any = null;
  private renderFacts?: ProjectRenderFacts;
  private topics: Topic[] = [];
  private rafId?: number;
  private renderQueued = false;
  private disposed = false;
  private lastTime = 0;
  private modeIndicator: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private toastTimer?: number;
  private compareActive = false;
  private analysisTools: AnalysisTools;
  private compareShowing = false;
  private annotationRenderer?: AnnotationRenderer;
  private annotationGroupVisible = true;
  private commandPalette = new CommandPalette();
  private furniturePanel = new FurniturePanel();
  private furniturePlaceMode: { type: string } | null = null;
  private placementPanel = new PlacementPanel();
  private infrastructurePlaceMode: { category: string; type: string } | null = null;
  private sunlightPanel = new SunlightPanel();
  private sunlightSystem: SunlightSystem | null = null;
  private interiorLighting: InteriorLightingSystem | null = null;
  private sunlightButton: SunlightButton | null = null;
  private daylightHeatmap: DaylightHeatmap | null = null;
  private humidityOverlay: HumidityOverlay | null = null;
  private humidityButton: HumidityButton | null = null;
  private curtainPresentationState: CurtainPresentationState = { default: 'open', roomOverrides: {}, updatedAt: '' };
  private readonly hvacCoordinationApi = (visible: boolean) => this.setHvacCoordinationVisible(Boolean(visible));
  private readyState: 'loading' | 'ready' | 'failed' = 'loading';
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: unknown) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.stateSync = new StateSync();
    this.houseScene = new HouseScene(canvas);
    this.collision = new CollisionDetector();
    this.fpController = new FirstPersonController(this.houseScene.camera, canvas, this.collision);
    this.houseScene.setOnRenderRequested(() => this.requestRender());
    this.fpController.setOnRenderRequested(() => this.requestRender());
    (window as Window & { setHvacCoordinationVisible?: (visible: boolean) => void }).setHvacCoordinationVisible = this.hvacCoordinationApi;
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
      onCurtainStateChange: (state, roomId) => void this.handleCurtainStateChange(state, roomId),
    });
    this.offlineIndicator = new OfflineIndicator('offline-indicator');
    this.crosshair = new Crosshair();
    this.sensitivitySlider = new SensitivitySlider();
    this.sensitivitySlider.onChange((s) => this.fpController.setSensitivity(s));
    this.fpController.setSensitivity(this.sensitivitySlider.getSensitivity());
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
      onCurtainStateChange: (state) => void this.handleCurtainStateChange(state),
    });
    this.modeIndicator = document.getElementById('mode-indicator') as HTMLDivElement;
    this.toastEl = document.getElementById('pointer-lock-toast') as HTMLDivElement;

    this.setupFurniturePanel();
    this.setupPlacementPanel();
    this.setupExportButton();
    this.setupTopDownButton();
    this.setupHvacCoordinationButton();
    this.setupMepCoordinationButton();
    this.setupElectricalTopologyButton();
    const mepLintSummary = document.getElementById('mep-lint-summary');
    if (mepLintSummary) renderMepLintSummary(mepLintSummary, this.mepLintResult);
    this.updateMepLintSummaryVisibility();
    this.setupDragHandlers();
    this.setupEventHandlers();
    this.setupKeyboard();
    this.setupPointerLockEvents();
    this.setupMeasurementHandlers(canvas);

    this.houseScene.cameraAnimator.setOnComplete((mode) => {
      this.houseScene.setMode(mode);
      if (mode === 'first-person') {
        this.fpController.syncFromCamera();
        this.crosshair.show();
        this.sensitivitySlider.show();
      } else {
        this.crosshair.hide();
        this.sensitivitySlider.hide();
        this.hoverTooltip.clear();
      }
      this.updateModeIndicator();
    });
  }

  isReady(): boolean {
    return this.readyState === 'ready';
  }

  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  async start(): Promise<void> {
    this.readyState = 'loading';
    try {
      const response = await fetch('/api/project');
    this.projectData = await response.json();
    this.collision.setWalls(this.extractWalls(this.projectData?.house?.sceneElements));

    await this.houseScene.buildFromCatalog(this.projectData);
    this.annotationRenderer = new AnnotationRenderer(
      this.houseScene.scene,
      this.houseScene.camera,
      this.houseScene.getViewOnlyRoot(),
    );
    await this.refreshInfrastructure();
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

    const presentationState = await this.stateSync.getPresentationState();
    this.applyCurtainPresentationState(presentationState);

    const decisions = await this.stateSync.fetchDecisions();
    this.overviewMenu.setDecisionLog(decisions);

    await this.refreshOverviewData();

    this.setupSunlight();
    this.setupHumidity();
    this.updateModeIndicator();
    this.requestRender();
    this.readyState = 'ready';
    this.resolveReady();
    } catch (error) {
      this.readyState = 'failed';
      this.rejectReady(error);
      throw error;
    }
  }

  async captureFloorPlan(options: CaptureOptions = {}): Promise<string> {
    await this.whenReady();
    return this.houseScene.captureFloorPlan(options);
  }

  async captureRoomAudit(options: RoomAuditCaptureOptions): Promise<string> {
    await this.whenReady();
    return this.houseScene.captureRoomAudit(options);
  }

  async exportGlbDataUrl(): Promise<string> {
    const { blob } = await this.exportGlb();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return 'data:model/gltf-binary;base64,' + btoa(bin);
  }

  private async exportGlb(): Promise<{ blob: Blob; hvac: ReturnType<HouseScene['getHvacExportStatus']> }> {
    const hvac = this.houseScene.getHvacExportStatus();
    if (hvac.required && !hvac.ready) {
      throw new Error(`GLB 导出已阻止：HVAC 缺失 ${hvac.missing.join(', ')}`);
    }
    return { blob: await exportObjectTreeToGlb(this.houseScene.getExportRoot()), hvac };
  }

  private setupSunlight(): void {
    const env = this.projectData?.environment;
    if (!env) return;

    const rooms: Array<{ x: number; z: number }> = this.projectData?.house?.rooms ?? [];
    const center = rooms.length > 0
      ? {
          x: rooms.reduce((s, r) => s + r.x, 0) / rooms.length,
          z: rooms.reduce((s, r) => s + r.z, 0) / rooms.length,
        }
      : { x: 7.4, z: 3.65 };

    this.sunlightSystem = new SunlightSystem(
      this.houseScene.scene,
      this.houseScene.getEnvironmentManager(),
      { latitude: env.location.latitude, longitude: env.location.longitude, timezone: env.location.timezone },
      center
    );

    this.sunlightPanel.onHourChange((hour) => {
      this.sunlightSystem?.setHour(hour);
      this.requestRender();
    });
    this.sunlightPanel.onPlayToggle(() => {
      const playing = this.sunlightSystem?.togglePlay() ?? false;
      this.sunlightPanel.setPlaying(playing);
      this.requestRender();
    });
    this.sunlightSystem.setPlayingListener((playing) => this.sunlightPanel.setPlaying(playing));
    this.sunlightSystem.setSolarChangeListener(() => {
      const st = this.houseScene.getEnvironmentManager().getLightingState();
      this.interiorLighting?.syncSolar({ isNight: st.isNight, altitudeDeg: st.altitudeDeg });
      this.requestRender();
    });

    this.daylightHeatmap = new DaylightHeatmap(this.houseScene);
    this.sunlightPanel.onHeatmapToggle(() => {
      void this.daylightHeatmap?.toggle();
      this.requestRender();
    });

    this.sunlightButton = new SunlightButton({
      onToggle: () => {
        this.sunlightPanel.toggle();
        if (this.sunlightPanel.isVisible()) {
          this.sunlightSystem?.showTrajectory();
        } else {
          this.sunlightSystem?.hideTrajectory();
        }
        this.sunlightButton?.sync();
      },
      getActive: () => this.sunlightPanel.isVisible(),
    });
  }

  private setupHumidity(): void {
    this.humidityOverlay = new HumidityOverlay(this.houseScene);

    this.humidityButton = new HumidityButton({
      onToggle: () => {
        void this.humidityOverlay?.toggle().then(() => {
          this.humidityButton?.sync();
          this.requestRender();
        });
      },
      getActive: () => this.humidityOverlay?.isActive() ?? false,
    });

    const huinanWindow = this.projectData?.environment?.climate?.huinan_window as
      | { start: string; end: string }
      | undefined;
    this.sunlightPanel.onDateChange((month, day) => {
      this.sunlightSystem?.setDate(month, day);
      const date = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      void this.daylightHeatmap?.refresh(date);
      void this.humidityOverlay?.refresh(date);
      if (huinanWindow) {
        this.sunlightPanel.setHuinanHint(isInHuinanWindow({ month, day }, huinanWindow));
      }
      this.requestRender();
    });
  }

  private setupFurniturePanel(): void {
    this.furniturePanel.onSelect((type) => {
      this.furniturePanel.hide();
      this.furniturePlaceMode = { type };
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      const pos = this.houseScene.getGroundPosition(centerX, centerY);
      if (pos) {
        this.houseScene.showGhost(pos.x, pos.z, 0, type);
        this.requestRender();
      }
    });
  }

  private setupTopDownButton(): void {
    this.topDownButton = new TopDownButton({
      onToggle: () => {
        this.houseScene.toggleTopDown();
        this.topDownButton?.sync();
        this.requestRender();
      },
      getActive: () => this.houseScene.isTopDown(),
    });
  }

  private setupHvacCoordinationButton(): void {
    this.hvacCoordinationButton = new HvacCoordinationButton({
      onToggle: () => this.setHvacCoordinationVisible(!this.hvacCoordinationVisible),
      getState: () => this.hvacCoordinationState,
      getActive: () => this.hvacCoordinationVisible,
    });
  }

  private setHvacCoordinationVisible(visible: boolean): void {
    this.hvacCoordinationVisible = this.hvacCoordinationState === 'ready' && visible;
    this.houseScene.setHvacCoordinationVisible(this.hvacCoordinationVisible);
    this.hvacCoordinationButton?.sync();
    this.requestRender();
  }

  private setHvacCoordinationState(state: HvacCoordinationButtonState): void {
    this.hvacCoordinationState = state;
    if (state !== 'ready') {
      this.hvacCoordinationVisible = false;
      this.houseScene.setHvacCoordinationVisible(false);
    }
    this.hvacCoordinationButton?.sync();
  }

  private setupMepCoordinationButton(): void {
    const overviewButton = document.getElementById('mep-overview-btn') as HTMLButtonElement | null;
    overviewButton?.addEventListener('click', () => {
      this.mepOverviewVisible = !this.mepOverviewVisible;
      this.houseScene.setMepOverviewVisible(this.mepOverviewVisible, this.hvacCoordinationState === 'ready' || this.mepCoordinationReady);
      if (this.electricalTopology) {
        this.houseScene.setElectricalTopologyVisible(this.mepOverviewVisible || this.electricalTopologyVisible);
        this.syncElectricalTopologyButton();
      }
      overviewButton.classList.toggle('active', this.mepOverviewVisible);
      overviewButton.textContent = this.mepOverviewVisible ? '退出机电总览' : '机电总览';
      this.requestRender();
    });
    const button = document.getElementById('mep-coordination-btn') as HTMLButtonElement | null;
    if (!button) return;
    button.addEventListener('click', () => {
      this.mepCoordinationVisible = this.mepCoordinationReady && !this.mepCoordinationVisible;
      this.houseScene.setMepCoordinationVisible(this.mepCoordinationVisible);
      const controls = document.getElementById('mep-coordination-controls');
      if (controls) controls.hidden = !this.mepCoordinationVisible;
      button.classList.toggle('active', this.mepCoordinationVisible);
      button.textContent = this.mepCoordinationVisible ? 'MEP · 路线' : 'MEP 协调';
      this.updateMepLintSummaryVisibility();
      this.requestRender();
    });
    document.getElementById('mep-bends-toggle')?.addEventListener('change', (event) => {
      this.houseScene.setMepBendsVisible((event.target as HTMLInputElement).checked);
    });
  }

  private setupElectricalTopologyButton(): void {
    const button = document.getElementById('electrical-topology-btn') as HTMLButtonElement | null;
    if (!button) return;
    button.addEventListener('click', () => {
      if (!this.electricalTopology) return;
      this.electricalTopologyVisible = !this.electricalTopologyVisible;
      this.houseScene.setElectricalTopologyVisible(this.mepOverviewVisible || this.electricalTopologyVisible);
      this.syncElectricalTopologyButton();
      this.requestRender();
    });
    this.syncElectricalTopologyButton();
  }

  private syncElectricalTopologyButton(): void {
    const button = document.getElementById('electrical-topology-btn') as HTMLButtonElement | null;
    const controls = document.getElementById('electrical-topology-controls');
    if (!button) return;
    const ready = this.electricalTopology !== null;
    button.disabled = !ready;
    const effectivelyVisible = ready && (this.electricalTopologyVisible || this.mepOverviewVisible);
    button.classList.toggle('active', effectivelyVisible);
    button.textContent = !ready
      ? '电气回路归属：未就绪'
      : effectivelyVisible ? '电气回路归属 · 开' : '电气回路归属';
    if (controls) controls.hidden = !effectivelyVisible;
  }

  private setupElectricalTopologyControls(topology: ElectricalTopology): void {
    const controls = document.getElementById('electrical-topology-controls');
    const toggles = document.getElementById('electrical-topology-purpose-toggles');
    if (!controls || !toggles) return;
    toggles.replaceChildren();
    const labels: Record<ElectricalCircuitPurpose, string> = { lighting: '照明', hvac_power: '空调电源', dedicated_load: '专用负载', ordinary_power: '普通功能电源' };
    for (const purpose of Object.keys(labels) as ElectricalCircuitPurpose[]) {
      const label = document.createElement('label');
      const input = document.createElement('input'); input.type = 'checkbox'; input.checked = true;
      input.addEventListener('change', () => this.houseScene.setElectricalTopologyPurposeVisible(purpose, input.checked));
      label.append(input, ` ${labels[purpose]}`); toggles.append(label);
    }
    const summary = document.getElementById('electrical-topology-render-summary');
    const counts = this.houseScene.getElectricalTopologySummary();
    if (summary) summary.textContent = `面板 ${counts.panels} · 回路 ${counts.circuits} · 负载归属 ${counts.edges}${counts.skippedEdges ? ` · 跳过 ${counts.skippedEdges}` : ''}`;
    const legend = document.getElementById('electrical-topology-legend');
    if (legend) legend.textContent = '颜色：照明/空调电源/专用负载/普通功能电源；状态：已确认关系/提议关系/待确认关系';
    controls.hidden = true;
  }

  private setupMepLayerControls(config: MepCoordination): void {
    const container = document.getElementById('mep-layer-toggles');
    if (!container) return;
    container.replaceChildren();
    for (const [layer, definition] of Object.entries(config.layers)) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = true;
      const swatch = document.createElement('span');
      swatch.className = 'mep-layer-swatch';
      swatch.style.backgroundColor = definition.color;
      input.addEventListener('change', () => this.houseScene.setMepLayerVisible(layer as MepCoordination['routes'][number]['layer'], input.checked));
      label.append(input, swatch, ` ${definition.label}`);
      container.append(label);
    }
    const summary = document.getElementById('mep-route-summary');
    if (summary) {
      const counts = this.houseScene.getMepStatusSummary();
      summary.textContent = `路线 ${counts.confirmed + counts.inferred + counts.pending + counts.requirement} 条：已确认 ${counts.confirmed} · 推断 ${counts.inferred} · 待确认 ${counts.pending} · 要求/候选 ${counts.requirement}`;
    }
    const legend = document.getElementById('mep-status-legend');
    if (legend) {
      legend.replaceChildren();
      const entries = [
        ['confirmed', '━ 已确认 · 实线实体'],
        ['inferred', '┄ 推断 · 虚线/标记'],
        ['pending', '┄ 待确认 · 低透明虚线'],
        ['requirement', '┄ 要求/候选 · 线框虚线'],
      ] as const;
      for (const [status, label] of entries) {
        const item = document.createElement('span');
        item.className = `mep-status ${status}`;
        item.textContent = label;
        legend.append(item);
      }
    }
  }

  private updateMepLintSummaryVisibility(): void {
    const summary = document.getElementById('mep-lint-summary');
    if (summary) summary.hidden = !(this.mepOverviewVisible || this.mepCoordinationVisible);
  }

  private setMepCoordinationState(ready: boolean): void {
    this.mepCoordinationReady = ready;
    const button = document.getElementById('mep-coordination-btn') as HTMLButtonElement | null;
    const controls = document.getElementById('mep-coordination-controls');
    if (!button) return;
    if (!ready) {
      this.mepCoordinationVisible = false;
      this.houseScene.setMepCoordinationVisible(false);
      if (controls) controls.hidden = true;
      this.mepLintResult = null;
      const mepLintSummary = document.getElementById('mep-lint-summary');
      if (mepLintSummary) renderMepLintSummary(mepLintSummary, this.mepLintResult);
    }
    button.disabled = !ready;
    this.updateMepLintSummaryVisibility();
    button.textContent = ready ? 'MEP 协调' : 'MEP 未就绪';
    button.classList.toggle('active', this.mepCoordinationVisible);
  }

  private setupExportButton(): void {
    const btn = document.getElementById('export-glb-btn');
    btn?.addEventListener('click', async () => {
      try {
        const { blob, hvac } = await this.exportGlb();
        const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `house-${stamp}.glb`;
        a.click();
        URL.revokeObjectURL(url);
        if (hvac.required) {
          const outdoor = hvac.included.filter((id) => id.includes(':anchor:') && id.includes('outdoor')).length;
          const indoor = hvac.included.filter((id) => id.includes(':anchor:') && !id.includes('outdoor')).length;
          this.showToast(`GLB 已导出：HVAC outdoor ${outdoor}/indoor ${indoor}/terminal ${hvac.terminalCount}；协调 routes 已排除`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'GLB 导出失败';
        console.error(message, error);
        this.showToast(message);
      }
    });
  }

  private exitFurniturePlaceMode(): void {
    this.furniturePlaceMode = null;
    this.houseScene.hideGhost();
  }

  private exitInfrastructurePlaceMode(): void {
    this.infrastructurePlaceMode = null;
    this.houseScene.hideGhost();
  }

  private setupPlacementPanel(): void {
    this.placementPanel.onSelect((category, type) => {
      this.placementPanel.hide();
      this.infrastructurePlaceMode = { category, type };
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      const pos = this.houseScene.getGroundPosition(centerX, centerY);
      if (pos) {
        this.houseScene.showGhost(pos.x, pos.z, 0, 'dining_chair');
        this.requestRender();
      }
    });
  }

  private setupDragHandlers(): void {
    this.fpController.setDragHandlers({
      onMove: (dx, dz) => {
        if (!this.fpController.isDragMode()) return;
        const rot = this.fpController.getDragRotation();
        const camera = this.houseScene.camera;
        const forward = new THREE.Vector3(0, 0, -1);
        forward.applyQuaternion(camera.quaternion);
        forward.y = 0;
        forward.normalize();
        const right = new THREE.Vector3(1, 0, 0);
        right.applyQuaternion(camera.quaternion);
        right.y = 0;
        right.normalize();
        const moveScale = 0.02;
        const mx = (forward.x * (-dz) + right.x * dx) * moveScale;
        const mz = (forward.z * (-dz) + right.z * dx) * moveScale;
        const pos = this.houseScene.getGhostPosition();
        if (pos) {
          const newX = pos.x + mx;
          const newZ = pos.z + mz;
          this.houseScene.updateGhostPosition(newX, newZ, rot);
          this.requestRender();
        }
      },
      onEnd: async (x, z, rotation) => {
        const objectId = this.fpController.getDraggedObjectId();
        if (!objectId) return;
        if (objectId.startsWith('electrical:') || objectId.startsWith('plumbing:')) {
          const isElectrical = objectId.startsWith('electrical:');
          const id = objectId.split(':').slice(1).join(':');
          const apiUrl = isElectrical ? '/api/electrical' : '/api/plumbing';
          try {
            await fetch(`${apiUrl}/${id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ x, z }),
            });
            await this.refreshInfrastructure();
          } catch (err) {
            console.error('Failed to update annotation', err);
          }
        } else if (objectId.startsWith('furniture:')) {
          const parts = objectId.split(':');
          if (parts.length >= 4) {
            const room = parts[1];
            const index = parseInt(parts[3], 10);
            if (!isNaN(index)) {
              try {
                await fetch(`/api/furnishings/${room}/${index}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ x, z, rotation }),
                });
              } catch (err) {
                console.error('Failed to update furnishing', err);
              }
            }
          }
        }
        this.houseScene.hideGhost();
      },
    });
  }

  private setupEventHandlers(): void {
    this.stateSync.onSchemeChange((scheme: CurrentScheme) => {
      this.applyScheme(scheme);
      this.infoPanel.setScheme(scheme);
      this.overviewMenu.setScheme(scheme);
      this.requestRender();
    });

    this.stateSync.onPresentationStateChange((state) => this.applyCurtainPresentationState(state));

    this.stateSync.onVisualCommand((command) => {
      if (command.type === 'set_camera_target') {
        const payload = command.payload as { targetId: string };
        this.houseScene.setCameraTarget(payload.targetId);
      } else if (command.type === 'highlight_object') {
        const payload = command.payload as { objectId: string };
        this.houseScene.highlightObject(payload.objectId);
        this.requestRender();
      } else if (command.type === 'set_curtain_state') {
        const payload = command.payload as { roomId?: string; state: CurtainState };
        if (payload.roomId) this.houseScene.setRoomCurtainState(payload.roomId, payload.state);
        else this.houseScene.setAllCurtainStates(payload.state);
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

    this.stateSync.onBudgetChange((budget) => {
      this.schemePanel.updateBudget(budget);
    });

    this.houseScene.setOnObjectClick((target) => {
      if (this.analysisTools.measurement.active) return;
      if (target.type === 'sliding_door') {
        this.toggleSlidingDoor(target.objectId.slice('sliding_door:'.length));
        return;
      }
      this.infoPanel.showObject(target);
      if (target.type === 'mep_coordination_route' && target.mep?.routeId) {
        this.houseScene.highlightMepRoute(String(target.mep.routeId));
      }
      if (target.type.startsWith('electrical_topology_')) {
        const circuitId = target.electricalTopology?.circuitIds[0];
        if (circuitId) this.houseScene.highlightElectricalCircuit(circuitId);
      }
      this.stateSync.postViewContext(target.objectId);
    });
  }

  private setupKeyboard(): void {
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      this.requestRender();
      // ── Special cases that need extra logic ──
      if (e.code === 'Escape') {
        if (this.overviewMenu.isVisible()) { this.overviewMenu.hide(); return; }
        if (this.commandPalette.isVisible()) { this.commandPalette.hide(); return; }
        if (this.placementPanel.isVisible()) { this.placementPanel.hide(); return; }
        if (this.furniturePanel.isVisible()) { this.furniturePanel.hide(); return; }
        if (this.furniturePlaceMode) { this.exitFurniturePlaceMode(); return; }
        if (this.infrastructurePlaceMode) { this.exitInfrastructurePlaceMode(); return; }
        if (this.fpController.isDragMode()) { this.fpController.exitDragMode(); this.houseScene.hideGhost(); return; }
        return;
      }

      if (e.code === 'KeyV' && !e.repeat) {
        e.preventDefault();
        this.toggleMode();
        return;
      }

      if (shouldToggleInteriorLights(e.code, e.repeat) && this.interiorLighting) {
        e.preventDefault();
        this.interiorLighting.toggle();
        return;
      }

      if (e.code === 'KeyM' && !e.repeat) {
        e.preventDefault();
        if (this.overviewMenu.isVisible()) {
          this.overviewMenu.hide();
        } else {
          void this.refreshOverviewData();
          this.overviewMenu.show();
        }
        return;
      }

      if (e.code === 'KeyT' && !e.repeat) {
        e.preventDefault();
        this.houseScene.toggleTopDown();
        this.topDownButton?.sync();
        return;
      }

      if (shouldToggleSeeThrough(e.code, e.repeat, this.houseScene.mode)) {
        e.preventDefault();
        this.analysisTools.toggleSeeThrough();
        this.updateModeIndicator();
        return;
      }

      if (e.code === 'KeyC' && !e.repeat) {
        e.preventDefault();
        const next: CurtainState = this.curtainPresentationState.default === 'open'
          ? 'privacy'
          : this.curtainPresentationState.default === 'privacy'
            ? 'blackout'
            : 'open';
        void this.handleCurtainStateChange(next);
        return;
      }

      if (e.code === 'KeyP' && !e.repeat) {
        e.preventDefault();
        this.annotationGroupVisible = !this.annotationGroupVisible;
        this.annotationRenderer?.setVisible('all', this.annotationGroupVisible);
        return;
      }

      if (e.code === 'KeyL' && !e.repeat) {
        e.preventDefault();
        this.analysisTools.toggleMeasurement();
        if (this.houseScene.mode === 'orbit') {
          this.houseScene.controls.enabled = !this.analysisTools.measurement.active;
        }
        this.updateModeIndicator();
        this.updateCrosshairStyle();
        return;
      }

      if (this.houseScene.mode === 'first-person' && !e.repeat) {
        if (e.code === 'BracketLeft') { e.preventDefault(); this.sensitivitySlider.step(-1); return; }
        if (e.code === 'BracketRight') { e.preventDefault(); this.sensitivitySlider.step(1); return; }

        if (e.code === 'KeyB') {
          e.preventDefault();
          if (this.furniturePlaceMode) {
            this.exitFurniturePlaceMode();
          }
          this.furniturePanel.toggle();
          return;
        }

        if (e.code === 'KeyE') {
          e.preventDefault();
          if (this.infrastructurePlaceMode) {
            this.exitInfrastructurePlaceMode();
          }
          this.placementPanel.toggle();
          return;
        }

        if (e.code === 'KeyG') {
          e.preventDefault();
          if (this.fpController.isDragMode()) {
            this.fpController.exitDragMode();
            this.houseScene.hideGhost();
            return;
          }
          const hovered = this.hoverTooltip.getCurrent();
          if (hovered) {
            const isInfrastructure = hovered.objectId.startsWith('electrical:') || hovered.objectId.startsWith('plumbing:');
            if (hovered.type === 'furniture') {
              const parts = hovered.objectId.split(':');
              const type = parts[2] ?? parts[1];
              const rot = 0;
              this.fpController.enterDragMode(hovered.objectId, rot);
              const pos = this.houseScene.getFurniturePosition(hovered.objectId);
              if (pos) {
                this.houseScene.showGhost(pos.x, pos.z, pos.rotation, type);
              }
            } else if (isInfrastructure) {
              this.fpController.enterDragMode(hovered.objectId, 0);
              const pos = this.houseScene.getObjectPosition(hovered.objectId);
              if (pos) {
                this.houseScene.showGhost(pos.x, pos.z, 0, 'dining_chair');
              }
            }
          }
          return;
        }

        if (e.code === 'Delete') {
          e.preventDefault();
          const hovered = this.hoverTooltip.getCurrent();
          if (hovered) {
            const isElectrical = hovered.objectId.startsWith('electrical:');
            const isPlumbing = hovered.objectId.startsWith('plumbing:');
            if (isElectrical || isPlumbing) {
              const id = hovered.objectId.split(':').slice(1).join(':');
              const apiUrl = isElectrical ? '/api/electrical' : '/api/plumbing';
              fetch(`${apiUrl}/${id}`, { method: 'DELETE' })
                .then(async () => {
                  await this.refreshInfrastructure();
                })
                .catch((err) => console.error('Failed to delete annotation', err));
            }
          }
          return;
        }
      }

      if (e.code === 'Tab' && this.compareActive) {
        e.preventDefault();
        this.compareShowing = !this.compareShowing;
        if (this.compareShowing) {
          this.houseScene.applyCompareScheme();
        } else {
          this.stateSync.fetchScheme().then((s) => { if (s) this.applyScheme(s); });
        }
        return;
      }

      // ── Command palette toggle (shift + /) ──
      if (e.code === 'Slash' && e.shiftKey && !e.repeat) {
        e.preventDefault();
        this.commandPalette.toggle();
        return;
      }

      // ── Camera animation interrupt ──
      if (shouldInterruptCameraAnimation(
        this.houseScene.cameraAnimator.isAnimating(),
        this.houseScene.cameraAnimator.currentMode,
        e.code,
      )) {
        this.houseScene.cameraAnimator.interrupt();
      }
    });

    document.addEventListener('mousedown', (e: MouseEvent) => {
      this.requestRender();
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
    const fallbackRoom = rooms.find((r) => r.id === 'living_dining') ?? rooms[0];

    const pointerRoomId = this.houseScene.raycastRoomAtPointer();
    const target = this.houseScene.controls.target;
    const room = resolveSpawnRoom(
      pointerRoomId,
      { x: target.x, z: target.z },
      rooms,
      fallbackRoom ?? null,
    );

    const spawnX = room?.x ?? 7.4;
    const spawnZ = room?.z ?? 3.65;
    const fpPos = new THREE.Vector3(spawnX, 1.7, spawnZ);
    const fpDir = new THREE.Vector3(0, 0, 1);

    this.savedOrbitPos = this.houseScene.camera.position.clone();
    this.savedOrbitTarget = this.houseScene.controls.target.clone();

    this.houseScene.controls.enabled = false;
    this.fpController.enable();
    this.fpController.requestLock();
    this.houseScene.cameraAnimator.transitionToFirstPerson(fpPos, fpDir);
    this.requestRender();
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
    this.requestRender();
    this.updateModeIndicator();
  }

  private handleCenterClick(): void {
    if (this.analysisTools.measurement.active) {
      this.analysisTools.measurement.onFirstPersonAction();
      return;
    }

    if (this.fpController.isDragMode()) {
      const objectId = this.fpController.getDraggedObjectId();
      const pos = this.houseScene.getGhostPosition();
      if (objectId && pos) {
        const x = pos.x;
        const z = pos.z;
        if (objectId.startsWith('electrical:') || objectId.startsWith('plumbing:')) {
          const isElectrical = objectId.startsWith('electrical:');
          const id = objectId.split(':').slice(1).join(':');
          const apiUrl = isElectrical ? '/api/electrical' : '/api/plumbing';
          fetch(`${apiUrl}/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ x, z }),
          }).then(async () => {
            await this.refreshInfrastructure();
          }).catch((err) => console.error('Failed to update annotation', err));
        } else if (objectId.startsWith('furniture:')) {
          const rotation = this.fpController.getDragRotation();
          const parts = objectId.split(':');
          if (parts.length >= 4) {
            const room = parts[1];
            const index = parseInt(parts[3], 10);
            if (!isNaN(index)) {
              fetch(`/api/furnishings/${room}/${index}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ x, z, rotation }),
              }).catch((err) => console.error('Failed to update furnishing', err));
            }
          }
        }
      }
      this.fpController.exitDragMode();
      this.houseScene.hideGhost();
      return;
    }

    if (this.infrastructurePlaceMode) {
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      const pos = this.houseScene.getGroundPosition(centerX, centerY);
      if (pos) {
        const { category, type } = this.infrastructurePlaceMode;
        const apiUrl = category === 'electrical' ? '/api/electrical' : '/api/plumbing';
        const id = `${type}_${Date.now()}`;
        const room = 'living_dining';
        const height = category === 'electrical'
          ? (type === 'switch' ? 1.3 : type === 'floor_socket' ? 0.05 : 0.3)
          : 0;
        fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, room, type, x: pos.x, z: pos.z, height }),
        }).then(async () => {
          await this.refreshInfrastructure();
        }).catch((err) => console.error('Failed to place annotation', err));
      }
      this.exitInfrastructurePlaceMode();
      return;
    }

    if (this.furniturePlaceMode) {
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      const pos = this.houseScene.getGroundPosition(centerX, centerY);
      if (pos) {
        const type = this.furniturePlaceMode.type;
        fetch('/api/furnishings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ room: 'living_dining', type, x: pos.x, z: pos.z, rotation: 0 }),
        }).then(async () => {
          const response = await fetch('/api/project');
          const data = await response.json();
          this.projectData = data;
          this.collision.setWalls(this.extractWalls(data?.house?.sceneElements));
          await this.houseScene.buildFromCatalog(data);
          this.analysisTools.setFurnitureMeshes(this.houseScene.getFurnitureMeshes());
          this.analysisTools.setRooms(data?.house?.rooms ?? []);
          this.analysisTools.checkFurnitureCollisions();
        }).catch((err) => console.error('Failed to place furnishing', err));
      }
      this.exitFurniturePlaceMode();
      return;
    }

    const target = this.houseScene.raycastFromScreenCenter();
    if (!target) return;

    this.infoPanel.showObject(target);
    if (target.type === 'mep_coordination_route' && target.mep?.routeId) {
      this.houseScene.highlightMepRoute(String(target.mep.routeId));
    }
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

  private async handleCurtainStateChange(state: CurtainState, roomId?: string): Promise<void> {
    const presentationState = await this.stateSync.updateCurtainState(state, roomId, this.curtainPresentationState.updatedAt || undefined);
    this.applyCurtainPresentationState(presentationState);
  }

  private applyCurtainPresentationState(state: CurtainPresentationState): void {
    this.curtainPresentationState = state;
    this.houseScene.applyCurtainPresentationState(state);
    this.infoPanel.setPresentationState(state);
    this.overviewMenu.setPresentationState(state);
    this.requestRender();
  }

  private async refreshOverviewData(): Promise<void> {
    const [scheme, presentationState, decisions, budget, risks, archives] = await Promise.all([
      this.stateSync.fetchScheme(),
      this.stateSync.getPresentationState(),
      this.stateSync.fetchDecisions(),
      this.stateSync.fetchBudget(),
      this.stateSync.fetchRisks(),
      this.stateSync.fetchArchivedSchemes(),
    ]);
    this.infoPanel.setScheme(scheme);
    this.overviewMenu.setScheme(scheme);
    this.applyCurtainPresentationState(presentationState);
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
      this.houseScene.getViewOnlyRoot(),
    );
    await this.refreshInfrastructure();
    this.analysisTools.setFurnitureMeshes(this.houseScene.getFurnitureMeshes());
    this.analysisTools.setRooms(this.projectData?.house?.rooms ?? []);
    this.analysisTools.checkFurnitureCollisions();
    const [scheme, presentationState] = await Promise.all([
      this.stateSync.fetchScheme(),
      this.stateSync.getPresentationState(),
    ]);
    if (scheme) this.applyScheme(scheme);
    this.applyCurtainPresentationState(presentationState);
    this.requestRender();
  }

  private async handleCompare(archiveId: string): Promise<void> {
    const response = await fetch(`/api/schemes/compare?other=${archiveId}`);
    const data = await response.json();
    this.schemePanel.initCompare(archiveId, data.diff);
    this.houseScene.setCompareScheme(data.compare.scheme);
    this.compareActive = true;
  }

  private async refreshInfrastructure(): Promise<void> {
    this.setHvacCoordinationState('loading');
    this.houseScene.clearHvacProjection();
    this.houseScene.clearElectricalTopology();
    this.electricalTopology = null;
    this.electricalTopologyVisible = false;
    this.syncElectricalTopologyButton();
    this.annotationRenderer?.clear();
    await this.annotationRenderer?.load();
    if (this.annotationRenderer) {
      this.houseScene.placeInfrastructureFixtures(
        this.annotationRenderer.getElectricalData(),
        this.annotationRenderer.getPlumbingData(),
      );
      try {
        const topologyResponse = await fetch('/api/electrical-topology');
        if (topologyResponse.ok) {
          this.electricalTopology = await topologyResponse.json() as ElectricalTopology & { lint?: { counts: { circuits: number; uncoveredPoints: number; warnings: number } } };
          const electricalPoints = this.renderFacts?.electrical ?? this.annotationRenderer.getElectricalData();
          this.houseScene.loadElectricalTopology(this.electricalTopology, electricalPoints);
          this.infoPanel.setElectricalTopology(this.electricalTopology);
          this.setupElectricalTopologyControls(this.electricalTopology);
          const summary = document.getElementById('electrical-topology-summary');
          const lint = this.electricalTopology.lint;
          if (summary && lint) {
            summary.hidden = false;
            summary.textContent = `电气回路 ${lint.counts.circuits} 条 / 未覆盖 ${lint.counts.uncoveredPoints} / warning ${lint.counts.warnings}`;
          }
          this.syncElectricalTopologyButton();
        } else {
          this.syncElectricalTopologyButton();
        }
      } catch {
        this.electricalTopology = null;
        this.houseScene.setElectricalTopologyVisible(false);
        this.syncElectricalTopologyButton();
      }
      try {
        const response = await fetch('/api/render-facts/projection');
        if (!response.ok) throw new Error('render facts projection is not ready');

        const projection = parseProjectRenderFactsProjection(await response.json());
        const nextInteriorLighting = new InteriorLightingSystem(
          this.houseScene.scene,
          projection.lightingFixtures,
          projection.lighting,
        );
        const st = this.houseScene.getEnvironmentManager().getLightingState();
        nextInteriorLighting.syncSolar({ isNight: st.isNight, altitudeDeg: st.altitudeDeg });
        this.interiorLighting?.dispose();
        this.interiorLighting = nextInteriorLighting;
        const factsResponse = await fetch('/api/render-facts');
        this.renderFacts = factsResponse.ok ? await factsResponse.json() as ProjectRenderFacts : undefined;
        const sources = buildHvacBuilderSources({
          projection,
          electrical: this.renderFacts?.electrical ?? this.annotationRenderer.getElectricalData(),
          hvac: this.renderFacts?.hvac,
        });
        this.houseScene.rebuildHvacProjection(projection, sources);
        this.houseScene.loadHvacProjection(projection, sources);
        try {
          const mepResponse = await fetch('/api/mep-coordination');
          if (mepResponse.ok && this.renderFacts?.hvac?.plans) {
            const mepPayload = await mepResponse.json() as MepCoordination & { lint?: MepLintResult };
            const mep = mepPayload;
            const plan = this.renderFacts.hvac.plans[0];
            const mepSources = {
              electrical: this.renderFacts.electrical,
              plumbing: this.renderFacts.plumbing,
              ceiling: this.renderFacts.ceiling,
              hvacAnchors: plan?.diagram.anchors ?? [],
              hvacTerminals: plan?.diagram.terminals ?? [],
              outdoor: plan ? [plan.outdoor] : [],
            };
            this.mepLintResult = mepPayload.lint ?? null;
            const mepLintSummary = document.getElementById('mep-lint-summary');
            if (mepLintSummary) renderMepLintSummary(mepLintSummary, this.mepLintResult);
            this.houseScene.loadMepCoordination(mep, mepSources, mepPayload.lint);
            const mepReport = this.houseScene.getMepRenderReport();
            if (mepReport.skipped > 0) {
              console.warn(`[mep] ${mepReport.skipped}/${mepReport.total} routes skipped: ${mepReport.skippedRoutes.join(', ')}`);
              this.showToast(`MEP 路线不完整：${mepReport.resolved}/${mepReport.total} 条已渲染`);
            }
            this.setupMepLayerControls(mep);
            this.setMepCoordinationState(true);
            this.updateMepLintSummaryVisibility();
          } else {
            this.setMepCoordinationState(false);
          }
        } catch {
          this.setMepCoordinationState(false);
        }

        const hvac = this.houseScene.getHvacExportStatus();
        if (projection.hvac.status === 'implemented' && hvac.ready) {
          this.setHvacCoordinationState('ready');
          const anchors = projection.hvac.diagram.anchors;
          const outdoorCount = anchors.filter((anchor) => anchor.ref?.source === 'outdoor').length;
          const indoorCount = anchors.filter((anchor) => anchor.ref?.source === 'ceiling').length;
          this.showToast(`${projection.hvac.planId} 一拖五已就绪：外机 ${outdoorCount} / 内机 ${indoorCount} / 预深化路线 ${projection.hvac.diagram.routes.length}`);
        } else {
          this.houseScene.clearHvacProjection();
          this.setHvacCoordinationState('unimplemented');
        }
      } catch (error) {
        this.houseScene.clearHvacProjection();
        this.houseScene.setMepCoordinationVisible(false);
        this.setMepCoordinationState(false);
        this.setHvacCoordinationState('unimplemented');
        const message = error instanceof Error ? error.message : String(error);
        this.showToast(`室内灯光配置不可用：${message}`);
        console.warn('render facts projection is not ready; interior lights were not created', error);
      }
    } else {
      this.setHvacCoordinationState('unimplemented');
    }
    this.requestRender();
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
        // DEC-041：传整份 selection（default + roomOverrides），分房覆盖在渲染层生效
        this.houseScene.setSelection(topicId, effective, selection);
        this.schemePanel.setActiveOption(topicId, effective, []);
      }
    }
    this.requestRender();
  }

  private updateModeIndicator(): void {
    const measSuffix = this.analysisTools?.measurement.active ? ' · 📏 测量开启' : '';
    const seeThroughSuffix = this.analysisTools?.isSeeThrough() ? ' · 👁 透视' : '';
    if (this.houseScene.mode === 'orbit') {
      this.modeIndicator.textContent = `轨道模式 · 按 V 切换第一人称${measSuffix}${seeThroughSuffix}`;
    } else {
      this.modeIndicator.textContent = `第一人称 · WASD 移动 · [ ] 灵敏度 · 按 V 切换轨道 · 按 M 总览${measSuffix}${seeThroughSuffix}`;
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

  private toggleSlidingDoor(id: string): void {
    const els = this.projectData?.house?.sceneElements as any[] | undefined;
    const el = els?.find((e) => e.type === 'sliding_door_run' && e.id === id);
    if (!el) return;
    el.open = !(el.open ?? true);
    this.houseScene.refreshSlidingDoor(el);
    this.collision.setWalls(this.extractWalls(els));
  }

  private requestRender(): void {
    if (this.disposed || this.renderQueued) return;
    this.renderQueued = true;
    this.rafId = requestAnimationFrame(this.renderLoop);
  }

  private renderLoop = (time: number) => {
    this.renderQueued = false;
    this.rafId = undefined;
    const dt = this.lastTime === 0 ? 0.016 : Math.min((time - this.lastTime) / 1000, 0.1);
    this.lastTime = time;

    this.houseScene.updateCameras();

    if (this.houseScene.mode === 'first-person' && !this.houseScene.cameraAnimator.isAnimating()) {
      this.fpController.update(dt);

      if (this.furniturePlaceMode) {
        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;
        const pos = this.houseScene.getGroundPosition(centerX, centerY);
        if (pos) {
          this.houseScene.updateGhostPosition(pos.x, pos.z);
        }
      }

      if (this.infrastructurePlaceMode) {
        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;
        const pos = this.houseScene.getGroundPosition(centerX, centerY);
        if (pos) {
          this.houseScene.updateGhostPosition(pos.x, pos.z);
        }
      }

      if (this.fpController.isDragMode()) {
        const pos = this.houseScene.getGhostPosition();
        if (pos) {
          const rot = this.fpController.getDragRotation();
          this.houseScene.updateGhostPosition(pos.x, pos.z, rot);
        }
      }

      const target = this.houseScene.raycastFromScreenCenter({ hoverableOnly: true });
      this.hoverTooltip.update(target);
    }

    this.annotationRenderer?.updateLabels();
    this.analysisTools.updatePulse();
    this.houseScene.renderFrame();

    if (this.sunlightSystem?.isPlaying()) {
      this.sunlightSystem.update(dt);
      this.sunlightPanel.setHourDisplay(this.sunlightSystem.getHour());
    }
    if (this.sunlightPanel.isVisible() && this.sunlightSystem) {
      const r = this.sunlightSystem.getSolarReadout();
      this.sunlightPanel.setSolarReadout(r.altitudeDeg, r.azimuthDeg);
    }
    this.humidityOverlay?.updatePulse();

    const needsContinuousRender =
      this.houseScene.cameraAnimator.isAnimating()
      || (this.houseScene.mode === 'first-person' && (this.fpController.isAnyKeyDown || this.fpController.isDragMode()))
      || this.sunlightSystem?.isPlaying()
      || this.analysisTools.isPulsing()
      || this.humidityOverlay?.isPulsing();
    if (needsContinuousRender) this.requestRender();
  };

  dispose(): void {
    this.disposed = true;
    if (this.rafId !== undefined) {
      cancelAnimationFrame(this.rafId);
    }
    this.fpController.dispose();
    this.houseScene.dispose();
    if ((window as Window & { setHvacCoordinationVisible?: unknown }).setHvacCoordinationVisible === this.hvacCoordinationApi) {
      delete (window as Window & { setHvacCoordinationVisible?: unknown }).setHvacCoordinationVisible;
    }
    this.stateSync.dispose();
  }
}
