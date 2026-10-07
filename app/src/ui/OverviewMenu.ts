import type {
  Topic,
  CurrentScheme,
  DecisionLogEntry,
  BudgetSnapshot,
  DesignCheckResult,
  ArchivedScheme,
  Risk,
  ConstraintViolation,
  CurtainPresentationState,
  CurtainState,
} from '@shared/types';
import type { PhaseId } from '../state/StateSync.js';

export interface OverviewMenuOptions {
  onArchive?: (name: string, reason?: string) => void;
  onRestore?: (id: string) => void;
  onDeleteArchive?: (id: string) => void;
  onLayoutChange?: (layoutName: string) => void;
  onCompare?: (archiveId: string) => void;
  onClearCompare?: () => void;
  onCurtainStateChange?: (state: CurtainState) => void;
  onPhaseChange?: (phase: PhaseId) => void;
}

export class OverviewMenu {
  private el: HTMLDivElement;
  private schemeEl: HTMLDivElement;
  private curtainsEl: HTMLDivElement | null;
  private decisionsEl: HTMLDivElement;
  private budgetEl: HTMLDivElement;
  private risksEl: HTMLDivElement;
  private archivesEl: HTMLDivElement;
  private archiveInput: HTMLInputElement;
  private topics: Topic[] = [];
  private scheme: CurrentScheme | null = null;
  private presentationState: CurtainPresentationState | null = null;
  private decisions: DecisionLogEntry[] = [];
  private budget: BudgetSnapshot | null = null;
  private risks: DesignCheckResult | null = null;
  private archives: Pick<ArchivedScheme, 'id' | 'name' | 'createdAt'>[] = [];
  private visible = false;
  private callbacks: OverviewMenuOptions;
  private layoutSelect: HTMLSelectElement | null;
  private phaseSelect: HTMLSelectElement | null;

  constructor(callbacks: OverviewMenuOptions = {}) {
    this.callbacks = callbacks;
    this.el = document.getElementById('overview-menu') as HTMLDivElement;
    this.schemeEl = document.getElementById('overview-scheme') as HTMLDivElement;
    this.curtainsEl = document.getElementById('overview-curtains') as HTMLDivElement | null;
    this.decisionsEl = document.getElementById('overview-decisions') as HTMLDivElement;
    this.budgetEl = document.getElementById('overview-budget') as HTMLDivElement;
    this.risksEl = document.getElementById('overview-risks') as HTMLDivElement;
    this.archivesEl = document.getElementById('overview-archives') as HTMLDivElement;
    this.archiveInput = document.getElementById('archive-name-input') as HTMLInputElement;
    this.layoutSelect = document.getElementById('layout-select') as HTMLSelectElement | null;
    this.phaseSelect = document.getElementById('phase-select') as HTMLSelectElement | null;
    this.el.style.display = 'none';

    if (this.layoutSelect) {
      this.layoutSelect.addEventListener('change', () => {
        this.callbacks.onLayoutChange?.(this.layoutSelect!.value);
      });
    }
    this.phaseSelect?.addEventListener('change', () => {
      this.callbacks.onPhaseChange?.(this.phaseSelect!.value as PhaseId);
    });

    const archiveBtn = document.getElementById('archive-current-btn');
    archiveBtn?.addEventListener('click', () => this.handleArchiveClick());
  }

  setTopics(topics: Topic[]) {
    this.topics = topics;
  }

  setScheme(scheme: CurrentScheme) {
    this.scheme = scheme;
    if (this.visible) this.render();
  }

  setPresentationState(state: CurtainPresentationState) {
    this.presentationState = state;
    if (this.visible) this.render();
  }

  setDecisionLog(decisions: DecisionLogEntry[]) {
    this.decisions = decisions;
    if (this.visible) this.render();
  }

  setBudget(budget: BudgetSnapshot) {
    this.budget = budget;
    if (this.visible) this.render();
  }

  setRisks(risks: DesignCheckResult) {
    this.risks = risks;
    if (this.visible) this.render();
  }

