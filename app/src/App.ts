import * as THREE from 'three';
import { StateSync, type PhaseId } from './state/StateSync.js';
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
import { CommandRegistry, type Command } from './ui/CommandRegistry.js';
import { SurfaceManager } from './ui/SurfaceManager.js';
import { MobileTabBar } from './ui/MobileTabBar.js';
import { isMobileChrome, readCapabilities, subscribeCapabilities, type InputCapabilities } from './ui/input-capability.js';
import { VirtualJoystick } from './scene/VirtualJoystick.js';
import { PointerIntent } from './scene/pointer-intent.js';
import { readViewState, writeViewState } from './ui/view-state-store.js';
import { TopDownButton } from './ui/TopDownButton.js';
import { HvacCoordinationButton, type HvacCoordinationButtonState } from './ui/HvacCoordinationButton.js';
import { WallTileButton, type WallTileButtonState } from './ui/WallTileButton.js';
import { PaintButton, type PaintButtonState } from './ui/PaintButton.js';
import { CeilingZoneButton, type CeilingZoneButtonState } from './ui/CeilingZoneButton.js';
import { CeilingZonePanel } from './render/analysis/CeilingZonePanel.js';
import { ElementStateButton, type ElementStateButtonState } from './ui/ElementStateButton.js';
import { ElementStatePanel } from './render/analysis/ElementStatePanel.js';
import type { ElementStateLike } from './render/analysis/element-state-colors.js';
import { CeilingQuotePanel } from './render/analysis/CeilingQuotePanel.js';
import { CeilingQuoteButton } from './ui/CeilingQuoteButton.js';
import { TRADE_LABEL } from './render/analysis/ceiling-zone-colors.js';
import { FurniturePanel } from './ui/FurniturePanel.js';
import { PlacementPanel } from './ui/PlacementPanel.js';
import { SunlightSystem } from './render/SunlightSystem.js';
import { InteriorLightingSystem } from './render/InteriorLightingSystem.js';
import { SunlightPanel } from './ui/SunlightPanel.js';
import { SunlightButton } from './ui/SunlightButton.js';
import { LightingPreviewPanel, type LightingPreviewRoom, type LightingPreviewState } from './ui/LightingPreviewPanel.js';
import { MaterialPreviewPanel, type MaterialPreviewOption, type MaterialPreviewPanelState, type PreviewSlot } from './ui/MaterialPreviewPanel.js';
import { PreviewWorkbench } from './ui/PreviewWorkbench.js';
import { resolvePreviewAtlas, type MaterialPreviewAtlas } from './data/materialPreviewAtlas.js';
import { GlassFidelityButton } from './ui/GlassFidelityButton.js';
import { Popover } from './ui/Popover.js';
import { LayersPanel, LAYER_KEYS, type LayerDescriptor, type LayerKey } from './ui/LayersPanel.js';

const SUNLIGHT_STORAGE_KEY = 'sunlight-enabled';
import { DaylightHeatmap } from './render/analysis/DaylightHeatmap.js';
import { HumidityOverlay } from './render/analysis/HumidityOverlay.js';
import { HumidityButton } from './ui/HumidityButton.js';
import { renderMepLintBadge } from './ui/MepLintSummary.js';
import { isInHuinanWindow } from '@shared/humidity-model';
import { exportObjectTreeToGlb } from './render/export-gltf.js';
import './ui/keybindings.js';
import { parseProjectRenderFactsProjection } from '@shared/project-render-facts-schema';
import { buildHvacBuilderSources } from '@shared/render/HvacBuilder';
import type { CaptureOptions, RoomAuditCaptureOptions } from '@shared/types';
import type { CurrentScheme, CurtainPresentationState, CurtainState, DecisionLogEntry, ProjectRenderFacts, ProjectRenderFactsProjection, Topic, SelectionPatch, ElectricalTopology, ElectricalCircuitPurpose, BudgetSnapshot, MaterialAppearance, MaterialPreviewAtlasConfig } from '@shared/types';
import type { MepCoordination } from '@shared/mep-hvac-coordination-schema';
import type { MepLintResult } from '@shared/mep-hvac-lint';

const ORBIT_DISTANCE = 15;

interface VisualPreviewSnapshot {
  material: MaterialPreviewPanelState;
  paintPreviewActive: boolean;
  lighting: LightingPreviewState;
  sunlight: { enabled: boolean; month: number; day: number; hour: number };
}

