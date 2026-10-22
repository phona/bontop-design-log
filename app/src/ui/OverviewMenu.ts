import type {
  Topic,
  CurrentScheme,
  DecisionLogEntry,
  BudgetSnapshot,
  BudgetCategory,
  DesignCheckResult,
  ArchivedScheme,
  Risk,
  ConstraintViolation,
  CurtainPresentationState,
  CurtainState,
} from '@shared/types';
import type { PhaseId } from '../state/StateSync.js';
import { escapeHtml } from './escape-html.js';

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
    this.layoutSelect.innerHTML = layouts.map((l) => `<option value="${escapeHtml(l.name)}">${escapeHtml(l.name)}</option>`).join('');
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
    // 候选价门控汇总放在逐科列表之前，且**两个分支之后**：phaseCeiling 分支（一期相位）
    // 与旧口径分支都必须看得到，否则一期相位下业主根本看不到「这个预算数有多少是未取证的」。
    this.renderBudgetGateSummary(phaseCeiling !== undefined ? '场景动态估算' : '已用');
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
          ordinaryAreaSqm: number;
          antiMoldSqm: number;
          antiMoldStatus: 'pending_system_quote_and_site_validation';
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
        quotes: Array<{
          quoteId: string;
          source: string;
          form: string;
          rateYuanPerSqm: number;
          areaSqm: number;
          totalYuan: number;
          vsPlannedDeltaYuan: number;
          vsBrushingModelDeltaYuan: number;
          impliedAllowanceYuanPerSqm: number;
          coverage: string;
          coats: string;
          quoteStatus: string;
          observedAt?: string;
          evidence?: string;
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
    scopeRow.textContent = `声明 ${preview.scope.wallRegionEntryCount} 段墙面 / ${preview.scope.paintRoomCount} 间房：毛墙面 ${preview.scope.grossWallAreaSqm.toFixed(2)}㎡ − 门洞 ${preview.scope.doorGapAreaSqm.toFixed(2)}㎡ − 窗洞 ${preview.scope.windowGapAreaSqm.toFixed(2)}㎡ = 净墙面 ${preview.scope.netWallAreaSqm.toFixed(2)}㎡（3D 已高亮）+ 明确顶面 ${preview.scope.ceilingAreaSqm.toFixed(2)}㎡ = 普通涂装 ${preview.scope.ordinaryAreaSqm.toFixed(2)}㎡`;
    this.budgetEl.appendChild(scopeRow);

    if (preview.scope.antiMoldSqm > 0) {
      const wetRow = document.createElement('div');
      wetRow.className = 'overview-row overview-paint-budget-wet-area';
      wetRow.textContent = `主卫上飘窗防霉漆涂装 ${preview.scope.antiMoldSqm.toFixed(3)}㎡：防霉漆漆种/遍数/基层防霉处理与人工待现场核验和分项报价，未计入上方普通漆金额。`;
      this.budgetEl.appendChild(wetRow);
    }

    for (const scenario of preview.scenarios) {
      const row = document.createElement('div');
      row.className = 'overview-row overview-paint-budget-candidate';
      const delta = scenario.vsPlannedDeltaYuan;
      const deltaText = delta > 0 ? `高于计划 ¥${delta.toLocaleString()}` : `低于计划 ¥${Math.abs(delta).toLocaleString()}`;
      row.textContent = `面漆${scenario.topcoats}遍${scenario.deductOpenings ? '、扣门窗洞' : '、不扣门窗洞（对照）'}：${scenario.areaSqm.toFixed(2)}㎡ → 面漆 ${scenario.topcoatBuckets} 桶 + 底漆 ${scenario.primerBuckets} 桶，材料 ¥${scenario.materialYuan.toLocaleString()} + 人工 ¥${scenario.laborYuan.toLocaleString()} = ¥${scenario.subtotalYuan.toLocaleString()}（${deltaText}）`;
      this.budgetEl.appendChild(row);
    }

    // 外部报价（包工包料等）：折算成总额，与计划额、与自下而上模型三方对照。
    // 覆盖范围未确认的报价不解释成「省了/超了」，而是显形为「隐含额度」。
    for (const quote of preview.quotes ?? []) {
      const row = document.createElement('div');
      row.className = 'overview-row overview-paint-budget-quote';
      const delta = quote.vsPlannedDeltaYuan;
      const deltaText = delta > 0 ? `高于计划 ¥${delta.toLocaleString()}` : `低于计划 ¥${Math.abs(delta).toLocaleString()}`;
      row.textContent = `报价 ${quote.source}（包工包料 ¥${quote.rateYuanPerSqm.toLocaleString()}/㎡ × ${quote.areaSqm.toFixed(2)}㎡ = ¥${quote.totalYuan.toLocaleString()}，${deltaText}）`;
      this.budgetEl.appendChild(row);

      const detail = document.createElement('div');
      detail.className = 'overview-empty overview-paint-budget-quote-note';
      detail.textContent = `与自下而上涂刷模型差 ¥${quote.vsBrushingModelDeltaYuan.toLocaleString()}（折合 ${quote.impliedAllowanceYuanPerSqm.toLocaleString()} 元/㎡）：若该报价含基层修补、找平批刮腻子、颜色样板与成品保护，这部分就是那几项的隐含额度。覆盖范围${quote.coverage === 'pending_confirmation' ? '与遍数均' : ''}未确认，暂不与 PKG-080 计划额划等号。`;
      this.budgetEl.appendChild(detail);
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

  /**
   * 预算汇总行。`opts.valueText` 让调用方给一段自定义文本（如「¥3,000 / ¥121,028」这种
   * 两段式金额），`opts.className` 给整行换色（候选价门控用琥珀色，见 style.css）。
   */
  private appendBudgetRow(
    label: string,
    value: number | undefined,
    opts: { className?: string; valueText?: string } = {},
  ): void {
    const row = document.createElement('div');
    row.className = opts.className ? `overview-row ${opts.className}` : 'overview-row';
    const labelClass = opts.className ? `overview-label ${opts.className}-label` : 'overview-label';
    const valueClass = opts.className ? `overview-value ${opts.className}-value` : 'overview-value';
    const shown = opts.valueText ?? (value === undefined ? '—' : `¥${value.toLocaleString()}`);
    row.innerHTML = `
      <span class="${labelClass}">${escapeHtml(label)}</span>
      <span class="${valueClass}">${escapeHtml(shown)}</span>
    `;
    this.budgetEl.appendChild(row);
  }

  /**
   * 候选价门控的两档合计（2026-10-13 阶段 1.5：**只读展示，一个数字都不改**）。
   *
   * 阶段 1（`a50d2f2`）已把每科 `autoActual`（材料款）按材料 status 拆成
   * `verifiedActual` / `candidateActual`，但 OverviewMenu 一直没有读它——数据躺在
   * 那儿没人消费，业主看到的「已用」仍是一条把 39 条未取证候选价全额计入的数。
   * 这里第一次消费它，让「这个预算数不可信」变成一眼可见。
   *
   * 口径与 `server/budget-calculator.ts` 的 `autoActualBucket` 同源：
   * - 已取证：status 属于 measured / confirmed / quoted_sheet / contracted /
   *   provided_by_developer / user_budget_confirmed；
   * - 未取证候选价：其余（candidate / pending_verification / estimated /
   *   owner_reported / rejected），以及没有 status 字段的合成选项（当前只有 hvac）；
   * - 人工（computeLabor）与人工录入（manualActual）两档都不进门控，只进 `actual`。
   */
  private budgetGateTotals(): {
    verified: number;
    candidate: number;
    gated: number;
    total: number;
    residual: number;
  } {
    let verified = 0;
    let candidate = 0;
    for (const category of this.budget?.categories ?? []) {
      verified += category.verifiedActual ?? 0;
      candidate += category.candidateActual ?? 0;
    }
    const total = this.budget?.totalActual ?? 0;
    const gated = verified + candidate;
    // residual = 人工 + 人工录入。门控两档只覆盖材料款，所以它是 totalActual 与 gated 的差，
    // 而不是某个单独字段——这样即使将来 manualActual 非零，文案里的加法依然自洽。
    return { verified, candidate, gated, total, residual: total - gated };
  }

  /** 候选价门控汇总行：整包装配里有多少钱其实还没拿到报价。 */
  private renderBudgetGateSummary(totalLabel: string): void {
    const { verified, candidate, gated, total, residual } = this.budgetGateTotals();
    // 全科已取证时不再占版面——那时「未取证 ¥0」是噪音而不是信息。
    if (candidate <= 0) return;

    this.appendBudgetRow('已取证 / 未取证候选价', undefined, {
      className: 'overview-budget-gate',
      valueText: `¥${verified.toLocaleString()} / ¥${candidate.toLocaleString()}`,
    });

    const ratio = gated > 0 ? (candidate / gated) * 100 : 0;
    const note = document.createElement('div');
    note.className = 'overview-empty overview-budget-gate-note';
    note.textContent =
      `未取证候选价占材料款 ${ratio.toFixed(1)}%（¥${candidate.toLocaleString()} / ¥${gated.toLocaleString()}）：` +
      `这些金额来自 materials.yaml 里的 candidate / pending_verification / estimated，或没有 status 的合成选项（如 hvac），` +
      `尚未拿到报价单或现场核验，成交价可能变。` +
      `${totalLabel} ¥${total.toLocaleString()} = 材料款 ¥${gated.toLocaleString()} + 人工与人工录入 ¥${residual.toLocaleString()}（后两者不进门控两档）。`;
    this.budgetEl.appendChild(note);
  }

  private renderBudgetCategories(): void {
    if (!this.budget) return;
    for (const category of this.budget.categories) {
      // 跳过条件必须带上 candidateActual：否则一旦出现「actual=0 但候选价>0」的科目
      // （例如 R1 的 doors_windows 修好之后），未取证的候选价会被整行静默跳过——
      // 「静默归零」与「静默发明」是同一种病，只是方向相反。
      if (category.actual === 0 && category.budget === 0 && (category.candidateActual ?? 0) === 0) continue;
      const row = document.createElement('div');
      row.className = 'overview-row';
      row.innerHTML = `
        <span class="overview-label">${escapeHtml(category.key)}</span>
        <span class="overview-value">¥${category.actual.toLocaleString()} / ¥${category.budget.toLocaleString()}</span>
      `;
      this.budgetEl.appendChild(row);

      this.appendBudgetGateSplit(category);
    }
  }

  /**
   * 逐科的候选价拆分行。只在 `candidateActual > 0` 时出现，全科已取证的科目不占版面。
   * 纯展示：不改 `actual`，也不改任何计算输入——把 candidate 剔出 actual 是阶段 5 的事。
   */
  private appendBudgetGateSplit(category: BudgetCategory): void {
    const candidate = category.candidateActual ?? 0;
    if (candidate <= 0) return;
    const verified = category.verifiedActual ?? 0;
    const valueText = verified > 0
      ? `已取证 ¥${verified.toLocaleString()} + 未取证 ¥${candidate.toLocaleString()}`
      : `全部 ¥${candidate.toLocaleString()} 为未取证候选价`;
    this.appendBudgetRow('  └ 其中', undefined, {
      className: 'overview-budget-gate-split',
      valueText,
    });
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