  setArchivedSchemes(archives: Pick<ArchivedScheme, 'id' | 'name' | 'createdAt'>[]) {
    this.archives = archives;
    if (this.visible) this.render();
  }

  toggle() {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
    if (this.visible) this.render();
  }

  show() {
    this.visible = true;
    this.el.style.display = 'block';
    this.render();
  }

  hide() {
    this.visible = false;
    this.el.style.display = 'none';
  }

  isVisible(): boolean {
    return this.visible;
  }

  setLayouts(layouts: Array<{ name: string; path: string }>): void {
    if (!this.layoutSelect) return;
    this.layoutSelect.innerHTML = layouts.map((l) => `<option value="${l.name}">${l.name}</option>`).join('');
  }

  setActiveLayout(name: string): void {
    if (!this.layoutSelect) return;
    this.layoutSelect.value = name;
  }

  setPhase(phase: PhaseId): void {
    if (this.phaseSelect) this.phaseSelect.value = phase;
    const label = document.getElementById('phase-status');
    if (label) label.textContent = phase === 'full' ? '当前：完整方案' : '当前：一期基本入住';
    const indicator = document.getElementById('phase-indicator');
    if (indicator) indicator.textContent = phase === 'full' ? 'FULL DESIGN' : 'PHASE 1 · BASIC OCCUPANCY';
  }

  setPhaseLoading(loading: boolean): void {
    if (this.phaseSelect) this.phaseSelect.disabled = loading;
    const label = document.getElementById('phase-status');
    if (label && loading) label.textContent = '阶段切换中…';
  }

  private render() {
    this.renderScheme();
    this.renderCurtains();
    this.renderDecisions();
    this.renderBudget();
    this.renderRisks();
    this.renderArchives();
  }

  private renderScheme() {
    this.schemeEl.innerHTML = '';
    if (!this.scheme) return;

    for (const [topicId, selection] of Object.entries(this.scheme.selections)) {
      const topic = this.topics.find((t) => t.id === topicId);
      const topicName = topic?.name ?? topicId;
      const defaultOption = topic?.options.find((o) => o.id === selection.default);

      const row = document.createElement('div');
      row.className = 'overview-row';

      const label = document.createElement('span');
      label.className = 'overview-label';
      label.textContent = topicName;

      const value = document.createElement('span');
      value.className = 'overview-value';
      value.textContent = defaultOption?.name ?? selection.default ?? '未选择';

      row.appendChild(label);
      row.appendChild(value);
      this.schemeEl.appendChild(row);

      for (const [roomId, optionId] of Object.entries(selection.roomOverrides)) {
        const overrideRow = document.createElement('div');
        overrideRow.className = 'overview-row overview-override';

        const overrideLabel = document.createElement('span');
        overrideLabel.textContent = `  ↳ ${roomId}`;

        const overrideOption = topic?.options.find((o) => o.id === optionId);
        const overrideValue = document.createElement('span');
        overrideValue.textContent = overrideOption?.name ?? optionId;

        overrideRow.appendChild(overrideLabel);
        overrideRow.appendChild(overrideValue);
        this.schemeEl.appendChild(overrideRow);
      }
    }
  }

  private renderCurtains() {
    if (!this.curtainsEl) return;
    this.curtainsEl.innerHTML = '';
    const current = this.presentationState?.default ?? 'open';
    const options: Array<{ state: CurtainState; label: string }> = [
      { state: 'open', label: '全开' },
      { state: 'privacy', label: '全屋纱帘' },
      { state: 'blackout', label: '全屋遮光' },
    ];
    const row = document.createElement('div');
    row.className = 'curtain-state-controls';
    for (const option of options) {
      const button = document.createElement('button');
      button.className = `overview-archive-btn${option.state === current ? ' active' : ''}`;
      button.textContent = option.label;
      button.onclick = () => this.callbacks.onCurtainStateChange?.(option.state);
      row.appendChild(button);
    }
    this.curtainsEl.appendChild(row);
  }

