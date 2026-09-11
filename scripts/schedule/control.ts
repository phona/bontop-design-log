import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import * as yaml from 'js-yaml';

type AnyRecord = Record<string, any>;

const root = process.cwd();
const phaseDir = path.join(root, 'schedule/phase-1');
const controlPath = path.join(phaseDir, 'control.yaml');
const acceptancePath = path.join(root, 'config/acceptance.yaml');
const roadmapPath = path.join(root, 'schedule/roadmap.yaml');
const control = yaml.load(fs.readFileSync(controlPath, 'utf8')) as AnyRecord;
const acceptance = yaml.load(fs.readFileSync(acceptancePath, 'utf8')) as AnyRecord;
const roadmap = yaml.load(fs.readFileSync(roadmapPath, 'utf8')) as AnyRecord;

const money = (value: number | null) => value == null ? '—' : `¥${value.toLocaleString('zh-CN')}`;
const moneyOrPending = (value: number | null) => value == null ? '待报价/待算量' : money(value);
const range = (value: AnyRecord) => value.min === value.max ? `${value.min}天` : `${value.min}—${value.max}天`;
const list = (value: unknown[] | undefined) => value?.length ? value.join('、') : '无';
const escapeCell = (value: unknown) => String(value ?? '—').replaceAll('|', '\\|').replaceAll('\n', '<br>');

const errors: string[] = [];
const roadmapPhaseIds = new Set<string>();
const packageIds = new Set<string>();
const checkIds = new Set<string>();
const componentIds = new Set<string>();
const usedCheckIds = new Set<string>();
const packageCheckKeys = new Set<string>();
const quoteRecordIds = new Set<string>();
const hotWaterDecision = control.appliance_quote_register?.hot_water_decision;
const acceptanceById = new Map<string, AnyRecord>();
const blockerIds = new Set<string>((control.global_blockers ?? []).map((item: AnyRecord) => item.id));
const poolIds = new Set<string>((control.budget_pools ?? []).map((item: AnyRecord) => item.id));

for (const phase of acceptance.phases ?? []) {
  for (const item of phase.items ?? []) {
    if (acceptanceById.has(item.id)) errors.push(`duplicate acceptance id: ${item.id}`);
    acceptanceById.set(item.id, {...item, phase: phase.phase, phase_name: phase.name});
  }
}

for (const phase of roadmap.phases ?? []) {
  if (roadmapPhaseIds.has(phase.id)) errors.push(`duplicate roadmap phase id: ${phase.id}`);
  roadmapPhaseIds.add(phase.id);
}
for (const phase of roadmap.phases ?? []) {
  for (const dependency of phase.depends_on ?? []) {
    if (!roadmapPhaseIds.has(dependency)) errors.push(`${phase.id}: unknown phase dependency ${dependency}`);
  }
  const phaseControlPath = path.join(root, phase.directory, 'control.yaml');
  if (!fs.existsSync(phaseControlPath)) {
    errors.push(`${phase.id}: missing ${phaseControlPath}`);
    continue;
  }
  const phaseControl = yaml.load(fs.readFileSync(phaseControlPath, 'utf8')) as AnyRecord;
  if (phaseControl.phase_id !== phase.id) errors.push(`${phase.id}: control phase_id mismatch`);
  if (phase.id === control.phase_id) {
    if (phase.budget.ceiling_cny !== control.control.phase_ceiling_cny) errors.push(`${phase.id}: roadmap ceiling mismatch`);
    if (phase.budget.allocated_cny !== control.control.allocated_cny) errors.push(`${phase.id}: roadmap allocated mismatch`);
    if (phase.budget.unallocated_cny !== control.control.unallocated_cny) errors.push(`${phase.id}: roadmap unallocated mismatch`);
  } else {
    if (phase.budget.estimate_min_cny !== phaseControl.budget.estimate_min_cny) errors.push(`${phase.id}: roadmap minimum mismatch`);
    if (phase.budget.estimate_max_cny !== phaseControl.budget.estimate_max_cny) errors.push(`${phase.id}: roadmap maximum mismatch`);
    if (phaseControl.budget.estimate_min_cny > phaseControl.budget.estimate_max_cny) errors.push(`${phase.id}: invalid budget range`);
    if (phaseControl.items?.length) {
      const itemMin = phaseControl.items.reduce((sum: number, item: AnyRecord) => sum + item.estimate_min_cny, 0);
      const itemMax = phaseControl.items.reduce((sum: number, item: AnyRecord) => sum + item.estimate_max_cny, 0);
      if (itemMin < phaseControl.budget.estimate_min_cny || itemMax > phaseControl.budget.estimate_max_cny) {
        errors.push(`${phase.id}: item range ${itemMin}-${itemMax} exceeds phase range`);
      }
    }
  }
}