export class App {
  private stateSync: StateSync;
  private houseScene: HouseScene;
  private schemePanel: SchemePanel;
  private infoPanel: InfoPanel;
  private previewWorkbench: PreviewWorkbench;
  private offlineIndicator: OfflineIndicator;
  private crosshair: Crosshair;
  private sensitivitySlider: SensitivitySlider;
  private hoverTooltip: HoverTooltip;
  private overviewMenu: OverviewMenu;
  private topDownButton: TopDownButton | null = null;
  private hvacCoordinationButton: HvacCoordinationButton | null = null;
  private hvacCoordinationState: HvacCoordinationButtonState = 'loading';
  private hvacCoordinationVisible = false;
  // 贴砖检视态：独立子系统，与 HVAC / MEP / 电气回路开关平级且互不引用（DEC-2026-10-07-R08）
  private wallTileButton: WallTileButton | null = null;
  private wallTileState: WallTileButtonState = 'loading';
  private wallTileVisible = false;
  // 涂漆检视态：同样独立，与贴砖/HVAC/MEP/电气回路平级且互不引用
  private paintButton: PaintButton | null = null;
  private paintState: PaintButtonState = 'loading';
  private paintVisible = false;
  private lastBudget: BudgetSnapshot | null = null;
  // 吊顶分区高亮：独立子系统（DEC-2026-10-08-C01），与贴砖/HVAC/MEP 平级且互不引用
  private ceilingZoneButton: CeilingZoneButton | null = null;
  private ceilingZoneState: CeilingZoneButtonState = 'loading';
  private ceilingZoneVisible = false;
  private ceilingZonePanel: CeilingZonePanel | null = null;
  // 吊顶报价面板（DEC-2026-10-08-C03）：与分区高亮平级，纯数据面板，不碰 3D
  private ceilingQuoteButton: CeilingQuoteButton | null = null;
  private ceilingQuotePanel: CeilingQuotePanel | null = null;
  private ceilingQuoteVisible = false;
  // 构件级工程状态高亮（DEC-2026-10-09-E01）：独立子系统，与吊顶/贴砖/HVAC/MEP 平级且互不引用。
  // 数据来自 GET /api/element-state?conflicts=1；服务端未就绪时静默降级为「不可用」。
  private elementStateButton: ElementStateButton | null = null;
  private elementStateState: ElementStateButtonState = 'loading';
  private elementStateVisible = false;
  private elementStatePanel: ElementStatePanel | null = null;
  private mepCoordinationVisible = false;
  private mepCoordinationReady = false;
  private mepLintResult: MepLintResult | null = null;
  private electricalTopology: (ElectricalTopology & { lint?: { counts: { circuits: number; uncoveredPoints: number; warnings: number } } }) | null = null;
  private electricalTopologyVisible = false;
  private mepOverviewVisible = false;
  private collision: CollisionDetector;
  private fpController: FirstPersonController;
  private projectData: any = null;
  private phase: PhaseId = 'full';
  private activeLayout = 'model-geometry';
  private phaseReloading = false;
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
  private commandRegistry = new CommandRegistry();
  private surfaceManager = new SurfaceManager();
  private commandPalette = new CommandPalette();
  private mobileTabBar: MobileTabBar | null = null;
  private viewPopover: Popover | null = null;
  private virtualJoystick: VirtualJoystick | null = null;
  private unsubscribeCapabilities: (() => void) | null = null;
  private capabilities: InputCapabilities = { touchPrimary: false, narrowViewport: false };
  private furniturePanel = new FurniturePanel();
  private furniturePlaceMode: { type: string } | null = null;
  private placementPanel = new PlacementPanel();
  private infrastructurePlaceMode: { category: string; type: string } | null = null;
  private sunlightPanel = new SunlightPanel();
  private sunlightSystem: SunlightSystem | null = null;
  private sunlightEnabled = false;
  private interiorLighting: InteriorLightingSystem | null = null;
  private lightingPreviewPanel: LightingPreviewPanel | null = null;
  private materialPreviewPanel: MaterialPreviewPanel | null = null;
  private materialPreviewAtlases: MaterialPreviewAtlas[] = [];
  private officialScheme: CurrentScheme | null = null;
  private materialPreviewState: MaterialPreviewPanelState | null = null;
  private visualPreviewActive = false;
  private visualPreviewPaintActive = false;
  private visualPreviewSlots: Record<PreviewSlot, VisualPreviewSnapshot | null> = { A: null, B: null };
  private sunlightButton: SunlightButton | null = null;
  private glassFidelityButton: GlassFidelityButton | null = null;
  private daylightHeatmap: DaylightHeatmap | null = null;
  private humidityOverlay: HumidityOverlay | null = null;
  private humidityButton: HumidityButton | null = null;
  // 顶栏收敛（图层抽屉 / 环境 / 告警 / 设置）：只做表现层编排，各检视层 setter 仍平级独立
  private layersPanel: LayersPanel | null = null;
  private envPopover: Popover | null = null;
  private alertsPopover: Popover | null = null;
  private settingsPopover: Popover | null = null;
  private layerComboSuppressed = false;
  private pendingComboRestore: LayerKey[] | null = null;
  private readonly surfaceDismissIntent = new PointerIntent();
  private curtainPresentationState: CurtainPresentationState = { default: 'open', roomOverrides: {}, updatedAt: '' };
  private readonly hvacCoordinationApi = (visible: boolean) => this.setHvacCoordinationVisible(Boolean(visible));
  private readonly materialTextureErrorHandler = (event: Event) => {
    const message = (event as CustomEvent<{ message?: string }>).detail?.message ?? 'unknown texture error';
    this.showToast(`厂家贴图加载失败：${message}`);
  };
  private readyState: 'loading' | 'ready' | 'failed' = 'loading';
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: unknown) => void;
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.stateSync = new StateSync();
    this.commandPalette.setRegistry(this.commandRegistry);
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
    this.previewWorkbench = new PreviewWorkbench(document.getElementById('right-panel-stack')!);
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
      onPhaseChange: (phase) => void this.handlePhaseChange(phase),
    });
    this.modeIndicator = document.getElementById('mode-indicator') as HTMLDivElement;
    this.toastEl = document.getElementById('pointer-lock-toast') as HTMLDivElement;
    window.addEventListener('material-texture-error', this.materialTextureErrorHandler);

    this.setupFurniturePanel();
    this.setupPlacementPanel();
    this.setupExportButton();
    this.setupTopDownButton();
    this.setupHvacCoordinationButton();
    this.setupMepCoordinationButton();
    this.setupElectricalTopologyButton();
    this.setupWallTileButton();
    this.setupPaintButton();
    this.setupCeilingZoneButton();
    this.setupCeilingQuoteButton();
    this.setupElementStateButton();
    this.setupLayersPanel();
    this.setupToolbarPopovers();
    this.setupSurfaces();
    const mepLintBadge = document.getElementById('mep-lint-badge');
    if (mepLintBadge) renderMepLintBadge(mepLintBadge, this.mepLintResult);
    this.setupDragHandlers();
    this.setupEventHandlers();
    this.setupKeyboard();
    this.setupPointerLockEvents();
    this.setupMeasurementHandlers(canvas);

    this.houseScene.cameraAnimator.setOnComplete((mode) => {
      this.houseScene.setMode(mode);
      if (mode === 'first-person') {
        this.previewWorkbench.setFirstPerson(true);
        this.fpController.syncFromCamera();
        this.crosshair.show();
        this.sensitivitySlider.show();
      } else {
        this.previewWorkbench.setFirstPerson(false);
        this.crosshair.hide();
        this.sensitivitySlider.hide();
        this.hoverTooltip.clear();
      }
      this.syncFirstPersonTouchControls();
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
    this.stateSync.setPhase(this.phase);
    this.projectData = await this.stateSync.fetchProject({ phase: this.phase });
    const previewAtlasConfig = this.projectData?.materialPreview?.atlases as MaterialPreviewAtlasConfig[] | undefined;
    this.materialPreviewAtlases = (previewAtlasConfig ?? []).map(resolvePreviewAtlas);
    this.activeLayout = this.projectData?.house?.layoutSource ?? this.activeLayout;
    this.stateSync.setLayout(this.activeLayout);
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
      this.finishVisualPreview();
      this.stateSync.updateScheme([{ topic: topicId, optionId }]);
    });
    this.infoPanel.setTopics(this.topics);
    this.overviewMenu.setTopics(this.topics);
    this.overviewMenu.setPhase(this.phase);

    try {
      const layoutsRes = await fetch('/api/layouts');
      const layoutsData = await layoutsRes.json();
      this.overviewMenu.setLayouts(layoutsData.layouts);
      this.overviewMenu.setActiveLayout(this.activeLayout);
    } catch (e) {
      // layouts not critical
    }

    this.stateSync.start();

    const scheme = await this.stateSync.fetchScheme();
    if (scheme) {
      this.applyScheme(scheme);
      this.infoPanel.setScheme(scheme);
      this.overviewMenu.setScheme(scheme);
      this.setupMaterialPreviewPanel(scheme);
    }

    const presentationState = await this.stateSync.getPresentationState();
    this.applyCurtainPresentationState(presentationState);

    const decisions = await this.stateSync.fetchDecisions();
    this.overviewMenu.setDecisionLog(decisions);

    await this.refreshOverviewData();

    this.setupSunlight();
    this.setupLightingPreviewPanel();
    this.setupHumidity();
    this.setupGlassFidelity();
    this.setupCommandRegistry();
    this.restorePersistedViewState();
    this.updateModeIndicator();
    this.requestRender();
    this.readyState = 'ready';
    this.syncDataReadyChip();
    // 贴砖检视态不依赖 HVAC projection 的就绪时序，只等场景本身加载完成即可用。
    this.setWallTileState('ready');
    // 涂漆检视态同理：只依赖 overlay.yaml 的 paint_region 声明随场景一起建好。
    this.setPaintState('ready');
    // 吊顶分区高亮同样只依赖场景本身：分区声明随 /api/project 的 house.ceilingZones 一起到。
    this.ceilingZonePanel = new CeilingZonePanel(this.houseScene);
    this.setCeilingZoneState('ready');
    // 吊顶报价面板：拉 /api/ceiling/quotes，不进 3D，所以同样只在场景就绪后建
    this.ceilingQuotePanel = new CeilingQuotePanel(() => this.refreshOverviewData());
    // 构件工程状态面板（DEC-2026-10-09-E01）：数据来自 /api/element-state，静默拉取，
    // 不阻塞 ready；服务端没上这个端点就降级成「不可用」，不弹错误刷屏。
    this.elementStatePanel = new ElementStatePanel(this.houseScene);
    void this.loadElementStates();
    this.resolveReady();
    } catch (error) {
      this.readyState = 'failed';
      this.syncDataReadyChip();
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

  inspectMasterBedroomCondensate(): ReturnType<HouseScene['inspectMasterBedroomCondensate']> {
    return this.houseScene.inspectMasterBedroomCondensate();
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
    // GLTFExporter 不认 BatchedMesh 且 HVAC 导出校验要看原始 mesh：先挂回，完成后重新合批
    this.houseScene.restoreStaticBatches();
    try {
      const hvac = this.houseScene.getHvacExportStatus();
      if (hvac.required && !hvac.ready) {
        throw new Error(`GLB 导出已阻止：HVAC 缺失 ${hvac.missing.join(', ')}`);
      }
      return { blob: await exportObjectTreeToGlb(this.houseScene.getExportRoot()), hvac };
    } finally {
      this.houseScene.reapplyStaticBatches();
    }
  }

  private setupGlassFidelity(): void {
    this.glassFidelityButton = new GlassFidelityButton({
      onToggle: () => this.setGlassHighFidelity(!this.houseScene.getGlassHighFidelity()),
      getActive: () => this.houseScene.getGlassHighFidelity(),
    });
  }

  private setGlassHighFidelity(enabled: boolean): void {
    this.houseScene.setGlassHighFidelity(enabled);
    this.glassFidelityButton?.sync();
    this.requestRender();
  }

  private setupSunlight(): void {
    const sunlightHost = document.getElementById('sunlight-preview-host');
    if (sunlightHost) this.sunlightPanel.mount(sunlightHost, () => this.previewWorkbench.focusSunlight());
    const env = this.projectData?.environment;
    if (!env) return;

    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(SUNLIGHT_STORAGE_KEY) : null;
    this.sunlightEnabled = stored === '1';
    this.houseScene.getEnvironmentManager().setSunlightEnabled(this.sunlightEnabled);

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
      this.syncLightingPreviewPanel();
      this.requestRender();
    });

    this.daylightHeatmap = new DaylightHeatmap(this.houseScene);
    this.sunlightPanel.onHeatmapToggle(() => {
      void this.daylightHeatmap?.toggle();
      this.requestRender();
    });

    this.sunlightButton = new SunlightButton({
      onToggle: () => {
        this.envPopover?.close();
        this.setSunlightEnabled(!this.sunlightEnabled);
      },
      getActive: () => this.sunlightEnabled,
    });
  }

  private setSunlightEnabled(enabled: boolean): void {
    this.sunlightEnabled = enabled;
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(SUNLIGHT_STORAGE_KEY, enabled ? '1' : '0');
    } catch { /* 持久化失败不影响功能 */ }
    this.houseScene.getEnvironmentManager().setSunlightEnabled(enabled);
    if (enabled) {
      this.sunlightPanel.show();
      this.sunlightSystem?.showTrajectory();
    } else {
      this.sunlightPanel.hide();
      this.sunlightSystem?.hideTrajectory();
    }
    const st = this.houseScene.getEnvironmentManager().getLightingState();
    // Closing the solar controls preserves the selected day/night state; an actual night keeps interior lights on.
    this.interiorLighting?.syncSolar({ isNight: st.isNight, altitudeDeg: st.altitudeDeg });
    this.previewWorkbench.focusSunlight();
    this.syncLightingPreviewPanel();
    this.houseScene.requestShadowUpdate();
    this.sunlightButton?.sync();
    this.requestRender();
  }

  private setupLightingPreviewPanel(): void {
    if (!this.interiorLighting || this.lightingPreviewPanel) return;
    const host = document.getElementById('lighting-preview-host');
    if (!host) return;
    this.lightingPreviewPanel = new LightingPreviewPanel(host, {
      onModeChange: (mode) => {
        // 进入手动夜预演必须同时开灯：该模式的目的就是看室内照明，
        // 而白天 auto 状态 carried over 会让全屋灯具在一片夜态场景里保持全灭。
        this.interiorLighting?.setPreviewMode(mode, mode === 'manual');
        this.houseScene.getEnvironmentManager().setInteriorOnlyNightPreview(mode === 'manual');
        this.houseScene.requestShadowUpdate();
        this.syncLightingPreviewPanel();
        this.requestRender();
      },
      onManualOnChange: (on) => {
        this.interiorLighting?.setPreviewManualOn(on);
        this.syncLightingPreviewPanel();
        this.houseScene.requestShadowUpdate();
        this.requestRender();
      },
      onTemperatureChange: (temperatureK) => {
        this.interiorLighting?.setPreviewTemperature(temperatureK);
        this.syncLightingPreviewPanel();
        this.requestRender();
      },
      onColorAppearanceChange: (mode) => {
        this.interiorLighting?.setPreviewColorAppearanceMode(mode);
        this.syncLightingPreviewPanel();
        this.requestRender();
      },
      onBrightnessChange: (multiplier) => {
        this.interiorLighting?.setPreviewBrightness(multiplier);
        this.syncLightingPreviewPanel();
        this.requestRender();
      },
      onRoomChange: (roomId, enabled) => {
        this.interiorLighting?.setRoomLights(roomId, enabled);
        this.syncLightingPreviewPanel();
        this.requestRender();
      },
      onReset: () => {
        this.interiorLighting?.clearPreviewOverrides();
        this.houseScene.getEnvironmentManager().setInteriorOnlyNightPreview(false);
        this.syncLightingPreviewPanel();
        this.houseScene.requestShadowUpdate();
        this.requestRender();
      },
    }, this.getLightingPreviewState());
    this.syncLightingPreviewPanel();
  }

  private getLightingPreviewState(): LightingPreviewState {
    const systemState = this.interiorLighting?.getPreviewState();
    const roomNames = new Map<string, string>(
      (this.projectData?.house?.rooms ?? []).map((room: { id: string; name?: string }) => [room.id, room.name ?? room.id]),
    );
    const rooms: LightingPreviewRoom[] = (this.interiorLighting?.getPreviewRooms() ?? []).map((room) => ({
      ...room,
      label: roomNames.get(room.id) ?? room.id,
    }));
    return {
      mode: systemState?.mode ?? 'auto',
      manualOn: systemState?.manualOn ?? false,
      temperatureK: systemState?.temperatureK ?? null,
      colorAppearance: systemState?.colorAppearance ?? 'eye-adapted',
      brightness: systemState?.brightness ?? 1,
      rooms,
    };
  }

  private syncLightingPreviewPanel(): void {
    this.lightingPreviewPanel?.update(this.getLightingPreviewState());
  }

  private setupMaterialPreviewPanel(scheme: CurrentScheme): void {
    if (this.materialPreviewPanel) return;
    const host = document.getElementById('material-preview-host');
    const floorTopic = this.topics.find((topic) => topic.id === 'floor');
    if (!host || !floorTopic) return;
    const options: MaterialPreviewOption[] = floorTopic.options.map((option) => {
      const appearance = this.getFloorAppearance(option.id);
      return {
        id: option.id,
        label: option.name,
        supportsManufacturerAtlas: appearance?.type === 'wood_plank',
      };
    });
    const atlases = this.materialPreviewAtlases.map((atlas) => ({ id: atlas.id, label: atlas.label, note: atlas.note }));
    const initialPreviewState = this.makeMaterialPreviewState(scheme);
    this.materialPreviewState = initialPreviewState;
    this.materialPreviewPanel = new MaterialPreviewPanel(host, options, atlases, {
      onStateChange: (state) => this.handleMaterialPreviewChange(state),
      onReset: () => this.finishVisualPreview(),
      onSavePreset: (slot) => this.saveVisualPreviewPreset(slot),
      onRecallPreset: (slot) => this.recallVisualPreviewPreset(slot),
    }, this.materialPreviewState, document.getElementById('material-preview-actions') ?? undefined);
    // The preview workbench opens with the default floor direction visible in the scene.
    // This remains an in-memory preview; finishVisualPreview() restores the official scheme.
    this.applyMaterialPreviewState(initialPreviewState, false);
  }

  private makeMaterialPreviewState(scheme: CurrentScheme): MaterialPreviewPanelState {
    const floorId = scheme.selections.floor?.default
      ?? this.topics.find((topic) => topic.id === 'floor')?.options[0]?.id
      ?? '';
    const paintId = scheme.selections.paint?.default;
    const paintOption = this.topics.find((topic) => topic.id === 'paint')?.options.find((option) => option.id === paintId);
    const paintData = paintOption?.data as Record<string, unknown> | undefined;
    const paintAppearance = paintData?.appearance as MaterialAppearance | undefined;
    const floorAppearance = this.getFloorAppearance(floorId);
    const floorRoughness = typeof floorAppearance?.roughness === 'number'
      ? floorAppearance.roughness
      : floorAppearance?.finish === 'soft' ? 0.5 : 0.85;
    return {
      floorId,
      floorMode: 'procedural',
      atlasId: this.materialPreviewAtlases[0]?.id ?? null,
      floorMattePercent: Math.round(floorRoughness * 100),
      floorRotationDeg: 0,
      paintColor: paintAppearance?.color ?? '#f7f5ef',
      paintLabel: paintOption?.name ?? '自定义预演色',
    };
  }

  private getFloorAppearance(optionId: string): MaterialAppearance | undefined {
    const option = this.topics.find((topic) => topic.id === 'floor')?.options.find((item) => item.id === optionId);
    const data = option?.data as Record<string, unknown> | undefined;
    return data?.appearance as MaterialAppearance | undefined;
  }

  private getPreviewFloorAppearance(optionId: string, state?: MaterialPreviewPanelState): MaterialAppearance | undefined {
    const base = this.getFloorAppearance(optionId);
    if (!base || !state) return base;
    const directionDeg = Number.isFinite(state.floorRotationDeg)
      ? Math.min(90, Math.max(0, state.floorRotationDeg))
      : 0;
    // The preview control is direction-oriented: 0° means north-south, while
    // TextureManager's UV rotation 0° keeps planks east-west.
    const textureRotationDeg = 90 - directionDeg;
    if (optionId !== state.floorId) return { ...base, rotationDeg: textureRotationDeg };
    const atlas = state.atlasId ? this.materialPreviewAtlases.find((candidate) => candidate.id === state.atlasId) : undefined;
    return {
      ...base,
      mode: state.floorMode,
      roughness: state.floorMattePercent / 100,
      rotationDeg: textureRotationDeg,
      ...(state.floorMode === 'manufacturer_atlas' && atlas ? { manufacturerAtlas: atlas.atlas } : {}),
    };
  }

  private handleMaterialPreviewChange(state: MaterialPreviewPanelState): void {
    const paintChanged = this.materialPreviewState !== null
      && state.paintColor !== this.materialPreviewState.paintColor;
    this.applyMaterialPreviewState(state, this.visualPreviewPaintActive || paintChanged);
  }

  private applyMaterialPreviewState(state: MaterialPreviewPanelState, applyPaint: boolean): void {
    this.materialPreviewState = { ...state };
    const floorSelection = this.officialScheme?.selections.floor;
    const roomOverrides = floorSelection?.roomOverrides ?? {};
    const defaultAppearance = this.getPreviewFloorAppearance(state.floorId, state);
    try {
      if (!defaultAppearance) throw new Error(`unknown floor preview option: ${state.floorId}`);
      for (const roomId of this.houseScene.getAllRoomIds()) {
        const roomOptionId = roomOverrides[roomId] ?? state.floorId;
        const appearance = this.getPreviewFloorAppearance(roomOptionId, state);
        if (appearance) this.houseScene.setFloorMaterial(roomId, appearance);
      }
      this.houseScene.applyFloorRegionMaterials(defaultAppearance, (roomId) => {
        const roomOptionId = roomOverrides[roomId];
        return roomOptionId ? this.getPreviewFloorAppearance(roomOptionId, state) ?? null : null;
      });
      if (applyPaint) {
        // setPaintColor targets only non-tile wall faces; ceilings and the saved paint selection are untouched.
        this.houseScene.setPaintColor(state.paintColor);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[material preview] failed', error);
      this.finishVisualPreview();
      this.showToast(`材料预演不可用：${message}`);
      return;
    }
    this.visualPreviewActive = true;
    this.visualPreviewPaintActive = applyPaint;
    this.syncMaterialPreviewPanel();
    this.requestRender();
  }

  private captureVisualPreviewSnapshot(): VisualPreviewSnapshot {
    const scheme = this.officialScheme;
    const material = this.materialPreviewState ?? (scheme ? this.makeMaterialPreviewState(scheme) : {
      floorId: '', floorMode: 'procedural' as const, atlasId: null, floorMattePercent: 85, floorRotationDeg: 0, paintColor: '#f7f5ef', paintLabel: '自定义预演色',
    });
    return {
      material: { ...material },
      paintPreviewActive: this.visualPreviewPaintActive,
      lighting: this.getLightingPreviewState(),
      sunlight: {
        enabled: this.sunlightEnabled,
        month: this.sunlightSystem?.getDate().month ?? 12,
        day: this.sunlightSystem?.getDate().day ?? 22,
        hour: this.sunlightSystem?.getHour() ?? 12,
      },
    };
  }

  private saveVisualPreviewPreset(slot: PreviewSlot): void {
    this.visualPreviewSlots[slot] = this.captureVisualPreviewSnapshot();
    this.syncMaterialPreviewPanel();
  }

  private recallVisualPreviewPreset(slot: PreviewSlot): void {
    const snapshot = this.visualPreviewSlots[slot];
    if (!snapshot) return;
    this.applySunlightPreviewState(snapshot.sunlight);
    this.applyMaterialPreviewState(snapshot.material, snapshot.paintPreviewActive);
    this.applyLightingPreviewState(snapshot.lighting);
  }

  private applySunlightPreviewState(state: VisualPreviewSnapshot['sunlight']): void {
    if (this.sunlightEnabled !== state.enabled) this.setSunlightEnabled(state.enabled);
    this.sunlightSystem?.setDate(state.month, state.day);
    this.sunlightSystem?.setHour(state.hour);
    this.sunlightPanel.setDateDisplay(state.month, state.day);
    this.sunlightPanel.setHourDisplay(state.hour);
    this.requestRender();
  }

  private applyLightingPreviewState(state: LightingPreviewState): void {
    const lights = this.interiorLighting;
    if (!lights) return;
    lights.clearPreviewOverrides();
    lights.setPreviewMode(state.mode, state.manualOn);
    this.houseScene.getEnvironmentManager().setInteriorOnlyNightPreview(state.mode === 'manual');
    lights.setPreviewTemperature(state.temperatureK);
    lights.setPreviewColorAppearanceMode(state.colorAppearance ?? 'eye-adapted');
    lights.setPreviewBrightness(state.brightness);
    const enabledByRoom = new Map(state.rooms.map((room) => [room.id, room.enabled]));
    for (const room of lights.getPreviewRooms()) {
      if (enabledByRoom.get(room.id) === false) lights.setRoomLights(room.id, false);
    }
    this.syncLightingPreviewPanel();
    this.requestRender();
  }

  private finishVisualPreview(): void {
    this.visualPreviewActive = false;
    this.visualPreviewPaintActive = false;
    this.interiorLighting?.clearPreviewOverrides();
    this.houseScene.getEnvironmentManager().setInteriorOnlyNightPreview(false);
    if (this.officialScheme) this.applyScheme(this.officialScheme);
    this.materialPreviewState = this.officialScheme ? this.makeMaterialPreviewState(this.officialScheme) : null;
    if (this.materialPreviewState) this.syncMaterialPreviewPanel();
    this.syncLightingPreviewPanel();
    this.houseScene.requestShadowUpdate();
    this.requestRender();
  }

  private syncMaterialPreviewPanel(): void {
    if (!this.materialPreviewPanel || !this.materialPreviewState) return;
    this.materialPreviewPanel.update(this.materialPreviewState, {
      A: this.visualPreviewSlots.A !== null,
      B: this.visualPreviewSlots.B !== null,
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
      const { x: centerX, y: centerY } = this.getCanvasCenter();
      const pos = this.houseScene.getGroundPosition(centerX, centerY);
      if (pos) {
        this.houseScene.showGhost(pos.x, pos.z, 0, type);
        this.requestRender();
      }
    });
  }

  /** Resolve the authored house.yaml index, even when the phase view has
   * removed count-only or deferred entries before rendering. */
  private getFurnitureWriteIndex(objectId: string): number | null {
    const position = this.houseScene.getFurniturePosition(objectId);
    // A render index is only an object-id/display detail.  It is not safe to
    // use it as a write index after phase filtering has removed earlier items.
    return position?.sourceIndex ?? null;
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
    this.syncLayersSummary(true);
    this.requestRender();
  }

  private setHvacCoordinationState(state: HvacCoordinationButtonState): void {
    this.hvacCoordinationState = state;
    if (state !== 'ready') {
      this.hvacCoordinationVisible = false;
      this.houseScene.setHvacCoordinationVisible(false);
    }
    this.hvacCoordinationButton?.sync();
    this.syncLayersSummary();
  }

  private setupWallTileButton(): void {
    this.wallTileButton = new WallTileButton({
      onToggle: () => this.setWallTileInspectionVisible(!this.wallTileVisible),
      getState: () => this.wallTileState,
      getActive: () => this.wallTileVisible,
    });
  }

  private setWallTileInspectionVisible(visible: boolean, announce = true): void {
    this.wallTileVisible = this.wallTileState === 'ready' && visible;
    this.houseScene.setWallTileInspectionVisible(this.wallTileVisible);
    this.wallTileButton?.sync();
    this.syncLayersSummary(true);
    this.requestRender();
    // 打开时同步播报数字摘要：3D 透视看不出准确高度（0.3m 与 1.8m 在广角下都像墙根一条带），
    // 所以「图」与「数」必须同时给出，避免拿眼睛当尺子（DEC-2026-10-07-R09）。
    if (this.wallTileVisible && announce) {
      const s = this.houseScene.getWallTileInspectionStatus();
      const rooms = Object.entries(s.byRoom).map(([r, v]) => `${r} ${v.lengthM.toFixed(2)}m`).join(' · ');
      const tiers = Object.entries(s.byHeightTier)
        .sort((a, b) => Number(b[0]) - Number(a[0]))
        .map(([h, v]) => `${h}m×${v.segments}段`).join(' / ');
      this.showToast(`贴砖区：${rooms}｜高度 ${tiers}｜${s.totalAreaSqm.toFixed(2)}㎡（可见 ${s.visibleAreaSqm.toFixed(2)} / 遮蔽 ${s.coveredAreaSqm.toFixed(2)}）`);
    }
  }

  private setWallTileState(state: WallTileButtonState): void {
    this.wallTileState = state;
    if (state !== 'ready') {
      this.wallTileVisible = false;
      this.houseScene.setWallTileInspectionVisible(false);
    }
    this.wallTileButton?.sync();
    this.syncLayersSummary();
  }

  private setupPaintButton(): void {
    this.paintButton = new PaintButton({
      onToggle: () => this.setPaintInspectionVisible(!this.paintVisible),
      getState: () => this.paintState,
      getActive: () => this.paintVisible,
    });
  }

  private setPaintInspectionVisible(visible: boolean, announce = true): void {
    this.paintVisible = this.paintState === 'ready' && visible;
    this.houseScene.setPaintInspectionVisible(this.paintVisible);
    this.paintButton?.sync();
    this.syncLayersSummary(true);
    this.requestRender();
    // 打开时播报数字摘要：涂漆面到顶，3D 里看不出每面墙归属哪个房间、算不算在涂装范围内，
    // 「图」与「数」必须同时给出（同贴砖检视态 DEC-2026-10-07-R09 的理由）。
    if (this.paintVisible && announce) {
      const s = this.houseScene.getPaintInspectionStatus();
      const rooms = Object.entries(s.byRoom).map(([r, v]) => `${r} ${v.lengthM.toFixed(2)}m`).join(' · ');
      // 顶面涂装只在成本口径里单列（/api/budget 的 paintBudgetPreview），未在本 3D 层显示；
      // 预算是异步拉的，取不到就只报墙面，不猜数。
      const ceiling = (this.lastBudget as (BudgetSnapshot & { paintBudgetPreview?: { scope?: { ceilingAreaSqm?: number } } }) | null)
        ?.paintBudgetPreview?.scope?.ceilingAreaSqm;
      const ceilingText = typeof ceiling === 'number'
        ? `｜顶面 ${ceiling.toFixed(2)}㎡（成本口径，未在 3D 显示）`
        : '';
      // 净面积口径（DEC-2026-10-08-C06）：门洞已按实扣除，高亮范围 == 计费范围
      const gapText = s.gapAreaSqm > 0 ? `（已扣门洞 ${s.gapAreaSqm.toFixed(2)}㎡）` : '';
      // 构件面（上飘窗外露面）单独列：湿区完整系统/基层/人工都还没报价，
      // 既不能漏报（3D 里确实高亮了），也不能并进净墙面（那就按普通漆计价了）。
      const componentText = s.componentAreaSqm > 0
        ? `｜上飘窗外露面 ${s.componentAreaSqm.toFixed(3)}㎡（湿区待分项报价，未计入净墙面）`
        : '';
      this.showToast(`涂漆区：${rooms}｜净墙面 ${s.wallAreaSqm.toFixed(2)}㎡${gapText}${ceilingText}${componentText}`);
    }
  }

  private setPaintState(state: PaintButtonState): void {
    this.paintState = state;
    if (state !== 'ready') {
      this.paintVisible = false;
      this.houseScene.setPaintInspectionVisible(false);
    }
    this.paintButton?.sync();
    this.syncLayersSummary();
  }

  // ─── 吊顶分区高亮（DEC-2026-10-08-C01）───
  // 与贴砖检视态完全平级：自己的按钮、自己的面板、自己的开关函数；不引用 HVAC/MEP/贴砖。

  private setupCeilingZoneButton(): void {
    this.ceilingZoneButton = new CeilingZoneButton({
      onToggle: () => this.setCeilingZoneHighlightVisible(!this.ceilingZoneVisible),
      getState: () => this.ceilingZoneState,
      getActive: () => this.ceilingZoneVisible,
    });
  }

  private setCeilingZoneHighlightVisible(visible: boolean, announce = true): void {
    this.ceilingZoneVisible = this.ceilingZoneState === 'ready' && visible;
    this.houseScene.setCeilingZoneHighlightVisible(this.ceilingZoneVisible);
    this.ceilingZoneButton?.sync();
    this.syncLayersSummary(true);
    this.requestRender();
    if (this.ceilingZoneVisible) {
      this.ceilingZonePanel?.show();
      // 开启即播报：3D 里「看得出一块吊顶」不等于「量得出多少面积」，图与数必须同时给出。
      const s = this.houseScene.getCeilingZoneHighlightStatus();
      const classes = Object.entries(s.byClass)
        .filter(([, v]) => v.zones > 0)
        .map(([k, v]) => `${TRADE_LABEL[k as keyof typeof TRADE_LABEL] ?? k} ${v.netAreaM2.toFixed(2)}㎡`
          + `${k === 'curtain_box' && v.linearM > 0 ? `/${v.linearM.toFixed(2)}m` : ''}`
          + `${v.panelCount > 0 ? `/${v.panelCount}块` : ''}`)
        .join(' · ');
      if (announce) {
        this.showToast(
          `吊顶分区 ${s.zonesInScene} 个：净 ${s.totalNetAreaM2.toFixed(2)}㎡（展开 ${s.totalExpandedAreaM2.toFixed(2)}㎡）｜${classes}`
          + `${s.unclassifiedZoneIds.length > 0 ? `｜未归类 ${s.unclassifiedZoneIds.join('、')}` : ''}`
        );
      }
      this.ceilingZonePanel?.refresh();
    } else {
      this.ceilingZonePanel?.hide();
    }
  }

  private setCeilingZoneState(state: CeilingZoneButtonState): void {
    this.ceilingZoneState = state;
    if (state !== 'ready') {
      this.ceilingZoneVisible = false;
      this.houseScene.setCeilingZoneHighlightVisible(false);
    }
    this.ceilingZoneButton?.sync();
    this.syncLayersSummary();
  }

  // ─── 构件级工程状态高亮（DEC-2026-10-09-E01）───
  // 与吊顶分区高亮平级：自己的按钮、面板、开关函数；不引用 HVAC/MEP/贴砖/吊顶。
  // 差别只在数据来源（异步 fetch）与合批 split（后者在 HouseScene 内部，App 不感知）。

  /** 按需把 #element-state-btn 注入图层抽屉（跟在吊顶分区按钮后）；保持所有 DOM 改动在 app/src 内。 */
  private ensureElementStateButton(): void {
    if (document.getElementById('element-state-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'element-state-btn';
    btn.title = '构件工程状态高亮：按 /api/element-state 给每个构件上「确认了吗 / 卡在谁 / 和谁冲突」的状态色（电气/给排水为合批渲染，以状态标记层显示）；显示层，权威状态见 npm run state:project';
    btn.disabled = true;
    btn.textContent = '工程状态';
    const anchor = document.getElementById('ceiling-zone-btn');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    else document.getElementById('layers-panel')?.appendChild(btn);
  }

  private setupElementStateButton(): void {
    this.ensureElementStateButton();
    this.elementStateButton = new ElementStateButton({
      onToggle: () => this.setElementStateHighlightVisible(!this.elementStateVisible),
      getState: () => this.elementStateState,
      getActive: () => this.elementStateVisible,
    });
  }

  /** 拉 /api/element-state（带 conflicts=1 让 conflicted 也显示）→ 注入 HouseScene。
   *  失败/无数据静默降级为「不可用」：服务端可能还没上这个端点，不弹错误刷屏。 */
  private async loadElementStates(): Promise<void> {
    try {
      const response = await fetch('/api/element-state?conflicts=1');
      if (!response.ok) throw new Error(`element-state ${response.status}`);
      const payload = await response.json() as { states?: ElementStateLike[] };
      const states = Array.isArray(payload.states) ? payload.states : [];
      if (states.length === 0) {
        this.setElementStateState('unavailable');
        return;
      }
      this.houseScene.setElementStates(states);
      this.setElementStateState('ready');
    } catch {
      this.setElementStateState('unavailable');
    }
  }

  private setElementStateHighlightVisible(visible: boolean): void {
    this.elementStateVisible = this.elementStateState === 'ready' && visible;
    this.houseScene.setElementStateHighlightVisible(this.elementStateVisible);
    this.elementStateButton?.sync();
    this.syncLayersSummary(true);
    this.requestRender();
    if (this.elementStateVisible) {
      this.elementStatePanel?.show();
      this.elementStatePanel?.refresh();
      // 开启即播报数字摘要：3D 里「看得出一片色」不等于「数得出几个待决/冲突」。
      const s = this.houseScene.getElementStateHighlightStatus();
      this.showToast(
        `构件状态 ${s.total} 个：已确认 ${s.byStatus.confirmed ?? 0} · 推断 ${s.byStatus.inferred ?? 0}`
        + ` · 待现场 ${s.pending} · 未申报 ${s.undeclared} · 冲突 ${s.conflicted}`,
      );
    } else {
      this.elementStatePanel?.hide();
    }
  }

  private setElementStateState(state: ElementStateButtonState): void {
    this.elementStateState = state;
    if (state !== 'ready') {
      this.elementStateVisible = false;
      this.houseScene.setElementStateHighlightVisible(false);
    }
    this.elementStateButton?.sync();
    this.syncLayersSummary();
  }

  private setupCeilingQuoteButton(): void {
    this.ceilingQuoteButton = new CeilingQuoteButton({
      onToggle: () => {
        this.ceilingQuoteVisible = !this.ceilingQuoteVisible;
        if (this.ceilingQuoteVisible) this.ceilingQuotePanel?.show();
        else this.ceilingQuotePanel?.hide();
        this.ceilingQuoteButton?.sync();
      },
      getActive: () => this.ceilingQuoteVisible,
    });
  }

  // ─── 顶栏收敛：图层抽屉 / 告警聚合 / 弹出面板 ───
  // 编排只发生在 UI 层：这里通过各平级 setter 组合调用，不绕过它们碰场景或互相引用。

  /** 检视层 ready/active 谓词：图层抽屉与命令注册表共用，禁止两处各写一份。 */
  private buildLayerDescriptors(): LayerDescriptor[] {
    return [
      { key: 'mep_overview', isReady: () => this.hvacCoordinationState === 'ready' || this.mepCoordinationReady, isActive: () => this.mepOverviewVisible },
      { key: 'mep_coordination', isReady: () => this.mepCoordinationReady, isActive: () => this.mepCoordinationVisible },
      { key: 'hvac', isReady: () => this.hvacCoordinationState === 'ready', isActive: () => this.hvacCoordinationVisible },
      { key: 'electrical_topology', isReady: () => this.electricalTopology !== null, isActive: () => this.electricalTopologyVisible || this.mepOverviewVisible },
      { key: 'wall_tile', isReady: () => this.wallTileState === 'ready', isActive: () => this.wallTileVisible },
      { key: 'paint', isReady: () => this.paintState === 'ready', isActive: () => this.paintVisible },
      { key: 'ceiling_zone', isReady: () => this.ceilingZoneState === 'ready', isActive: () => this.ceilingZoneVisible },
    ];
  }

  private setupLayersPanel(): void {
    this.layersPanel = new LayersPanel({
      layers: this.buildLayerDescriptors(),
      onClearAll: () => this.clearAllLayers(),
      onApplyCombo: (keys) => this.applyLayerCombo(keys),
      group: 'toolbar',
      onToggle: () => this.surfaceManager.toggle('layers'),
    });
    this.layersPanel.sync();
  }

  /**
   * 命令注册表：唯一命令源。顶栏（桌面）、tab bar（移动端）、命令面板、快捷键提示
   * 四处全部从这里渲染。run 一律委托上面的命令处理器，不重写业务逻辑；
   * 检视层的 available/getActive 与图层抽屉共用 buildLayerDescriptors() 谓词。
   */
  /** 刷新恢复：工作台开合与活跃页（瞬态不恢复——那些默认就是收起的）。 */
  private restorePersistedViewState(): void {
    const persisted = readViewState();
    this.previewWorkbench.onChange = (state) => writeViewState({
      workbenchOpen: state.open,
      workbenchPage: state.page,
    });
    if (persisted.workbenchOpen) {
      this.previewWorkbench.setOpen(true, false);
      if (persisted.workbenchPage) this.previewWorkbench.activate(persisted.workbenchPage, false);
    }
    // 检视层组合：存档存在则启动自动恢复（替代手动点「上次组合」）
    const combo = this.layersPanel?.getSavedCombo() ?? [];
    if (combo.length > 0) {
      this.pendingComboRestore = combo;
      this.tryLayerComboRestore();
    }
  }

  /** 存档里的层全部就绪后才应用；未就绪则等 syncLayersSummary 再试。 */
  private tryLayerComboRestore(): void {
    const combo = this.pendingComboRestore;
    if (!combo) return;
    const descriptors = this.buildLayerDescriptors();
    const notReady = combo.filter((key) => {
      const d = descriptors.find((x) => x.key === key);
      return d ? !d.isReady() : false;
    });
    if (notReady.length > 0) return;
    this.pendingComboRestore = null;
    this.applyLayerCombo(combo);
  }

  /** 全局就绪指示：替代原先散落在按钮文案里的「：加载中」。 */
  private syncDataReadyChip(): void {
    const chip = document.getElementById('data-ready-chip');
    if (!chip) return;
    chip.hidden = this.readyState !== 'ready';
    chip.textContent = this.readyState === 'ready' ? '数据就绪' : '';
    chip.title = this.readyState === 'ready'
      ? '户型与检视层数据已加载；未就绪的检视层按钮保持禁用'
      : '';
  }

  private setupCommandRegistry(): void {
    const layerOf = (key: LayerKey) => this.buildLayerDescriptors().find((l) => l.key === key)!;
    const layerCommand = (key: LayerKey, label: string, engineeringNote: string, digit: string): Command => {
      const descriptor = layerOf(key);
      return {
        id: `layer.${key}`,
        label,
        engineeringNote,
        category: '检视',
        shortcut: { code: `Digit${digit}` },
        available: descriptor.isReady,
        unavailableReason: '该检视层数据未就绪',
        run: () => this.toggleLayerByKey(key),
        getActive: descriptor.isActive,
      };
    };

    this.commandRegistry.registerAll([
      // 视角
      {
        id: 'view.toggle_mode',
        label: '切换视角模式',
        engineeringNote: '轨道 ↔ 第一人称；第一人称需 pointer lock（移动端为拖拽+摇杆）',
        category: '视角',
        shortcut: { code: 'KeyV' },
        run: () => this.toggleMode(),
      },
      {
        id: 'view.topdown',
        label: '俯视',
        engineeringNote: '正俯视平面图（T）',
        category: '视角',
        shortcut: { code: 'KeyT' },
        run: () => this.toggleTopDownView(),
      },
      {
        id: 'overview.open',
        label: '总览菜单',
        engineeringNote: '布局切换 / 阶段方案 / 当前方案 / 窗帘 / 决策记录 / 预算 / 风险 / 归档',
        category: '视角',
        shortcut: { code: 'KeyM' },
        run: () => this.toggleOverviewMenu(),
        getActive: () => this.overviewMenu.isVisible(),
      },

      // 方案
      {
        id: 'scheme.export_glb',
        label: '导出 glb',
        engineeringNote: '云渲染用；HVAC 协调 routes 已排除',
        category: '方案',
        run: () => { void this.handleExportGlb(); },
      },

      // 检视
      layerCommand('mep_overview', '机电总览', '一键显示吊顶、点位、HVAC 与全部 MEP 路线', '1'),
      layerCommand('mep_coordination', '水电走向', 'MEP 实体路线：仅表示走向，非施工路径', '2'),
      layerCommand('hvac', '空调设备', 'HVAC 设备/约束（不显示实体路线）', '3'),
      layerCommand('electrical_topology', '电路归属', '电气回路归属：面板—回路—点位归属，非电缆/线管/施工路径', '4'),
      layerCommand('wall_tile', '贴砖', '贴砖检视态：厨卫已声明贴砖区（可见面蓝 / 遮蔽面橙）', '5'),
      layerCommand('paint', '涂漆', '涂漆检视态：已声明涂漆墙面（按房间外偏移避免共面）', '6'),
      layerCommand('ceiling_zone', '吊顶', '吊顶分区高亮：按 config/ceiling.yaml 逐分区声明上色', '7'),
      {
        id: 'layer.clear_all',
        label: '关闭全部检视层',
        engineeringNote: '不覆盖「上次组合」存档',
        category: '检视',
        shortcut: { code: 'Digit0' },
        run: () => this.clearAllLayers(),
      },
      {
        id: 'layer.restore_combo',
        label: '恢复上次图层组合',
        engineeringNote: '恢复上一次保存的检视层组合',
        category: '检视',
        run: () => this.layersPanel?.applyLastCombo(),
      },

      // 环境
      {
        id: 'env.sunlight',
        label: '日照模拟',
        engineeringNote: '日期 / 时刻 / 播放 / 热力图',
        category: '环境',
        run: () => {
          this.envPopover?.close();
          this.setSunlightEnabled(!this.sunlightEnabled);
        },
        getActive: () => this.sunlightEnabled,
      },
      {
        id: 'env.humidity',
        label: '湿度风险',
        engineeringNote: '回南天窗口湿度风险',
        category: '环境',
        run: () => {
          void this.humidityOverlay?.toggle().then(() => {
            this.humidityButton?.sync();
            this.requestRender();
          });
        },
        getActive: () => this.humidityOverlay?.isActive() ?? false,
      },

      // 工具
      {
        id: 'tool.measurement',
        label: '测量',
        engineeringNote: '轨道模式点击两点测距',
        category: '工具',
        run: () => this.toggleMeasurementTool(),
        getActive: () => this.analysisTools.measurement.active,
      },
      {
        id: 'tool.lights',
        label: '室内灯光',
        engineeringNote: '室内照明总开关',
        category: '工具',
        shortcut: { code: 'KeyL' },
        available: () => this.interiorLighting !== null,
        unavailableReason: '室内灯光配置不可用',
        run: () => this.toggleInteriorLights(),
      },
      {
        id: 'tool.xray',
        label: '透视图',
        engineeringNote: 'X-ray 透视（轨道模式）',
        category: '工具',
        shortcut: { code: 'KeyX' },
        available: () => this.houseScene.mode === 'orbit',
        unavailableReason: '仅轨道模式可用',
        run: () => this.toggleSeeThroughView(),
      },
      {
        id: 'tool.curtains',
        label: '全屋窗帘',
        engineeringNote: '循环 open → privacy → blackout',
        category: '工具',
        shortcut: { code: 'KeyC' },
        run: () => this.cycleCurtainState(),
      },
      {
        id: 'tool.annotations',
        label: '标注标签',
        engineeringNote: '问题标注标签显隐',
        category: '工具',
        shortcut: { code: 'KeyP' },
        run: () => this.toggleAnnotations(),
        getActive: () => this.annotationGroupVisible,
      },

      // 设置
      {
        id: 'settings.glass_fidelity',
        label: '玻璃质感',
        engineeringNote: '高保真玻璃 transmission：draw call 翻倍，仅导出/取证时开启',
        category: '设置',
        run: () => this.setGlassHighFidelity(!this.houseScene.getGlassHighFidelity()),
        getActive: () => this.houseScene.getGlassHighFidelity(),
      },

      // 工程（第一人称编辑态；桌面专属约束在 Step 4 由 available 收紧）
      {
        id: 'edit.furniture_panel',
        label: '家具面板',
        engineeringNote: '选择家具类型进入摆放模式',
        category: '工程',
        shortcut: { code: 'KeyB' },
        available: () => this.houseScene.mode === 'first-person' && !this.capabilities.touchPrimary,
        unavailableReason: this.capabilities.touchPrimary ? '编辑功能仅桌面端可用' : '仅第一人称模式可用',
        run: () => this.toggleFurniturePanel(),
      },
      {
        id: 'edit.place_point',
        label: '新增电气/给排水点位',
        engineeringNote: '进入点位摆放模式',
        category: '工程',
        shortcut: { code: 'KeyE' },
        available: () => this.houseScene.mode === 'first-person' && !this.capabilities.touchPrimary,
        unavailableReason: this.capabilities.touchPrimary ? '编辑功能仅桌面端可用' : '仅第一人称模式可用',
        run: () => this.togglePlacementPanel(),
      },
      {
        id: 'edit.drag',
        label: '拖拽选中物体',
        engineeringNote: '第一人称下拖拽准星对准的家具/点位',
        category: '工程',
        shortcut: { code: 'KeyG' },
        available: () => this.houseScene.mode === 'first-person' && !this.capabilities.touchPrimary,
        unavailableReason: this.capabilities.touchPrimary ? '编辑功能仅桌面端可用' : '仅第一人称模式可用',
        run: () => this.enterDragForHovered(),
      },
      {
        id: 'edit.delete_point',
        label: '删除选中点位',
        engineeringNote: '删除准星对准的电气/给排水点位',
        category: '工程',
        shortcut: { code: 'Delete' },
        available: () => this.houseScene.mode === 'first-person' && !this.capabilities.touchPrimary,
        unavailableReason: this.capabilities.touchPrimary ? '编辑功能仅桌面端可用' : '仅第一人称模式可用',
        run: () => { void this.deleteHoveredPoint(); },
      },
    ]);

    window.addEventListener('command-unavailable', ((e: CustomEvent<{ label?: string; reason?: string }>) => {
      const label = e.detail?.label ?? '命令';
      const reason = e.detail?.reason;
      this.showToast(reason ? `${label}：${reason}` : `${label}当前不可用`);
    }) as EventListener);
  }

  /**
   * 控制面注册：一次只开一个、点画布即收、可钉住、Esc 一键清场。
   * 只编排开合——各面板的 open/close/isOpen 由既有组件提供，element id 与
   * body class 契约不变。命令面板/家具/点位面板用自建容器（固定 id）。
   */
  private setupSurfaces(): void {
    this.viewPopover = new Popover('view-toggle-btn', 'view-panel', { group: 'toolbar', onToggle: () => this.surfaceManager.toggle('view') });
    document.getElementById('view-orbit-btn')?.addEventListener('click', () => {
      if (this.houseScene.isTopDown()) this.toggleTopDownView();
      else if (this.houseScene.mode !== 'orbit') this.toggleMode();
      this.surfaceManager.close('view');
      this.syncViewPanelOptions();
    });
    document.getElementById('view-fp-btn')?.addEventListener('click', () => {
      if (this.houseScene.mode !== 'first-person') this.toggleMode();
      this.surfaceManager.close('view');
      this.syncViewPanelOptions();
    });

    this.surfaceManager.registerAll([
      {
        id: 'scheme',
        slot: 'left-drawer',
        el: document.getElementById('scheme-panel'),
        toggleEl: document.getElementById('scheme-toggle-btn'),
        open: () => this.schemePanel.setPanelOpen(true),
        close: () => this.schemePanel.setPanelOpen(false),
        isOpen: () => this.schemePanel.isPanelOpen(),
      },
      {
        id: 'workbench',
        slot: 'right-dock',
        el: document.getElementById('right-panel-stack'),
        toggleEl: document.getElementById('workbench-reopen'),
        open: () => this.previewWorkbench.setOpen(true),
        close: () => this.previewWorkbench.setOpen(false),
        isOpen: () => this.previewWorkbench.isOpen(),
      },
      {
        id: 'overview',
        slot: 'modal',
        el: document.getElementById('overview-menu'),
        toggleEl: document.getElementById('overview-toggle-btn'),
        open: () => { void this.refreshOverviewData(); this.overviewMenu.show(); },
        close: () => this.overviewMenu.hide(),
        isOpen: () => this.overviewMenu.isVisible(),
      },
      {
        id: 'view',
        slot: 'popover',
        el: document.getElementById('view-panel'),
        toggleEl: document.getElementById('view-toggle-btn'),
        open: () => { this.viewPopover?.openPanel(); this.syncViewPanelOptions(); },
        close: () => this.viewPopover?.close(),
        isOpen: () => this.viewPopover?.isOpen() ?? false,
      },
      {
        id: 'layers',
        slot: 'popover',
        el: document.getElementById('layers-panel'),
        toggleEl: document.getElementById('layers-toggle-btn'),
        open: () => this.layersPanel?.open(),
        close: () => this.layersPanel?.close(),
        isOpen: () => this.layersPanel?.isOpen() ?? false,
      },
      {
        id: 'env',
        slot: 'popover',
        el: document.getElementById('env-panel'),
        toggleEl: document.getElementById('env-toggle-btn'),
        open: () => this.envPopover?.openPanel(),
        close: () => this.envPopover?.close(),
        isOpen: () => this.envPopover?.isOpen() ?? false,
      },
      {
        id: 'alerts',
        slot: 'popover',
        el: document.getElementById('alerts-panel'),
        toggleEl: document.getElementById('alerts-toggle-btn'),
        open: () => this.alertsPopover?.openPanel(),
        close: () => this.alertsPopover?.close(),
        isOpen: () => this.alertsPopover?.isOpen() ?? false,
      },
      {
        id: 'settings',
        slot: 'popover',
        el: document.getElementById('settings-panel'),
        toggleEl: document.getElementById('settings-toggle-btn'),
        open: () => this.settingsPopover?.openPanel(),
        close: () => this.settingsPopover?.close(),
        isOpen: () => this.settingsPopover?.isOpen() ?? false,
      },
      {
        id: 'palette',
        slot: 'modal',
        el: document.getElementById('command-palette'),
        open: () => this.commandPalette.show(),
        close: () => this.commandPalette.hide(),
        isOpen: () => this.commandPalette.isVisible(),
      },
      {
        id: 'furniture',
        slot: 'panel',
        el: document.getElementById('furniture-panel'),
        open: () => this.furniturePanel.show(),
        close: () => this.furniturePanel.hide(),
        isOpen: () => this.furniturePanel.isVisible(),
      },
      {
        id: 'placement',
        slot: 'panel',
        el: document.getElementById('placement-panel'),
        open: () => this.placementPanel.show(),
        close: () => this.placementPanel.hide(),
        isOpen: () => this.placementPanel.isVisible(),
      },
    ]);

    // 钉住 / 收起按钮（index.html 各表面头部，data-surface-pin / data-surface-close）
    document.querySelectorAll<HTMLButtonElement>('[data-surface-pin]').forEach((btn) => {
      const id = btn.getAttribute('data-surface-pin')!;
      btn.addEventListener('click', () => {
        const pinned = !this.surfaceManager.isPinned(id);
        this.surfaceManager.setPinned(id, pinned);
        btn.classList.toggle('pinned', pinned);
        btn.title = pinned ? '已钉住：点画布不收起（Esc 仍可收）' : '钉住：点画布不收起（Esc 仍可收）';
      });
    });
    document.querySelectorAll<HTMLButtonElement>('[data-surface-close]').forEach((btn) => {
      const id = btn.getAttribute('data-surface-close')!;
      btn.addEventListener('click', () => this.surfaceManager.close(id));
    });

    // 方案/总览工具栏入口：没有 Popover 承载 onToggle，直接挂管理器 toggle
    //（2026-10-27 review 修复：这两个按钮此前只作了 toggleEl 声明，从未挂监听）
    document.getElementById('scheme-toggle-btn')?.addEventListener('click', () => {
      this.surfaceManager.toggle('scheme');
      this.syncSurfaceToggleButton('scheme');
    });
    document.getElementById('overview-toggle-btn')?.addEventListener('click', () => {
      this.surfaceManager.toggle('overview');
      this.syncSurfaceToggleButton('overview');
    });

    // 画布清场改 tap 判别（2026-10-27 review 修复）：拖拽旋转/环轨进行中的
    // 面板不再被误收——按下只记录，抬起时判定 tap 才清场
    document.addEventListener('pointerdown', (e: PointerEvent) => this.surfaceDismissIntent.begin(e.clientX, e.clientY));
    document.addEventListener('pointerup', (e: PointerEvent) => {
      if (this.surfaceDismissIntent.end(e.clientX, e.clientY) !== 'tap') return;
      this.surfaceManager.dismissTransient(e.target);
    });

    // 移动端 tab bar：与桌面顶栏同一套 surface id，入口两端共用
    const tabBarRoot = document.getElementById('mobile-tabbar');
    if (tabBarRoot) {
      this.mobileTabBar = new MobileTabBar({
        root: tabBarRoot,
        onSurface: (id) => {
          this.surfaceManager.toggle(id);
          this.mobileTabBar?.sync();
        },
        onPalette: () => this.surfaceManager.toggle('palette'),
        isSurfaceOpen: (id) => this.surfaceManager.isOpen(id),
        getAlertsCount: () => this.getAlertsTotal(),
      });
    }

    // 输入能力 → body.mobile-chrome：CSS 与 JS 共用同一判定（触摸主输入或窄视口）
    // 虚拟摇杆（移动端第一人称）：输出映射进 fpController 的 MovementKeys
    const appRoot = document.getElementById('app');
    if (appRoot && !this.virtualJoystick) {
      this.virtualJoystick = new VirtualJoystick(appRoot);
      this.virtualJoystick.onChange = (x, y) => this.fpController.setStickVector(x, y);
    }
    this.capabilities = readCapabilities();
    this.applyCapabilities(this.capabilities);
    this.unsubscribeCapabilities = subscribeCapabilities((caps) => {
      this.capabilities = caps;
      this.applyCapabilities(caps);
    });
  }

  /** 第一人称的触屏控件：摇杆显隐 + 触摸转向开关（仅触摸主输入）。 */
  private syncFirstPersonTouchControls(): void {
    const touch = this.capabilities.touchPrimary;
    this.fpController.setTouchLookEnabled(touch);
    this.virtualJoystick?.setVisible(touch && this.houseScene.mode === 'first-person');
  }

  private applyCapabilities(caps: InputCapabilities): void {
    const mobile = isMobileChrome(caps);
    document.body.classList.toggle('mobile-chrome', mobile);
    this.mobileTabBar?.setVisible(mobile);
    this.mobileTabBar?.sync();
    this.syncFirstPersonTouchControls();
    this.syncViewPanelOptions();
    this.updateModeIndicator();
  }

  private setupToolbarPopovers(): void {
    this.envPopover = new Popover('env-toggle-btn', 'env-panel', { group: 'toolbar', onToggle: () => this.surfaceManager.toggle('env') });
    this.alertsPopover = new Popover('alerts-toggle-btn', 'alerts-panel', { group: 'toolbar', onToggle: () => this.surfaceManager.toggle('alerts') });
    this.settingsPopover = new Popover('settings-toggle-btn', 'settings-panel', { group: 'toolbar', onToggle: () => this.surfaceManager.toggle('settings') });
    document.getElementById('alert-row-mep')?.addEventListener('click', () => {
      this.setMepCoordinationLayerVisible(true);
    });
    document.getElementById('alert-row-electrical')?.addEventListener('click', () => {
      this.setElectricalTopologyVisible(true);
    });
    this.syncAlertsSummary();
  }

  private syncLayersSummary(persist = false): void {
    // 全关/恢复组合期间抑制持久化：清空不是一次"手动组合"，不应覆盖「上次组合」存档
    this.layersPanel?.sync(persist && !this.layerComboSuppressed);
    this.tryLayerComboRestore();
  }

  /** 顶栏 ⚠ 徽章：聚合 MEP lint 与电气回路 lint 的告警计数（口径不同，明细在面板里分列）。 */
  private getAlertsTotal(): number {
    const mepCounts = this.mepLintResult?.counts;
    const elecCounts = this.electricalTopology?.lint?.counts;
    return (mepCounts?.errors ?? 0) + (mepCounts?.warnings ?? 0) + (elecCounts?.warnings ?? 0);
  }

  private syncAlertsSummary(): void {
    const mepCounts = this.mepLintResult?.counts;
    const elecCounts = this.electricalTopology?.lint?.counts;
    const mepErrors = mepCounts?.errors ?? 0;
    const mepWarnings = mepCounts?.warnings ?? 0;
    const elecWarnings = elecCounts?.warnings ?? 0;
    const total = mepErrors + mepWarnings + elecWarnings;
    const btn = document.getElementById('alerts-toggle-btn');
    if (btn) {
      btn.hidden = total === 0;
      btn.classList.toggle('alerts-error', mepErrors > 0);
      btn.title = mepErrors > 0
        ? `检视层问题：MEP lint error ${mepErrors} / warning ${mepWarnings}；电气回路 warning ${elecWarnings}`
        : `检视层问题：MEP lint warning ${mepWarnings}；电气回路 warning ${elecWarnings}`;
    }
    const countEl = document.getElementById('alerts-count');
    if (countEl) countEl.textContent = String(total);
    const mepDetail = document.getElementById('alert-mep-detail');
    if (mepDetail) {
      mepDetail.textContent = mepCounts
        ? `✗ ${mepErrors} · ⚠ ${mepWarnings} · 路线 resolved ${mepCounts.resolvedRoutes}/${mepCounts.routes}`
        : '未就绪';
    }
    const elecDetail = document.getElementById('alert-electrical-detail');
    if (elecDetail) {
      elecDetail.textContent = elecCounts
        ? `${elecCounts.circuits} 条回路 · ⚠ ${elecWarnings} · 未覆盖 ${elecCounts.uncoveredPoints}`
        : '未就绪';
    }
    this.mobileTabBar?.sync();
  }

  /** 视角面板选项的激活态（轨道/第一人称；俯视由 TopDownButton 自己同步）。 */
  private syncViewPanelOptions(): void {
    document.getElementById('view-orbit-btn')?.classList.toggle('on', this.houseScene.mode === 'orbit' && !this.houseScene.isTopDown());
    document.getElementById('view-fp-btn')?.classList.toggle('on', this.houseScene.mode === 'first-person');
  }

  /** 全关：逐个调用平级 setter；未就绪的层由 setter 自身的 ready 钳制兜住。不覆盖「上次组合」存档。 */
  private clearAllLayers(): void {
    this.layerComboSuppressed = true;
    try {
      this.setMepOverviewVisible(false);
      this.setMepCoordinationLayerVisible(false);
      this.setHvacCoordinationVisible(false);
      this.setElectricalTopologyVisible(false);
      this.setWallTileInspectionVisible(false);
      this.setPaintInspectionVisible(false);
      this.setCeilingZoneHighlightVisible(false);
      this.setElementStateHighlightVisible(false);
    } finally {
      this.layerComboSuppressed = false;
    }
    this.syncLayersSummary();
  }

  private applyLayerCombo(keys: LayerKey[]): void {
    this.clearAllLayers();
    this.layerComboSuppressed = true;
    try {
      for (const key of keys) this.toggleLayerByKey(key, { announce: false });
    } finally {
      this.layerComboSuppressed = false;
    }
    this.syncLayersSummary(true);
  }

  private toggleLayerByKey(key: LayerKey, opts: { announce?: boolean } = {}): void {
    const announce = opts.announce ?? true;
    switch (key) {
      case 'mep_overview': this.setMepOverviewVisible(!this.mepOverviewVisible); return;
      case 'mep_coordination': this.setMepCoordinationLayerVisible(!this.mepCoordinationVisible); return;
      case 'hvac': this.setHvacCoordinationVisible(!this.hvacCoordinationVisible); return;
      case 'electrical_topology': this.setElectricalTopologyVisible(!this.electricalTopologyVisible); return;
      case 'wall_tile': this.setWallTileInspectionVisible(!this.wallTileVisible, announce); return;
      case 'paint': this.setPaintInspectionVisible(!this.paintVisible, announce); return;
      case 'ceiling_zone': this.setCeilingZoneHighlightVisible(!this.ceilingZoneVisible, announce); return;
    }
  }

  private setupMepCoordinationButton(): void {
    const overviewButton = document.getElementById('mep-overview-btn') as HTMLButtonElement | null;
    overviewButton?.addEventListener('click', () => {
      this.setMepOverviewVisible(!this.mepOverviewVisible);
    });
    const button = document.getElementById('mep-coordination-btn') as HTMLButtonElement | null;
    if (!button) return;
    button.addEventListener('click', () => {
      this.setMepCoordinationLayerVisible(!this.mepCoordinationVisible);
    });
    document.getElementById('mep-bends-toggle')?.addEventListener('change', (event) => {
      this.houseScene.setMepBendsVisible((event.target as HTMLInputElement).checked);
    });
  }

  /** 机电总览：组合层（吊顶+点位+HVAC+MEP 路线），顺带压亮电气回路，但不动用户对回路的独立开关意图。 */
  private setMepOverviewVisible(visible: boolean): void {
    this.mepOverviewVisible = visible;
    this.houseScene.setMepOverviewVisible(this.mepOverviewVisible, this.hvacCoordinationState === 'ready' || this.mepCoordinationReady);
    if (this.electricalTopology) {
      this.houseScene.setElectricalTopologyVisible(this.mepOverviewVisible || this.electricalTopologyVisible);
      this.syncElectricalTopologyButton();
    }
    const overviewButton = document.getElementById('mep-overview-btn') as HTMLButtonElement | null;
    overviewButton?.classList.toggle('active', this.mepOverviewVisible);
    if (overviewButton) overviewButton.textContent = this.mepOverviewVisible ? '退出机电总览' : '机电总览';
    this.syncLayersSummary(true);
    this.requestRender();
  }

  /** MEP 协调（实体水电 + HVAC 路线）：独立检视层。 */
  private setMepCoordinationLayerVisible(visible: boolean): void {
    this.mepCoordinationVisible = this.mepCoordinationReady && visible;
    this.houseScene.setMepCoordinationVisible(this.mepCoordinationVisible);
    const controls = document.getElementById('mep-coordination-controls');
    if (controls) controls.hidden = !this.mepCoordinationVisible;
    const button = document.getElementById('mep-coordination-btn') as HTMLButtonElement | null;
    button?.classList.toggle('active', this.mepCoordinationVisible);
    if (button) this.setButtonLabel(button, this.mepCoordinationVisible ? '水电走向 · 显示中' : '水电走向');
    this.syncLayersSummary(true);
    this.requestRender();
  }

  private setupElectricalTopologyButton(): void {
    const button = document.getElementById('electrical-topology-btn') as HTMLButtonElement | null;
    if (!button) return;
    button.addEventListener('click', () => {
      this.setElectricalTopologyVisible(!this.electricalTopologyVisible);
    });
    this.syncElectricalTopologyButton();
  }

  private setElectricalTopologyVisible(visible: boolean): void {
    if (!this.electricalTopology) return;
    this.electricalTopologyVisible = visible;
    this.houseScene.setElectricalTopologyVisible(this.mepOverviewVisible || this.electricalTopologyVisible);
    this.syncElectricalTopologyButton();
    this.syncLayersSummary(true);
    this.requestRender();
  }

  private syncElectricalTopologyButton(): void {
    const button = document.getElementById('electrical-topology-btn') as HTMLButtonElement | null;
    const controls = document.getElementById('electrical-topology-controls');
    if (!button) return;
    const ready = this.electricalTopology !== null;
    button.disabled = !ready;
    const effectivelyVisible = ready && (this.electricalTopologyVisible || this.mepOverviewVisible);
    button.classList.toggle('active', effectivelyVisible);
    this.setButtonLabel(button, !ready
      ? '电路归属：未就绪'
      : effectivelyVisible ? '电路归属 · 开' : '电路归属');
    if (!ready) {
      const badge = document.getElementById('electrical-topology-badge');
      if (badge) badge.hidden = true;
    }
    if (controls) controls.hidden = !effectivelyVisible;
    this.syncLayersSummary();
  }

  private setButtonLabel(button: HTMLButtonElement, text: string): void {
    const label = typeof button.querySelector === 'function' ? button.querySelector('.btn-label') : null;
    if (label) label.textContent = text;
    else button.textContent = text;
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
    }
    const mepLintBadge = document.getElementById('mep-lint-badge');
    if (mepLintBadge) renderMepLintBadge(mepLintBadge, this.mepLintResult);
    button.disabled = !ready;
    this.setButtonLabel(button, ready ? '水电走向' : '水电走向 · 未就绪');
    button.classList.toggle('active', this.mepCoordinationVisible);
    this.syncLayersSummary();
    this.syncAlertsSummary();
  }

  private setupExportButton(): void {
    const btn = document.getElementById('export-glb-btn');
    btn?.addEventListener('click', () => {
      void this.handleExportGlb();
    });
  }

  private async handleExportGlb(): Promise<void> {
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
      const { x: centerX, y: centerY } = this.getCanvasCenter();
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
            const index = this.getFurnitureWriteIndex(objectId);
            if (index !== null) {
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
      // 涂漆区 toast 的顶面数字取自这里（paintBudgetPreview），轮询到新预算也要跟上。
      this.lastBudget = budget;
    });

    this.houseScene.setOnObjectClick((target) => {
      if (this.analysisTools.measurement.active) return;
      if (target.type === 'sliding_door') {
        this.toggleSlidingDoor(target.objectId.slice('sliding_door:'.length));
        return;
      }
      this.infoPanel.showObject(target);
      this.previewWorkbench.activate('object');
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
      // 在输入框/可编辑元素中打字时不触发全局快捷键
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      // ── Special cases that need extra logic ──
      if (e.code === 'Escape') {
        // 控制面重构：表面开合全部走 SurfaceManager 一键清场（含钉住表面）；
        // 非表面动作（退出放置/拖拽模式）接力在后
        if (this.surfaceManager.dismissAll()) return;
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

      // L 只负责灯（2026-10-26 去陷阱：旧行为在灯未就绪时变成测量，一个键两种
      // 含义）。测量改走命令面板/工具栏入口，不再占快捷键。
      if (shouldToggleInteriorLights(e.code, e.repeat)) {
        e.preventDefault();
        if (this.interiorLighting) this.toggleInteriorLights();
        else this.showToast('室内灯光配置不可用');
        return;
      }

      if (e.code === 'KeyM' && !e.repeat) {
        e.preventDefault();
        this.toggleOverviewMenu();
        return;
      }

      if (e.code === 'KeyT' && !e.repeat) {
        e.preventDefault();
        this.toggleTopDownView();
        return;
      }

      // ── 图层抽屉数字键（轨道模式）：1-7 开关对应检视层，0 全关 ──
      if (
        this.houseScene.mode === 'orbit'
        && !e.repeat
        && typeof e.code === 'string'
        && e.code.startsWith('Digit')
      ) {
        const digit = Number(e.code.slice('Digit'.length));
        if (!Number.isNaN(digit) && digit <= LAYER_KEYS.length) {
          e.preventDefault();
          if (digit === 0) this.clearAllLayers();
          else this.toggleLayerByKey(LAYER_KEYS[digit - 1]);
          return;
        }
      }

      if (shouldToggleSeeThrough(e.code, e.repeat, this.houseScene.mode)) {
        e.preventDefault();
        this.toggleSeeThroughView();
        return;
      }

      if (e.code === 'KeyC' && !e.repeat) {
        e.preventDefault();
        this.cycleCurtainState();
        return;
      }

      if (e.code === 'KeyP' && !e.repeat) {
        e.preventDefault();
        this.toggleAnnotations();
        return;
      }

      if (this.houseScene.mode === 'first-person' && !e.repeat) {
        if (e.code === 'BracketLeft') { e.preventDefault(); this.stepSensitivity(-1); return; }
        if (e.code === 'BracketRight') { e.preventDefault(); this.stepSensitivity(1); return; }

        if (e.code === 'KeyB') {
          e.preventDefault();
          this.toggleFurniturePanel();
          return;
        }

        if (e.code === 'KeyE') {
          e.preventDefault();
          this.togglePlacementPanel();
          return;
        }

        if (e.code === 'KeyG') {
          e.preventDefault();
          this.enterDragForHovered();
          return;
        }

        if (e.code === 'Delete') {
          e.preventDefault();
          void this.deleteHoveredPoint();
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
        this.surfaceManager.toggle('palette');
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
        // 只有点击画布本身才重新锁定指针；点击面板/按钮等 UI 不应劫持鼠标
        if (e.target !== this.canvas) return;
        // 触摸主输入没有 pointer lock（iOS 完全不可用）：转向/摇杆路径不依赖它
        if (this.capabilities.touchPrimary) return;
        this.fpController.requestLock();
        return;
      }
      if (this.houseScene.mode === 'first-person' && this.fpController.isLocked) {
        this.handleCenterClick();
      }
    });
  }

  // ── 命令处理器：快捷键与命令面板共用同一实现，禁止两处各写一份 ──

  private toggleOverviewMenu(): void {
    // 走 SurfaceManager：modal 语义（打开时清场其它表面）与 Esc/画布清场才生效
    this.surfaceManager.toggle('overview');
    this.syncSurfaceToggleButton('overview');
  }

  /** 方案/总览工具栏按钮的 aria-expanded 同步（这两个入口没有 Popover 代管）。 */
  private syncSurfaceToggleButton(id: 'scheme' | 'overview'): void {
    const btn = document.getElementById(id === 'scheme' ? 'scheme-toggle-btn' : 'overview-toggle-btn');
    btn?.setAttribute('aria-expanded', String(this.surfaceManager.isOpen(id)));
  }

  private toggleTopDownView(): void {
    this.houseScene.toggleTopDown();
    this.topDownButton?.sync();
  }

  private toggleSeeThroughView(): void {
    this.analysisTools.toggleSeeThrough();
    this.updateModeIndicator();
  }

  private toggleInteriorLights(): void {
    this.interiorLighting?.toggle();
    this.syncLightingPreviewPanel();
    this.houseScene.requestShadowUpdate();
  }

  private toggleMeasurementTool(): void {
    this.analysisTools.toggleMeasurement();
    if (this.houseScene.mode === 'orbit') {
      this.houseScene.controls.enabled = !this.analysisTools.measurement.active;
    }
    this.updateModeIndicator();
    this.updateCrosshairStyle();
  }

  private cycleCurtainState(): void {
    const next: CurtainState = this.curtainPresentationState.default === 'open'
      ? 'privacy'
      : this.curtainPresentationState.default === 'privacy'
        ? 'blackout'
        : 'open';
    void this.handleCurtainStateChange(next);
  }

  private toggleAnnotations(): void {
    this.annotationGroupVisible = !this.annotationGroupVisible;
    this.annotationRenderer?.setVisible('all', this.annotationGroupVisible);
  }

  private stepSensitivity(delta: number): void {
    this.sensitivitySlider.step(delta);
  }

  private toggleFurniturePanel(): void {
    if (this.furniturePlaceMode) {
      this.exitFurniturePlaceMode();
    }
    this.furniturePanel.toggle();
  }

  private togglePlacementPanel(): void {
    if (this.infrastructurePlaceMode) {
      this.exitInfrastructurePlaceMode();
    }
    this.placementPanel.toggle();
  }

  private enterDragForHovered(): void {
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
        this.fpController.enterDragMode(hovered.objectId, 0);
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
  }

  private async deleteHoveredPoint(): Promise<void> {
    const hovered = this.hoverTooltip.getCurrent();
    if (!hovered) return;
    const isElectrical = hovered.objectId.startsWith('electrical:');
    const isPlumbing = hovered.objectId.startsWith('plumbing:');
    if (!isElectrical && !isPlumbing) return;
    const id = hovered.objectId.split(':').slice(1).join(':');
    const apiUrl = isElectrical ? '/api/electrical' : '/api/plumbing';
    try {
      await fetch(`${apiUrl}/${id}`, { method: 'DELETE' });
      await this.refreshInfrastructure();
    } catch (err) {
      console.error('Failed to delete annotation', err);
    }
  }

  private setupPointerLockEvents(): void {
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.houseScene.mode === 'first-person') {
        this.hoverTooltip.clear();
      }
    });

    document.addEventListener('pointerlockerror', () => {
      // 触摸端本就不走 pointer lock，不弹无意义的提示
      if (this.capabilities.touchPrimary) return;
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
            const index = this.getFurnitureWriteIndex(objectId);
            if (index !== null) {
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
      const { x: centerX, y: centerY } = this.getCanvasCenter();
      const pos = this.houseScene.getGroundPosition(centerX, centerY);
      if (pos) {
        const { category, type } = this.infrastructurePlaceMode;
        const apiUrl = category === 'electrical' ? '/api/electrical' : '/api/plumbing';
        const id = `${type}_${Date.now()}`;
        const room = this.houseScene.getRoomIdAt(centerX, centerY);
        if (!room) {
          console.warn('Cannot place infrastructure outside a resolved room');
          this.exitInfrastructurePlaceMode();
          return;
        }
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
      const { x: centerX, y: centerY } = this.getCanvasCenter();
      const pos = this.houseScene.getGroundPosition(centerX, centerY);
      if (pos) {
        const type = this.furniturePlaceMode.type;
        fetch('/api/furnishings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ room: 'living_dining', type, x: pos.x, z: pos.z, rotation: 0 }),
        }).then(async () => {
          const data = await this.stateSync.fetchProject();
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
    this.previewWorkbench.activate('object');
    if (target.type === 'mep_coordination_route' && target.mep?.routeId) {
      this.houseScene.highlightMepRoute(String(target.mep.routeId));
    }
    this.stateSync.postViewContext(target.objectId);
  }

  private async handleOptionSelect(topicId: string, optionId: string, roomId: string | null): Promise<void> {
    this.finishVisualPreview();
    const patch: SelectionPatch = { topic: topicId, optionId, roomId: roomId ?? null };
    await this.stateSync.updateScheme([patch]);

    const scheme = await this.stateSync.fetchScheme();
    if (scheme) {
      this.applyScheme(scheme);
      this.infoPanel.setScheme(scheme);
      this.overviewMenu.setScheme(scheme);
      // 画布优先后工作台默认收起：选材质/涂漆方案时呼出材质预演页，
      // 否则预览面板更新在看不见的地方（对象信息/日照走各自的 activate 路径）
      if (topicId === 'floor' || topicId === 'paint') {
        this.previewWorkbench.activate('material');
      }
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
    this.lastBudget = budget;
    this.overviewMenu.setRisks(risks);
    this.overviewMenu.setArchivedSchemes(archives);
  }

  private async handleArchive(name: string, reason?: string): Promise<void> {
    await this.stateSync.archiveScheme(name, reason);
    const archives = await this.stateSync.fetchArchivedSchemes();
    this.overviewMenu.setArchivedSchemes(archives);
  }

  private async handleRestore(id: string): Promise<void> {
    this.finishVisualPreview();
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
    const previousLayout = this.activeLayout;
    try {
      const data = await this.stateSync.fetchProject({ phase: this.phase, layout: layoutName });
      this.projectData = data;
      this.activeLayout = layoutName;
      this.stateSync.setLayout(layoutName);
    } catch (error) {
      this.activeLayout = previousLayout;
      this.overviewMenu.setActiveLayout(previousLayout);
      console.error('Failed to switch layout', error);
      this.showToast('布局切换失败，已恢复当前布局');
      return;
    }
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

  private async handlePhaseChange(phase: PhaseId): Promise<void> {
    if (phase === this.phase || this.phaseReloading) return;
    const previousPhase = this.phase;
    const previousLayout = this.activeLayout;
    const previousProjectData = this.projectData;
    this.phaseReloading = true;
    this.overviewMenu.setPhaseLoading(true);
    try {
      this.stateSync.setPhase(phase);
      const data = await this.stateSync.fetchProject({ phase, layout: this.activeLayout });
      this.collision.setWalls(this.extractWalls(data?.house?.sceneElements));
      await this.houseScene.buildFromCatalog(data);
      this.annotationRenderer?.clear();
      this.annotationRenderer = new AnnotationRenderer(
        this.houseScene.scene,
        this.houseScene.camera,
        this.houseScene.getViewOnlyRoot(),
      );
      await this.refreshInfrastructure();
      this.analysisTools.setFurnitureMeshes(this.houseScene.getFurnitureMeshes());
      this.analysisTools.setRooms(data?.house?.rooms ?? []);
      this.analysisTools.checkFurnitureCollisions();
      this.projectData = data;
      this.phase = phase;
      this.overviewMenu.setActiveLayout(this.activeLayout);
      this.topics = new TopicRegistry(this.houseScene).list();
      this.schemePanel.init(this.topics, (topicId: string, optionId: string) => {
        this.finishVisualPreview();
        void this.stateSync.updateScheme([{ topic: topicId, optionId }]);
      });
      this.infoPanel.setTopics(this.topics);
      this.overviewMenu.setTopics(this.topics);
      this.overviewMenu.setPhase(this.phase);
      const [scheme, presentationState] = await Promise.all([
        this.stateSync.fetchScheme(),
        this.stateSync.getPresentationState(),
      ]);
      this.applyScheme(scheme);
      this.infoPanel.setScheme(scheme);
      this.overviewMenu.setScheme(scheme);
      this.applyCurtainPresentationState(presentationState);
      await this.refreshOverviewData();
      this.requestRender();
    } catch (error) {
      this.stateSync.setPhase(previousPhase);
      this.stateSync.setLayout(previousLayout);
      this.phase = previousPhase;
      this.activeLayout = previousLayout;
      this.projectData = previousProjectData;
      try {
        this.collision.setWalls(this.extractWalls(previousProjectData?.house?.sceneElements));
        await this.houseScene.buildFromCatalog(previousProjectData);
        this.annotationRenderer?.clear();
        this.annotationRenderer = new AnnotationRenderer(
          this.houseScene.scene,
          this.houseScene.camera,
          this.houseScene.getViewOnlyRoot(),
        );
        await this.refreshInfrastructure();
        this.analysisTools.setFurnitureMeshes(this.houseScene.getFurnitureMeshes());
        this.analysisTools.setRooms(previousProjectData?.house?.rooms ?? []);
        this.analysisTools.checkFurnitureCollisions();
        this.topics = new TopicRegistry(this.houseScene).list();
        this.schemePanel.init(this.topics, (topicId: string, optionId: string) => {
          this.finishVisualPreview();
          void this.stateSync.updateScheme([{ topic: topicId, optionId }]);
        });
        this.infoPanel.setTopics(this.topics);
        this.overviewMenu.setTopics(this.topics);
        const [scheme, presentationState] = await Promise.all([
          this.stateSync.fetchScheme(),
          this.stateSync.getPresentationState(),
        ]);
        this.applyScheme(scheme);
        this.infoPanel.setScheme(scheme);
        this.overviewMenu.setScheme(scheme);
        this.applyCurtainPresentationState(presentationState);
      } catch (restoreError) {
        console.error('Failed to restore previous phase after switch failure', restoreError);
      }
      this.overviewMenu.setPhase(previousPhase);
      this.overviewMenu.setActiveLayout(previousLayout);
      console.error('Failed to switch project phase', error);
      this.showToast('阶段切换失败，已恢复原阶段');
    } finally {
      this.phaseReloading = false;
      this.overviewMenu.setPhaseLoading(false);
      this.overviewMenu.setPhase(this.phase);
    }
  }

  private async handleCompare(archiveId: string): Promise<void> {
    const response = await fetch(`/api/schemes/compare?other=${archiveId}`);
    const data = await response.json();
    this.schemePanel.initCompare(archiveId, data.diff);
    this.houseScene.setCompareScheme(data.compare.scheme);
    this.compareActive = true;
  }

  private async refreshInfrastructure(): Promise<void> {
    const carriedPreview = this.visualPreviewActive ? this.captureVisualPreviewSnapshot() : null;
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
        [],
        this.annotationRenderer.getPlumbingData(),
      );
      try {
        const topologyResponse = await fetch('/api/electrical-topology');
        if (topologyResponse.ok) {
          this.electricalTopology = await topologyResponse.json() as ElectricalTopology & { lint?: { counts: { circuits: number; uncoveredPoints: number; warnings: number } } };
          const electricalPoints = this.renderFacts?.electrical ?? this.projectData?.house?.electrical ?? this.annotationRenderer.getElectricalData();
          this.houseScene.loadElectricalTopology(this.electricalTopology, electricalPoints);
          this.infoPanel.setElectricalTopology(this.electricalTopology);
          this.setupElectricalTopologyControls(this.electricalTopology);
          const badge = document.getElementById('electrical-topology-badge');
          const lint = this.electricalTopology.lint;
          if (badge && lint) {
            badge.hidden = false;
            badge.textContent = `${lint.counts.circuits} 条${lint.counts.warnings > 0 ? ` ⚠${lint.counts.warnings}` : ''}`;
            badge.classList.toggle('btn-badge-warning', lint.counts.warnings > 0);
            badge.title = `电气回路 ${lint.counts.circuits} 条 / 未覆盖 ${lint.counts.uncoveredPoints} / warning ${lint.counts.warnings}`;
          }
          this.syncElectricalTopologyButton();
        } else {
          this.syncElectricalTopologyButton();
        }
      } catch {
        this.electricalTopology = null;
        this.houseScene.setElectricalTopologyVisible(false);
        this.syncElectricalTopologyButton();
      }      try {
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
        this.houseScene.requestShadowUpdate();
        this.interiorLighting?.dispose();
        this.interiorLighting = nextInteriorLighting;
        if (carriedPreview) {
          this.applyLightingPreviewState(carriedPreview.lighting);
          this.applyMaterialPreviewState(carriedPreview.material, carriedPreview.paintPreviewActive);
        } else {
          this.syncLightingPreviewPanel();
        }
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
            this.houseScene.loadMepCoordination(mep, mepSources, mepPayload.lint);
            const mepReport = this.houseScene.getMepRenderReport();
            if (mepReport.skipped > 0) {
              console.warn(`[mep] ${mepReport.skipped}/${mepReport.total} routes skipped: ${mepReport.skippedRoutes.join(', ')}`);
              this.showToast(`MEP 路线不完整：${mepReport.resolved}/${mepReport.total} 条已渲染`);
            }
            this.setupMepLayerControls(mep);
            this.setMepCoordinationState(true);
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
          this.showToast(`${projection.hvac.planId} 空调协调已就绪：外机 ${outdoorCount} / 内机 ${indoorCount} / 预深化路线 ${projection.hvac.diagram.routes.length}`);
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
    this.syncAlertsSummary();
    this.requestRender();
  }

  private handleClearCompare(): void {
    this.schemePanel.clearCompare();
    this.compareActive = false;
    this.compareShowing = false;
    this.stateSync.fetchScheme().then((s) => { if (s) this.applyScheme(s); });
  }

  private applyScheme(scheme: CurrentScheme): void {
    this.officialScheme = JSON.parse(JSON.stringify(scheme)) as CurrentScheme;
    for (const [topicId, selection] of Object.entries(scheme.selections)) {
      const effective = selection.default;
      if (effective) {
        // DEC-041：传整份 selection（default + roomOverrides），分房覆盖在渲染层生效
        this.houseScene.setSelection(topicId, effective, selection);
        this.schemePanel.setActiveOption(topicId, effective, []);
      }
    }
    if (this.visualPreviewActive && this.materialPreviewState) {
      this.applyMaterialPreviewState(this.materialPreviewState, this.visualPreviewPaintActive);
    } else if (this.materialPreviewPanel) {
      this.materialPreviewState = this.makeMaterialPreviewState(scheme);
      this.syncMaterialPreviewPanel();
    }
    this.requestRender();
  }

  private updateModeIndicator(): void {
    const measSuffix = this.analysisTools?.measurement.active ? ' · 📏 测量开启' : '';
    const seeThroughSuffix = this.analysisTools?.isSeeThrough() ? ' · 👁 透视' : '';
    const mobile = isMobileChrome(this.capabilities);
    if (this.houseScene.mode === 'orbit') {
      this.modeIndicator.textContent = mobile
        ? `轨道模式 · 拖拽旋转 · 双指缩放${measSuffix}${seeThroughSuffix}`
        : `轨道模式 · 按 V 切换第一人称${measSuffix}${seeThroughSuffix}`;
    } else {
      this.modeIndicator.textContent = mobile
        ? `第一人称 · 拖拽转身 · 摇杆移动${measSuffix}${seeThroughSuffix}`
        : `第一人称 · WASD 移动 · [ ] 灵敏度 · 按 V 切换轨道 · 按 M 总览${measSuffix}${seeThroughSuffix}`;
    }
    this.syncViewPanelOptions();
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

  private getCanvasCenter(): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
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
        const { x: centerX, y: centerY } = this.getCanvasCenter();
        const pos = this.houseScene.getGroundPosition(centerX, centerY);
        if (pos) {
          this.houseScene.updateGhostPosition(pos.x, pos.z);
        }
      }

      if (this.infrastructurePlaceMode) {
        const { x: centerX, y: centerY } = this.getCanvasCenter();
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
    this.virtualJoystick?.dispose();
    this.lightingPreviewPanel?.destroy();
    this.materialPreviewPanel?.destroy();
    this.unsubscribeCapabilities?.();
    window.removeEventListener('material-texture-error', this.materialTextureErrorHandler);
    this.houseScene.dispose();
    if ((window as Window & { setHvacCoordinationVisible?: unknown }).setHvacCoordinationVisible === this.hvacCoordinationApi) {
      delete (window as Window & { setHvacCoordinationVisible?: unknown }).setHvacCoordinationVisible;
    }
    this.stateSync.dispose();
  }
}