  private renderDecisions() {
    this.decisionsEl.innerHTML = '';
    const recent = this.decisions.slice(-10).reverse();

    if (recent.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'overview-empty';
      empty.textContent = '暂无决策记录';
      this.decisionsEl.appendChild(empty);
      return;
    }

    for (const entry of recent) {
      const row = document.createElement('div');
      row.className = 'overview-decision-row';

      const topic = document.createElement('span');
      topic.className = 'overview-decision-topic';
      topic.textContent = entry.topic;

      const change = document.createElement('span');
      change.className = 'overview-decision-change';
      change.textContent = `${entry.previousOptionId ?? '∅'} → ${entry.optionId ?? '∅'}`;

      const time = document.createElement('span');
      time.className = 'overview-decision-time';
      time.textContent = new Date(entry.createdAt).toLocaleTimeString();

      row.appendChild(topic);
      row.appendChild(change);
      row.appendChild(time);
      this.decisionsEl.appendChild(row);
    }
  }

  private renderBudget() {
    this.budgetEl.innerHTML = '';
    if (!this.budget) {
      const empty = document.createElement('div');
      empty.className = 'overview-empty';
      empty.textContent = '暂无预算数据';
      this.budgetEl.appendChild(empty);
      return;
    }

    const phaseBudget = this.budget as BudgetSnapshot & { phaseCeiling?: number; phaseAllocated?: number; phaseUnallocated?: number };
    const phaseCeiling = phaseBudget.phaseCeiling;
    const phaseAllocated = phaseBudget.phaseAllocated;
    const phaseUnallocated = phaseBudget.phaseUnallocated;
    if (phaseCeiling !== undefined) {
      this.appendBudgetRow('阶段上限', phaseCeiling);
      this.appendBudgetRow('已分配', phaseAllocated);
      this.appendBudgetRow('未分配', phaseUnallocated);
      this.appendBudgetRow('场景动态估算', this.budget.totalActual);
    } else {
      this.appendBudgetRow('总预算', this.budget.totalBudget);
      this.appendBudgetRow('已用', this.budget.totalActual);
      this.appendBudgetRow('剩余', this.budget.totalBudget - this.budget.totalActual);
    }
    this.renderBudgetCategories();
    this.renderTileBudgetPreview();
    this.renderPaintBudgetPreview();
  }