for (const pkg of control.work_packages ?? []) {
  if (packageIds.has(pkg.id)) errors.push(`duplicate package id: ${pkg.id}`);
  packageIds.add(pkg.id);
  if (!control.control.status_values.includes(pkg.status)) errors.push(`${pkg.id}: invalid status ${pkg.status}`);
  if (!control.control.readiness_values.includes(pkg.readiness)) errors.push(`${pkg.id}: invalid readiness ${pkg.readiness}`);
  if (!poolIds.has(pkg.budget_pool)) errors.push(`${pkg.id}: unknown budget pool ${pkg.budget_pool}`);
  if (typeof pkg.budget?.planned_cny !== 'number' || pkg.budget.planned_cny < 0) errors.push(`${pkg.id}: planned_cny must be a non-negative number`);
  for (const component of pkg.budget?.components ?? []) {
    if (componentIds.has(component.id)) errors.push(`duplicate cost component id: ${component.id}`);
    componentIds.add(component.id);
    if (!component.id || !component.name || !component.description || !component.quantity_basis || !component.status) {
      errors.push(`${pkg.id}: incomplete cost component ${component.id ?? '(missing id)'}`);
    }
    if (component.planned_cny != null && (typeof component.planned_cny !== 'number' || component.planned_cny < 0)) {
      errors.push(`${component.id}: planned_cny must be null or a non-negative number`);
    }
  }
  const components = pkg.budget?.components ?? [];
  if (components.length && components.every((component: AnyRecord) => component.planned_cny != null)) {
    const componentTotal = components.reduce((sum: number, component: AnyRecord) => sum + component.planned_cny, 0);
    if (componentTotal !== pkg.budget.planned_cny) errors.push(`${pkg.id}: cost components=${componentTotal}, package=${pkg.budget.planned_cny}`);
  }
  if (!(pkg.acceptance_refs?.length || pkg.checks?.length)) errors.push(`${pkg.id}: no acceptance checks`);
  for (const blocker of pkg.blockers ?? []) {
    if (!blockerIds.has(blocker)) errors.push(`${pkg.id}: unknown blocker ${blocker}`);
  }
  for (const ref of pkg.acceptance_refs ?? []) {
    if (!acceptanceById.has(ref)) errors.push(`${pkg.id}: unknown acceptance ref ${ref}`);
    usedCheckIds.add(ref);
    packageCheckKeys.add(`${pkg.id}:${ref}`);
  }
  for (const check of pkg.checks ?? []) {
    if (checkIds.has(check.id) || acceptanceById.has(check.id)) errors.push(`duplicate check id: ${check.id}`);
    checkIds.add(check.id);
    usedCheckIds.add(check.id);
    packageCheckKeys.add(`${pkg.id}:${check.id}`);
    if (!check.evidence_required?.length) errors.push(`${check.id}: missing evidence_required`);
  }
}