  /**
   * 涂漆范围/用量对账（DEC-2026-10-08-R01）。与瓷砖同款定位：只读叠加，不进总额。
   * 面积来自 overlay.yaml 的 paint_region 声明——与 3D「涂漆区」按钮高亮的是同一批声明，
   * 所以面板看到的面积和模型里点亮的墙面必须一致。
   */
  private renderPaintBudgetPreview(): void {
    const preview = (this.budget as BudgetSnapshot & {
      paintBudgetPreview?: {
        status: 'comparison_overlay_only';
        scope: {
          paintRoomCount: number;
          wallRegionEntryCount: number;
          grossWallAreaSqm: number;
          doorGapAreaSqm: number;
          windowGapAreaSqm: number;
          netWallAreaSqm: number;
          ceilingAreaSqm: number;
          grossAreaSqm: number;
          netAreaSqm: number;
          highlightedIn3d: 'walls_only';
        };
        material: { name: string; brand: string; unit: string; pricePerUnit: number; coveragePerUnit: number };
        labor: { rateYuanPerSqm: number; scopeNote: string };
        reconciliation: { pkgId: string; plannedCny: number; ownerTargetCny: number; selectedScenarioId: null };
        scenarios: Array<{
          scenarioId: string;
          topcoats: number;
          deductOpenings: boolean;
          areaSqm: number;
          topcoatBuckets: number;
          primerBuckets: number;
          materialYuan: number;
          laborYuan: number;
          subtotalYuan: number;
          vsPlannedDeltaYuan: number;
        }>;
        warnings: string[];
      };
    }).paintBudgetPreview;
    if (!preview || preview.status !== 'comparison_overlay_only') return;

    const heading = document.createElement('div');
    heading.className = 'overview-row overview-paint-budget-heading';
    heading.textContent = '涂漆范围与用量（墙+顶）';
    this.budgetEl.appendChild(heading);

    const scopeRow = document.createElement('div');
    scopeRow.className = 'overview-row overview-paint-budget-scope';
    scopeRow.textContent = `声明 ${preview.scope.wallRegionEntryCount} 段墙面 / ${preview.scope.paintRoomCount} 间房：毛墙面 ${preview.scope.grossWallAreaSqm.toFixed(2)}㎡ − 门洞 ${preview.scope.doorGapAreaSqm.toFixed(2)}㎡ − 窗洞 ${preview.scope.windowGapAreaSqm.toFixed(2)}㎡ = 净墙面 ${preview.scope.netWallAreaSqm.toFixed(2)}㎡（3D 已高亮）+ 顶面 ${preview.scope.ceilingAreaSqm.toFixed(2)}㎡`;
    this.budgetEl.appendChild(scopeRow);

    for (const scenario of preview.scenarios) {
      const row = document.createElement('div');
      row.className = 'overview-row overview-paint-budget-candidate';
      const delta = scenario.vsPlannedDeltaYuan;
      const deltaText = delta > 0 ? `高于计划 ¥${delta.toLocaleString()}` : `低于计划 ¥${Math.abs(delta).toLocaleString()}`;
      row.textContent = `面漆${scenario.topcoats}遍${scenario.deductOpenings ? '、扣门窗洞' : '、不扣门窗洞（对照）'}：${scenario.areaSqm.toFixed(2)}㎡ → 面漆 ${scenario.topcoatBuckets} 桶 + 底漆 ${scenario.primerBuckets} 桶，材料 ¥${scenario.materialYuan.toLocaleString()} + 人工 ¥${scenario.laborYuan.toLocaleString()} = ¥${scenario.subtotalYuan.toLocaleString()}（${deltaText}）`;
      this.budgetEl.appendChild(row);
    }

    const note = document.createElement('div');
    note.className = 'overview-empty overview-paint-budget-note';
    note.textContent = `仅作口径对账，不计入整包"已用"；与 ${preview.reconciliation.pkgId} 计划额 ¥${preview.reconciliation.plannedCny.toLocaleString()}、业主目标 ¥${preview.reconciliation.ownerTargetCny.toLocaleString()} 比较。门窗洞按实扣除（业主 2026-10-08 裁定），遍数未裁定前不选单一情景。不含基层修补、找平批刮腻子、颜色样板与成品保护（COST-080-01/02/04），故不可与 PKG-080 全额划等号。`;
    this.budgetEl.appendChild(note);

    for (const warning of preview.warnings ?? []) {
      const warn = document.createElement('div');
      warn.className = 'overview-empty overview-paint-budget-warning';
      warn.textContent = `⚠ ${warning}`;
      this.budgetEl.appendChild(warn);
    }
  }

  private renderTileBudgetPreview(): void {
    const preview = (this.budget as BudgetSnapshot & {
      tileBudgetPreview?: {
        status: 'comparison_overlay_only';
        includedInTotalActual: false;
        includedInCategoryTotals: false;
        scopeNote: string;
        dryFloorMaterialAndOrdinaryLaborByCandidate: Array<{
          candidateId: 'kt_200x1200' | 'jinyi_approx_900x150';
          supplier: string;
          netAreaSqm: number;
          modeledDryFloorMaterialYuan: number;
          ordinaryLaborRateYuanPerSqm: number;
          ordinaryLaborSubtotalYuan: number;
          sameScopeSubtotalYuan: number;
          scopeNote: string;
        }>;
      };
    }).tileBudgetPreview;
    if (!preview || preview.status !== 'comparison_overlay_only') return;

    const heading = document.createElement('div');
    heading.className = 'overview-row overview-tile-budget-heading';
    heading.textContent = '瓷砖方案对比（干区地面）';
    this.budgetEl.appendChild(heading);

    for (const candidate of preview.dryFloorMaterialAndOrdinaryLaborByCandidate) {
      const row = document.createElement('div');
      row.className = 'overview-row overview-tile-budget-candidate';
      const label = candidate.candidateId === 'kt_200x1200' ? 'KT 200×1200' : '金意陶约900×150';
      row.textContent = `${label}：材料+普通铺贴 ¥${candidate.sameScopeSubtotalYuan.toLocaleString()}（${candidate.netAreaSqm.toFixed(2)}㎡，铺贴¥${candidate.ordinaryLaborRateYuanPerSqm.toLocaleString()}/㎡）`;
      this.budgetEl.appendChild(row);
    }

    const note = document.createElement('div');
    note.className = 'overview-empty overview-tile-budget-note';
    note.textContent = `仅作同口径方案比较，不计入整包“已用”；整包分类合计仍按现有预算计算，不含此叠加。卫浴、墙砖、阳台及杂项另计。普通铺贴工费从人工预算池核算，不重复计入。${preview.scopeNote ? ` ${preview.scopeNote}` : ''}`;
    this.budgetEl.appendChild(note);
  }

  private appendBudgetRow(label: string, value: number | undefined): void {
    const row = document.createElement('div');
    row.className = 'overview-row';
    row.innerHTML = `
      <span class="overview-label">${label}</span>
      <span class="overview-value">${value === undefined ? '—' : `¥${value.toLocaleString()}`}</span>
    `;
    this.budgetEl.appendChild(row);
  }

  private renderBudgetCategories(): void {
    if (!this.budget) return;
    for (const category of this.budget.categories) {
      if (category.actual === 0 && category.budget === 0) continue;
      const row = document.createElement('div');
      row.className = 'overview-row';
      row.innerHTML = `
        <span class="overview-label">${category.key}</span>
        <span class="overview-value">¥${category.actual.toLocaleString()} / ¥${category.budget.toLocaleString()}</span>
      `;
      this.budgetEl.appendChild(row);
    }
  }

  private renderRisks() {
    this.risksEl.innerHTML = '';
    if (!this.risks) {
      const empty = document.createElement('div');
      empty.className = 'overview-empty';
      empty.textContent = '暂无风险数据';
      this.risksEl.appendChild(empty);
      return;
    }

    const all = [
      ...this.risks.risks.map((r) => ({ ...r, kind: 'risk' as const })),
      ...this.risks.constraintViolations.map((v) => ({ ...v, kind: 'constraint' as const })),
    ];

    if (all.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'overview-empty';
      empty.textContent = '当前方案无风险或约束违规';
      this.risksEl.appendChild(empty);
      return;
    }

    for (const item of all) {
      const row = document.createElement('div');
      row.className = `overview-risk overview-risk-${item.kind}`;
      row.textContent = item.kind === 'risk'
        ? `[${item.severity}] ${(item as Risk).message}`
        : `[约束] ${(item as ConstraintViolation).description}`;
      this.risksEl.appendChild(row);
    }
  }

  private renderArchives() {
    this.archivesEl.innerHTML = '';
    if (this.archives.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'overview-empty';
      empty.textContent = '暂无归档方案';
      this.archivesEl.appendChild(empty);
      return;
    }

    for (const archive of this.archives) {
      const row = document.createElement('div');
      row.className = 'overview-archive-row';

      const name = document.createElement('span');
      name.className = 'overview-archive-name';
      name.textContent = archive.name;

      const time = document.createElement('span');
      time.className = 'overview-archive-time';
      time.textContent = new Date(archive.createdAt).toLocaleDateString();

      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'overview-archive-btn';
      restoreBtn.textContent = '恢复';
      restoreBtn.onclick = () => this.callbacks.onRestore?.(archive.id);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'overview-archive-btn overview-archive-btn-danger';
      deleteBtn.textContent = '删除';
      deleteBtn.onclick = () => this.callbacks.onDeleteArchive?.(archive.id);

      row.appendChild(name);
      row.appendChild(time);
      row.appendChild(restoreBtn);
      row.appendChild(deleteBtn);
      this.archivesEl.appendChild(row);
    }
  }

  private handleArchiveClick() {
    const name = this.archiveInput.value.trim();
    if (!name) return;
    this.callbacks.onArchive?.(name);
    this.archiveInput.value = '';
  }
}