for (const quote of control.appliance_quote_register?.records ?? []) {
  if (quoteRecordIds.has(quote.id)) errors.push(`duplicate appliance quote id: ${quote.id}`);
  quoteRecordIds.add(quote.id);
  if (!componentIds.has(quote.component_id)) errors.push(`${quote.id}: unknown appliance cost component ${quote.component_id}`);
  if (!quote.category || !quote.brand || !quote.model || !quote.key_spec || !quote.fit_status || !quote.source_url || !quote.source_checked_at) {
    errors.push(`${quote.id}: incomplete appliance quote record`);
  }
  if (typeof quote.public_reference_cny !== 'number' || quote.public_reference_cny < 0) {
    errors.push(`${quote.id}: public_reference_cny must be a non-negative number`);
  }
}
if (!hotWaterDecision?.category || !hotWaterDecision?.preferred_model || !hotWaterDecision?.fallback_model) {
  errors.push('appliance quote register: incomplete hot water decision');
} else {
  const hotWaterModels = new Set((control.appliance_quote_register?.records ?? [])
    .filter((quote: AnyRecord) => quote.component_id === 'COST-160-05')
    .map((quote: AnyRecord) => quote.model));
  if (!hotWaterModels.has(hotWaterDecision.preferred_model)) errors.push(`hot water preferred model missing from quote register: ${hotWaterDecision.preferred_model}`);
  if (!hotWaterModels.has(hotWaterDecision.fallback_model)) errors.push(`hot water fallback model missing from quote register: ${hotWaterDecision.fallback_model}`);
}

for (const pkg of control.work_packages ?? []) {
  for (const dependency of pkg.dependencies ?? []) {
    if (!packageIds.has(dependency)) errors.push(`${pkg.id}: unknown dependency ${dependency}`);
    if (dependency === pkg.id) errors.push(`${pkg.id}: self dependency`);
  }
}

const poolTotals = new Map<string, number>();
for (const pkg of control.work_packages ?? []) {
  poolTotals.set(pkg.budget_pool, (poolTotals.get(pkg.budget_pool) ?? 0) + pkg.budget.planned_cny);
}
for (const pool of control.budget_pools ?? []) {
  if ((poolTotals.get(pool.id) ?? 0) !== pool.planned_cny) {
    errors.push(`${pool.id}: packages=${poolTotals.get(pool.id) ?? 0}, pool=${pool.planned_cny}`);
  }
}
const allocated = (control.budget_pools ?? []).reduce((sum: number, pool: AnyRecord) => sum + pool.planned_cny, 0);
if (allocated !== control.control.allocated_cny) errors.push(`allocated mismatch: computed=${allocated}, declared=${control.control.allocated_cny}`);
if (allocated + control.control.unallocated_cny !== control.control.phase_ceiling_cny) errors.push('allocated + unallocated != phase ceiling');
const fixed = (poolTotals.get('hard_finish') ?? 0) + (poolTotals.get('hvac') ?? 0);
if (fixed !== control.control.fixed_works_cny) errors.push(`fixed works mismatch: computed=${fixed}, declared=${control.control.fixed_works_cny}`);
if (control.budget_reconciliation?.phase_1_ceiling_cny !== control.control.phase_ceiling_cny) errors.push('budget reconciliation ceiling mismatch');

const pendingBudgetGaps = (control.work_packages ?? [])
  .filter((pkg: AnyRecord) => (pkg.budget.estimated_need_cny ?? pkg.budget.planned_cny) > pkg.budget.planned_cny)
  .map((pkg: AnyRecord) => ({
    ...pkg,
    gap_cny: pkg.budget.estimated_need_cny - pkg.budget.planned_cny,
  }));
const knownPendingGap = pendingBudgetGaps.reduce((sum: number, pkg: AnyRecord) => sum + pkg.gap_cny, 0);
const unpricedComponents = (control.work_packages ?? []).flatMap((pkg: AnyRecord) =>
  (pkg.budget?.components ?? [])
    .filter((component: AnyRecord) => component.planned_cny == null)
    .map((component: AnyRecord) => ({package_id: pkg.id, ...component})),
);
const quoteRecords = control.appliance_quote_register?.records ?? [];
const appliancePackage = control.work_packages.find((pkg: AnyRecord) => pkg.id === 'PKG-160');

const auditByCheckKey = new Map<string, AnyRecord>();
const auditRecordIds = new Set<string>();
for (const record of control.audit_log?.records ?? []) {
  if (auditRecordIds.has(record.id)) errors.push(`duplicate audit record id: ${record.id}`);
  auditRecordIds.add(record.id);
  if (!packageIds.has(record.package_id)) errors.push(`${record.id}: unknown package ${record.package_id}`);
  const checkKey = `${record.package_id}:${record.check_id}`;
  if (!packageCheckKeys.has(checkKey)) errors.push(`${record.id}: check ${record.check_id} does not belong to ${record.package_id}`);
  if (!control.audit_log.record_schema.status_values.includes(record.status)) errors.push(`${record.id}: invalid audit status ${record.status}`);
  if (!record.checked_at || !record.checked_by) errors.push(`${record.id}: missing checked_at or checked_by`);
  if (!Array.isArray(record.evidence)) errors.push(`${record.id}: evidence must be an array`);
  if (record.status === 'passed' && record.evidence.length === 0) errors.push(`${record.id}: passed result requires evidence`);
  if (record.supersedes && !auditRecordIds.has(record.supersedes)) errors.push(`${record.id}: supersedes must reference an earlier record`);
  auditByCheckKey.set(checkKey, record);
}

if (errors.length) {
  console.error(errors.map(error => `- ${error}`).join('\n'));
  process.exit(1);
}

const header = (title: string) => `# ${title}\n\n> 自动生成：请勿直接编辑。唯一维护源：\`schedule/phase-1/control.yaml\`  \n> 生成日期：${control.updated_at}  \n> 当前阶段：${control.control.current_gate}；总体状态：${control.control.status}\n\n`;
const packageChecks = (pkg: AnyRecord) => [
  ...(pkg.acceptance_refs ?? []).map((ref: string) => ({...acceptanceById.get(ref), id: ref, checkpoint: '引用', evidence_required: ['照片或检测记录']})),
  ...(pkg.checks ?? []),
];
const gateStatus = (pkg: AnyRecord) => {
  const critical = packageChecks(pkg).filter((item: AnyRecord) => item.severity === 'critical');
  if (critical.some((item: AnyRecord) => auditByCheckKey.get(`${pkg.id}:${item.id}`)?.status === 'failed')) return 'failed';
  if (critical.length && critical.every((item: AnyRecord) => auditByCheckKey.get(`${pkg.id}:${item.id}`)?.status === 'passed')) return 'passed';
  return 'pending';
};
const auditDisplay = (packageId: string, checkId: string) => {
  const record = auditByCheckKey.get(`${packageId}:${checkId}`);
  if (!record) return {box: '[ ]', result: 'pending'};
  const box = record.status === 'passed' ? '[x]' : record.status === 'failed' ? '[!]' : '[-]';
  const evidence = record.evidence?.length ? `；证据：${record.evidence.join('、')}` : '';
  return {box, result: `${record.status}；${record.checked_by}；${record.checked_at}${evidence}`};
};
const glossarySection = () => {
  let markdown = '## 装修术语通俗解释\n\n| 专业说法 | 通俗解释 |\n|---|---|\n';
  for (const entry of control.glossary ?? []) {
    markdown += `| ${escapeCell(entry.term)} | ${escapeCell(entry.plain_description)} |\n`;
  }
  return markdown;
};

let budgetMd = header('一期预算控制表');
budgetMd += '## 总控\n\n| 项目 | 金额 |\n|---|---:|\n';
for (const pool of control.budget_pools) budgetMd += `| ${escapeCell(pool.name)} | ${money(pool.planned_cny)} |\n`;
budgetMd += `| **已分配** | **${money(allocated)}** |\n| 未分配额度 | ${money(control.control.unallocated_cny)} |\n| **一期总上限** | **${money(control.control.phase_ceiling_cny)}** |\n`;
budgetMd += `\n一期固定工程为 **${money(fixed)}**（基础硬装加中央空调）。中央空调单独记账，但属于一期必做工程。\n\n`;
budgetMd += '## 家电型号与公开参考价\n\n';
budgetMd += `> 以下是 ${control.appliance_quote_register?.collected_at ?? '—'} 收集的市场公开参考，不是已锁定合同价。需在交房、复尺和门店询价后，补齐含安装、辅材、送货、拆旧、发票与质保的逐台书面报价。\n\n`;
budgetMd += '| 费用ID | 类别 | 品牌/型号 | 关键规格 | 公开参考价 | 现场/方案状态 | 来源 |\n|---|---|---|---|---:|---|---|\n';
for (const quote of quoteRecords) {
  budgetMd += `| ${quote.component_id} | ${escapeCell(quote.category)} | ${escapeCell(`${quote.brand} ${quote.model}`)} | ${escapeCell(quote.key_spec)} | ${money(quote.public_reference_cny)} | ${escapeCell(quote.fit_status)} | [品牌页面](${quote.source_url}) |\n`;
}
if (hotWaterDecision) {
  budgetMd += `\n### 热水器确认结论\n\n- 类别：**${escapeCell(hotWaterDecision.category)}**；业主确认：${escapeCell(hotWaterDecision.owner_confirmation)}。\n- 主选候选：**${escapeCell(hotWaterDecision.preferred_model)}**（${escapeCell(hotWaterDecision.preferred_status)}）。\n- 预算备选：**${escapeCell(hotWaterDecision.fallback_model)}**。\n- 选择依据：${escapeCell(hotWaterDecision.rationale)}。\n- 下单前必须逐项完成：${escapeCell(hotWaterDecision.must_confirm_before_order)}。\n\n`;
}
if (appliancePackage?.budget?.public_reference_floor_cny != null) {
  budgetMd += `\n按目标规格筛选的家电候选公开参考价下限为 **${money(appliancePackage.budget.public_reference_floor_cny)}**，尚未包含安装和辅材；${escapeCell(appliancePackage.budget.public_reference_floor_note)}\n\n`;
}
budgetMd += '## 逐项预算与执行\n\n| 系统编号 | 费用项目 | 具体包括 | 预算池 | 计划 | 合同 | 已付 | 预测 | 状态 | 付款门槛 | 门槛状态 |\n|---|---|---|---|---:|---:|---:|---:|---|---|---|\n';
for (const pkg of control.work_packages) {
  const pool = control.budget_pools.find((item: AnyRecord) => item.id === pkg.budget_pool);
  budgetMd += `| ${pkg.id} | ${escapeCell(pkg.name)} | ${escapeCell(pkg.description)} | ${escapeCell(pool.name)} | ${money(pkg.budget.planned_cny)} | ${money(pkg.budget.contracted_cny)} | ${money(pkg.budget.paid_cny)} | ${money(pkg.budget.forecast_cny)} | ${pkg.status} | ${pkg.payment_gate} | ${gateStatus(pkg)} |\n`;
}
budgetMd += '\n## 已知待分配预算缺口\n\n';
if (pendingBudgetGaps.length) {
  budgetMd += '| 系统编号 | 项目 | 当前已分配 | 当前需求估算 | 待分配缺口 | 处理状态 |\n|---|---|---:|---:|---:|---|\n';
  for (const pkg of pendingBudgetGaps) {
    budgetMd += `| ${pkg.id} | ${escapeCell(pkg.name)} | ${money(pkg.budget.planned_cny)} | ${money(pkg.budget.estimated_need_cny)} | ${money(pkg.gap_cny)} | ${escapeCell(pkg.budget.funding_status)} |\n`;
  }
  budgetMd += `\n已知缺口合计 **${money(knownPendingGap)}**。当前未分配额度为 ${money(control.control.unallocated_cny)}；若批准用其中${money(knownPendingGap)}补足窗帘，尚余${money(control.control.unallocated_cny - knownPendingGap)}，但在批准前不能自动视为已解决。\n`;
} else {
  budgetMd += '当前没有已量化但尚未分配的预算缺口。\n';
}
budgetMd += '\n## 旧预算与当前执行预算对账\n\n';
budgetMd += `- 当前一期执行上限：${money(control.budget_reconciliation.phase_1_ceiling_cny)}，唯一执行源为 \`${control.budget_reconciliation.execution_authority}\`。\n`;
budgetMd += `- 历史估算总额：${money(control.budget_reconciliation.historical_baseline.total_budget_cny)}；历史上限：${money(control.budget_reconciliation.historical_baseline.project_ceiling_cny)}。两者仅供追溯，不用于签约或付款。\n`;
budgetMd += `- 说明：${control.budget_reconciliation.explanation}\n`;
budgetMd += `\n## 尚未取得报价或工程量的缺口\n\n当前共有 **${unpricedComponents.length}个**费用项仍是“待报价/待算量”。因此目前只能证明计划分配合计没有超过24万元，**还不能证明最终合同不会超预算**。应在交房量房、设备选型和同口径报价完成后，把每个费用项的金额补齐，再比较父工作包控制额。\n`;
budgetMd += '\n## 工作包内部询价明细\n\n> “待报价/待算量”不是0元。父工作包计划额是当前控制额度，只有逐项报价完成后才可判断该额度是否足够。\n\n';
for (const pkg of control.work_packages.filter((item: AnyRecord) => item.budget?.components?.length)) {
  budgetMd += `### ${pkg.id}｜${pkg.name}\n\n计划控制额：${money(pkg.budget.planned_cny)}；拆分状态：\`${pkg.budget.allocation_status ?? '—'}\`。\n\n`;
  if (pkg.budget.priority_policy?.length) {
    budgetMd += '采购优先级规则：\n\n';
    for (const rule of pkg.budget.priority_policy) budgetMd += `- **${rule.level}｜${escapeCell(rule.name)}**：${escapeCell(rule.rule)}\n`;
    budgetMd += '\n';
  }
  budgetMd += '| 优先级 | 费用ID | 可单独询价的项目 | 包含内容 | 数量或计价依据 | 当前金额 | 状态 |\n|---|---|---|---|---|---:|---|\n';
  for (const component of pkg.budget.components) {
    const priority = component.priority ? `${component.priority}${component.priority_name ? `｜${component.priority_name}` : ''}` : '—';
    budgetMd += `| ${escapeCell(priority)} | ${component.id} | ${escapeCell(component.name)} | ${escapeCell(component.description)} | ${escapeCell(component.quantity_basis)} | ${moneyOrPending(component.planned_cny)} | ${component.status} |\n`;
  }
  budgetMd += '\n';
}
budgetMd += '\n## 预算审计规则\n\n';
for (const rule of control.control.rules) budgetMd += `- [ ] ${rule}\n`;

let scheduleMd = header('一期施工计划');
scheduleMd += '## 状态说明\n\n`not_started → in_progress → ready_for_inspection → passed`；发现问题进入 `failed`，现场条件不满足时为 `blocked`。\n\n';
scheduleMd += '## 施工顺序\n\n| 顺序 | 系统编号 | 施工项目 | 这一步具体做什么 | 参考工期 | 前一步必须完成 | 是否具备开工条件 | 当前进度 | 尚未解决的事项 | 预算 |\n|---:|---|---|---|---:|---|---|---|---|---:|\n';
for (const pkg of control.work_packages.filter((item: AnyRecord) => item.sequence < 900)) {
  scheduleMd += `| ${pkg.sequence} | ${pkg.id} | ${escapeCell(pkg.name)} | ${escapeCell(pkg.description)} | ${range(pkg.duration_workdays)} | ${list(pkg.dependencies)} | ${pkg.readiness} | ${pkg.status} | ${list(pkg.blockers)} | ${money(pkg.budget.planned_cny)} |\n`;
}
scheduleMd += '\n## 全局阻塞项\n\n| ID | 状态 | 事项 | 解除条件 |\n|---|---|---|---|\n';
for (const blocker of control.global_blockers) scheduleMd += `| ${blocker.id} | ${blocker.status} | ${escapeCell(blocker.item)} | ${escapeCell(blocker.clears_when)} |\n`;
scheduleMd += '\n## 强制门槛\n\n';
scheduleMd += '- [ ] 依赖工作包全部 `passed` 后，下一工作包才可变为 `ready`。\n';
scheduleMd += '- [ ] 中央空调第一次安装与水电隐蔽验收未通过，不得签发吊顶封板许可。\n';
scheduleMd += '- [ ] 防水及闭水验收未通过，不得进入覆盖相关区域的泥瓦施工。\n';
scheduleMd += '- [ ] 定制产品未取得复尺单和确认版深化图，不得下单。\n';
scheduleMd += '- [ ] 工作包关键检查未通过或证据缺失，不得释放对应付款。\n';
scheduleMd += `\n${glossarySection()}`;

let checklistMd = header('一期施工、预算与验收统一审计清单');
checklistMd += `## 项目总控\n\n- [ ] 一期已分配金额为 ${money(allocated)}，未分配 ${money(control.control.unallocated_cny)}，总上限 ${money(control.control.phase_ceiling_cny)}。\n- [ ] 基础硬装与中央空调合计 ${money(fixed)}，均属于一期固定工程。\n- [ ] 已量化但尚未分配的预算缺口为 ${money(knownPendingGap)}；未取得业主批准前保持待处理。\n- [ ] ${unpricedComponents.length}个待报价/待算量费用项已经逐项取得金额，并与父工作包控制额完成对账。\n- [ ] 所有现场未知项保持 blocked/site_pending，未以推测替代确认。\n\n`;
checklistMd += '## 家电型号、公开报价与适配核对\n\n';
checklistMd += '- [ ] 每台一期家电都取得含安装、辅材、送货、拆旧、发票和质保边界的书面报价；公开参考价不得直接当作合同价。\n';
checklistMd += '- [ ] 冰箱完成面净开口、深度、净高、开门余量和散热缝已复测后，才允许下单。\n';
checklistMd += '- [ ] 燃气热水器的安装墙面、燃气表、排烟、冷凝水、给排水、专用电路和物业要求均有现场记录；类别确认不等于安装条件确认。\n';
if (hotWaterDecision) {
  checklistMd += `- [ ] 热水器类别已确认为${escapeCell(hotWaterDecision.category)}；主选候选为${escapeCell(hotWaterDecision.preferred_model)}，预算备选为${escapeCell(hotWaterDecision.fallback_model)}，但现场条件确认前不得把候选型号当成最终下单型号。\n`;
  checklistMd += `- [ ] 热水器下单前完成：${escapeCell(hotWaterDecision.must_confirm_before_order)}。\n`;
}
checklistMd += '| 勾选 | 费用ID | 类别 | 品牌/型号 | 关键规格 | 公开参考价 | 当前状态 | 来源 |\n|---|---|---|---|---|---:|---|---|\n';
for (const quote of quoteRecords) {
  checklistMd += `| [ ] | ${quote.component_id} | ${escapeCell(quote.category)} | ${escapeCell(`${quote.brand} ${quote.model}`)} | ${escapeCell(quote.key_spec)} | ${money(quote.public_reference_cny)} | ${escapeCell(quote.fit_status)} | [品牌页面](${quote.source_url}) |\n`;
}
if (appliancePackage?.budget?.public_reference_floor_cny != null) {
  checklistMd += `\n- [ ] 按目标规格筛选的家电候选公开参考价下限 ${money(appliancePackage.budget.public_reference_floor_cny)} 已与一期家电预算 ${money(appliancePackage.budget.planned_cny)} 对账，安装和辅材缺口未被隐藏。\n\n`;
}

for (const pkg of control.work_packages) {
  checklistMd += `## ${pkg.id}｜${pkg.name}\n\n`;
  checklistMd += `- 通俗说明：${pkg.description}\n`;
  checklistMd += `- 预算：${money(pkg.budget.planned_cny)}；合同：${money(pkg.budget.contracted_cny)}；已付：${money(pkg.budget.paid_cny)}；预测：${money(pkg.budget.forecast_cny)}\n`;
  checklistMd += `- 依赖：${list(pkg.dependencies)}；就绪：\`${pkg.readiness}\`；执行：\`${pkg.status}\`\n`;
  checklistMd += `- 责任角色：${list(pkg.owner_roles)}；付款门槛：\`${pkg.payment_gate}\`\n`;
  checklistMd += `- 当前付款门槛状态：\`${gateStatus(pkg)}\`\n`;
  if (pkg.blockers?.length) checklistMd += `- 阻塞项：${list(pkg.blockers)}\n`;
  if (pkg.budget?.components?.length) {
    checklistMd += '\n### 预算拆分核对\n\n';
    if (pkg.budget.priority_policy?.length) {
      checklistMd += '采购优先级规则：\n\n';
      for (const rule of pkg.budget.priority_policy) checklistMd += `- **${rule.level}｜${escapeCell(rule.name)}**：${escapeCell(rule.rule)}\n`;
      checklistMd += '\n';
    }
    checklistMd += '| 勾选 | 优先级 | 费用ID | 独立费用项 | 包含内容 | 数量或计价依据 | 当前金额 | 状态 |\n|---|---|---|---|---|---|---:|---|\n';
    for (const component of pkg.budget.components) {
      const priority = component.priority ? `${component.priority}${component.priority_name ? `｜${component.priority_name}` : ''}` : '—';
      checklistMd += `| [ ] | ${escapeCell(priority)} | ${component.id} | ${escapeCell(component.name)} | ${escapeCell(component.description)} | ${escapeCell(component.quantity_basis)} | ${moneyOrPending(component.planned_cny)} | ${component.status} |\n`;
    }
    checklistMd += '\n- [ ] 每个费用项均有数量、单价、品牌型号或服务边界；“待报价/待算量”没有被当作0元。\n';
    checklistMd += '- [ ] 各项报价合计与父工作包合同额一致；重复费用和排除项已标明。\n';
  }
  checklistMd += '\n| 勾选 | ID | 级别/节点 | 验收项 | 方法 | 通过标准 | 必需证据 | 结果/签名/日期 |\n|---|---|---|---|---|---|---|---|\n';
  for (const ref of pkg.acceptance_refs ?? []) {
    const item = acceptanceById.get(ref)!;
    const audit = auditDisplay(pkg.id, item.id);
    checklistMd += `| ${audit.box} | ${item.id} | ${item.severity}/引用 | ${escapeCell(item.item)} | ${escapeCell(item.method)} | ${escapeCell(item.standard)} | 照片或检测记录 | ${escapeCell(audit.result)} |\n`;
  }
  for (const item of pkg.checks ?? []) {
    const audit = auditDisplay(pkg.id, item.id);
    checklistMd += `| ${audit.box} | ${item.id} | ${item.severity}/${item.checkpoint} | ${escapeCell(item.item)} | ${escapeCell(item.method)} | ${escapeCell(item.pass_condition)} | ${list(item.evidence_required)} | ${escapeCell(audit.result)} |\n`;
  }
  checklistMd += '\n- [ ] 所有 critical 检查通过；失败项已有整改和复验记录。\n';
  checklistMd += '- [ ] 必需证据路径已登记且文件可打开。\n';
  checklistMd += `- [ ] 付款门槛 \`${pkg.payment_gate}\` 已由责任人确认。\n\n`;
}
checklistMd += glossarySection();

fs.writeFileSync(path.join(phaseDir, 'budget.md'), budgetMd);
fs.writeFileSync(path.join(phaseDir, 'schedule.md'), scheduleMd);
fs.writeFileSync(path.join(phaseDir, 'checklist.md'), checklistMd);
console.log(`schedule control valid: ${roadmapPhaseIds.size} phases, ${control.work_packages.length} phase-1 packages, ${componentIds.size} cost components (${unpricedComponents.length} unpriced), ${usedCheckIds.size} auditable checks, ${money(allocated)} allocated, ${money(knownPendingGap)} known pending gap`);
