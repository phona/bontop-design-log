import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { buildCostSummary, renderCostSummary, COST_INPUT_PATHS, COST_SUMMARY_PATH } from './cost-summary.js';
import { loadModelPackageLinks, MODEL_PACKAGE_LINKS_PATH } from '../../server/model-package-links.js';
import { authorityFilePaths } from '../../shared/model-package-links.js';
import { loadScheduleState, CONTROL_REL_PATH, ACCEPTANCE_REL_PATH, ROADMAP_REL_PATH } from '../../shared/schedule-state.js';

// 2026-11-02（自装交互审批第一步）：本文件从 1105 行零 export 纯脚本退化为
// 「loader + 渲染器 + CLI」薄壳。加载/校验/派生（原 13-648 行）已搬入
// shared/schedule-state.ts 的 loadScheduleState——server 与前端复用同一份判定，
// 铁律：判定规则只有那一份，这里只做渲染与 CLI。渲染输出逐字不变
// （tests/server/control-contract-validation.test.ts 钉的错误文案随 loader 原样保留）。

type AnyRecord = Record<string, any>;

const root = process.cwd();
const state = loadScheduleState(root, {modelPackageLinks: loadModelPackageLinks(MODEL_PACKAGE_LINKS_PATH)});
const controlRelPath = CONTROL_REL_PATH;
const acceptanceRelPath = ACCEPTANCE_REL_PATH;
const roadmapRelPath = ROADMAP_REL_PATH;
const {
  errors, control, acceptance, roadmap, modelPackageLinks, decisionGates,
  openDecisionGates, openGatedCheckCount, openGates,
  roadmapPhaseIds, packageIds, checkIds, componentIds, usedCheckIds, packageCheckKeys,
  quoteRecordIds, phaseControls, hotWaterDecision, acceptanceById, blockerById,
  orderedPackages, auditByCheckKey,
  quoteRound, quoteRoundRecords, quoteRecords, appliancePackage,
  pendingBudgetGaps, knownPendingGap, unpricedComponents,
  roundTargetTotal, roundQuotedTotal, poolTotals, allocated, fixed,
  money, moneyOrPending, range, list, escapeCell, sha256, unique,
  fileSnapshot, snapshotDigest, scopeSummary, packageModelLinks,
  packageProjectPaths, packageProjectSnapshot, packageProjectFingerprint,
  phaseInputPaths, phaseDataInputPaths, projectInputPaths,
  snapshotComment, fingerprintLine, header, packageChecks, packageGateLabel,
  checkSpecHash, staleAuditReason, auditStatusFor, gateStatus, auditDisplay, glossarySection,
  blockerIsClosed, packageWaiverIsValid, packagePrerequisiteIssues,
  effectiveReadiness, effectivePackageStatus, packageGateIssues,
  currentPackage, nextCheckpoint,
} = state;

if (errors.length) {
  console.error(errors.map(error => `- ${error}`).join('\n'));
  process.exit(1);
}

const renderMode = process.argv.includes('--render');

function selectorLinkTable(packageId: string, outputPath: string): string {
  const links = packageModelLinks(packageId);
  let markdown = '### 关联项目数据\n\n| 数据文件 | 本工作包引用范围 | 映射状态 |\n|---|---|---|\n';
  if (!links.length) markdown += '| — | 未登记项目模型映射 | 未映射 |\n';
  for (const link of links) {
    for (const scope of link.scope ?? []) {
      // authority 可指多文件（overlay = envelope 三文件，issue #98 S1）：逐文件一行，scope 同。
      for (const sourcePath of modelPackageLinks.authorities[scope.source] ? authorityFilePaths(modelPackageLinks.authorities[scope.source]!) : [scope.source]) {
        const relativePath = path.posix.relative(path.posix.dirname(outputPath), sourcePath);
        markdown += `| [${sourcePath}](${relativePath}) | ${escapeCell(scopeSummary(scope.select))} | ${link.mapping_status} |\n`;
      }
    }
    if (!link.scope?.length && link.note) markdown += `| — | ${escapeCell(link.note)} | ${link.mapping_status} |\n`;
  }
  const packageRecord = control.work_packages.find((pkg: AnyRecord) => pkg.id === packageId);
  if (packageRecord && (packageRecord.include_site_data_ledger === true || (packageRecord.blockers ?? []).some((id: string) => ['BLK-HANDOVER', 'BLK-SURVEY-DATA-FREEZE'].includes(id)))) {
    const relativePath = path.posix.relative(path.posix.dirname(outputPath), 'docs/pending-site-data.md');
    markdown += `| [docs/pending-site-data.md](${relativePath}) | 现场待测数据；按各项影响、状态和触发条件闭环 | site ledger |\n`;
  }
  const dataFingerprint = packageRecord ? packageProjectFingerprint(packageRecord) : 'unknown';
  markdown += `\n当前项目数据指纹：\`sha256:${dataFingerprint}\`。记录检查通过时，将此指纹与检查标准指纹写入审计记录；任何输入变化都会把旧通过记录标为 stale。\n\n`;
  return markdown;
}

function currentCheckpointSection(): string {
  if (!currentPackage) return '## 当前推进位置\n\n一期所有施工工作包均已通过或豁免。\n\n';
  const nextCheck = nextCheckpoint(currentPackage);
  let markdown = '## 当前推进位置\n\n';
  markdown += `- **当前工作包**：${currentPackage.id}｜${currentPackage.name}（执行：\`${effectivePackageStatus(currentPackage)}\`；就绪：\`${effectiveReadiness(currentPackage)}\`）。\n`;
  markdown += `- **本包要做什么**：${escapeCell(currentPackage.description)}\n`;
  if (effectiveReadiness(currentPackage) === 'blocked' || currentPackage.blockers?.length) {
    markdown += '- **开工前先关闭**：\n';
    for (const blockerId of currentPackage.blockers ?? []) {
      const blocker = blockerById.get(blockerId);
      markdown += `  - \`${blockerId}\` ${blocker ? `${escapeCell(blocker.item)}；解除条件：${escapeCell(blocker.clears_when)}` : '阻塞项引用待维护'}\n`;
    }
  } else {
    markdown += '- **开工状态**：前置条件已满足，可按本包检查项执行。\n';
  }
  if (nextCheck) {
    const nextLabel = nextCheck.can_run_while_blocked
      ? '当前可推进的预交房检查点'
      : effectiveReadiness(currentPackage) === 'blocked' ? '解除阻塞后的首个现场检查点' : '下一检查点';
    markdown += `- **${nextLabel}**：${nextCheck.id}｜${escapeCell(nextCheck.item)}（${nextCheck.checkpoint ?? '验收'}）；按下表方法检查，通过标准是：${escapeCell(nextCheck.pass_condition ?? nextCheck.standard)}\n`;
    if (nextCheck.can_run_while_blocked) {
      markdown += '- **施工状态保持 blocked**：此项只推进初版设计或现场准备；通过它不会解除量房、专业会审、放线、采购或施工阻塞。\n';
    }
  } else {
    markdown += '- **下一检查点**：本包检查项均有当前通过记录，等待更新工作包状态或进入下一依赖包。\n';
  }
  markdown += `- **参与责任角色**：${list(currentPackage.owner_roles)}。\n`;
  const nextPackage = orderedPackages.find((pkg: AnyRecord) => pkg.sequence > currentPackage.sequence);
  if (nextPackage) markdown += `- **通过后进入**：${nextPackage.id}｜${nextPackage.name}；仍须满足其依赖、阻塞项与开工门槛。\n`;
  markdown += '\n### 工作包进度导航\n\n| 顺序 | 工作包 | 执行状态 | 开工条件 | 未通过检查数 | 付款/放行门槛 |\n|---:|---|---|---|---:|---|\n';
  for (const pkg of orderedPackages) {
    const pendingChecks = packageChecks(pkg).filter((check: AnyRecord) => auditStatusFor(pkg.id, check.id) !== 'passed').length;
    markdown += `| ${pkg.sequence} | [${pkg.id}｜${escapeCell(pkg.name)}](#${pkg.id.toLowerCase()}) | ${effectivePackageStatus(pkg)} | ${effectiveReadiness(pkg)} | ${pendingChecks} | ${gateStatus(pkg)} |\n`;
  }
  return `${markdown}\n`;
}

const stalePhaseGateRecords: string[] = [];

function phaseChecklist(phaseId: string, phaseControl: AnyRecord, phaseName: string, sourcePath: string): string {
  const snapshot = fileSnapshot(phaseInputPaths(phaseId, sourcePath));
  const projectDataFingerprint = snapshotDigest(fileSnapshot(phaseDataInputPaths(phaseId)));
  const status = phaseControl.status ?? phaseControl.decision_state ?? 'unknown';
  const gates = phaseControl.activation_gates ?? [];
  const items = phaseControl.items ?? phaseControl.scope_candidates ?? [];
  let markdown = `${snapshotComment(snapshot)}# ${phaseName}推进清单\n\n> 自动生成：请勿直接编辑。维护源：\`${sourcePath}\`  \n> 视图输入指纹：\`sha256:${snapshotDigest(snapshot)}\`（${Object.keys(snapshot).length} 个输入文件）  \n> Gate记录用项目数据指纹：\`sha256:${projectDataFingerprint}\`  \n> 阶段状态：\`${status}\`；决策状态：\`${phaseControl.decision_state ?? '未声明'}\`\n\n`;
  markdown += '## 当前可执行范围\n\n';
  if (status === 'proposed' || phaseControl.decision_state === 'alignment_required') {
    markdown += '- 当前只执行启动条件核对、范围澄清和预算确认；不得将候选清单视为采购或施工授权。\n';
    markdown += '- 启动门槛全部通过并由业主冻结范围后，须把选中的项目拆成有顺序、依赖、负责人、数据输入、验收标准、证据和验收/付款门槛的工作包，再生成实施清单。\n\n';
  } else {
    markdown += '- 按下方启动门槛和工作包状态推进；任何阻塞项未关闭时保持 blocked。\n\n';
  }
  markdown += '## 阶段启动 Checkpoint\n\n| ID | 当前状态 | 要完成什么 | 通过条件 | 责任角色 | 必需证据 | 当前验收指纹 |\n|---|---|---|---|---|---|---|\n';
  for (const gate of gates) {
    const gateSpec = {
      id: gate.id,
      item: gate.item,
      owner_roles: gate.owner_roles ?? [],
      pass_condition: gate.pass_condition ?? '',
      evidence_required: gate.evidence_required ?? [],
      ...(gate.id.endsWith('GATE-03') ? {scope_decision: {budget: phaseControl.budget, items}} : {}),
    };
    const gateSpecHash = sha256(JSON.stringify(gateSpec));
    const gateRecord = [...(phaseControl.audit?.records ?? [])].reverse().find((record: AnyRecord) => record.gate_id === gate.id);
    const reasons: string[] = [];
    if (gateRecord?.status === 'passed') {
      if (gateRecord.gate_spec_sha256 !== gateSpecHash) reasons.push('gate标准已变化');
      if (gateRecord.project_data_sha256 !== projectDataFingerprint) reasons.push('项目数据已变化');
      if (!gateRecord.evidence?.length) reasons.push('缺少通过证据');
    } else if (!gateRecord && gate.status === 'passed') {
      reasons.push('通过状态没有追加审计记录');
    }
    const gateStatus = reasons.length ? 'stale' : (gateRecord?.status ?? gate.status ?? 'pending');
    if (reasons.length) stalePhaseGateRecords.push(`${gate.id}: ${reasons.join('、')}`);
    const auditText = gateRecord
      ? `${gateRecord.checked_by ?? '—'}；${gateRecord.checked_at ?? '—'}；${list(gateRecord.evidence)}`
      : '尚无检查记录';
    markdown += `| ${gate.id} | ${gateStatus} | ${escapeCell(gate.item)} | ${escapeCell(gate.pass_condition ?? '维护源尚未定义通过条件')} | ${list(gate.owner_roles)} | ${list(gate.evidence_required)} | \`${gateSpecHash}\`<br>${escapeCell(auditText)} |\n`;
  }
  markdown += '\n## 候选范围\n\n| ID | 项目 | 预算区间 | 状态 | 关联项目数据 |\n|---|---|---:|---|---|\n';
  for (const item of items) {
    const link = modelPackageLinks.links.find((candidate) => candidate.budget_ref.id === item.id);
    // authority 可指多文件（overlay = envelope 三文件，issue #98 S1）：展开后逐文件聚合 scope。
    const sourcePaths = unique((link?.scope ?? []).flatMap((scope) => modelPackageLinks.authorities[scope.source] ? authorityFilePaths(modelPackageLinks.authorities[scope.source]!) : []));
    const sourceText = sourcePaths.map((itemPath) => {
      const rel = path.posix.relative(path.posix.dirname(`${itemPath.slice(0, itemPath.lastIndexOf('/'))}/checklist.md`), itemPath);
      const scopes = (link?.scope ?? []).filter((scope) => authorityFilePaths(modelPackageLinks.authorities[scope.source] ?? []).includes(itemPath)).map((scope) => scopeSummary(scope.select));
      return `[${itemPath}](${rel})${scopes.length ? ` — ${escapeCell(scopes.join('; '))}` : ''}`;
    }).join('<br>');
    const budget = item.estimate_min_cny == null ? '不预分配' : `¥${item.estimate_min_cny.toLocaleString('zh-CN')}—¥${item.estimate_max_cny.toLocaleString('zh-CN')}`;
    markdown += `| ${item.id} | ${escapeCell(item.name)} | ${budget} | ${item.status} | ${sourceText || '待补数据映射'} |\n`;
  }
  if (phaseId === 'phase_3_styling' && phaseControl.observation_log_schema) {
    markdown += '\n## 入住观察记录要求\n\n';
    markdown += `每条记录保留：${(phaseControl.observation_log_schema.fields ?? []).join('、')}。观察周期由业主在启动时确认并记录，不用固定天数替代真实使用反馈。\n\n`;
  }
  markdown += '## 验收与记录\n\n';
  markdown += '- 每个启动 Checkpoint 核对后，在阶段控制源的 `audit.records` 追加 `gate_id`、结果、检查人、日期、证据、`gate_spec_sha256` 和 `project_data_sha256`。复验追加记录，不覆盖历史。\n';
  markdown += '- 未定义通过条件、责任角色或证据的 gate 不能标为 passed。\n';
  markdown += '- 项目数据或本阶段范围变化后重新生成清单；旧的通过记录需按当前数据重新核对。\n';
  return markdown;
}

let budgetMd = header('一期预算控制表', controlRelPath, [controlRelPath]);
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
budgetMd += '## 逐项预算与执行\n\n| 系统编号 | 费用项目 | 具体包括 | 预算池 | 计划 | 合同 | 已付 | 预测 | 状态 | 验收/付款门槛 | 门槛状态 |\n|---|---|---|---|---:|---:|---:|---:|---|---|---|\n';
for (const pkg of control.work_packages) {
  const pool = control.budget_pools.find((item: AnyRecord) => item.id === pkg.budget_pool);
  budgetMd += `| ${pkg.id} | ${escapeCell(pkg.name)} | ${escapeCell(pkg.description)} | ${escapeCell(pool.name)} | ${money(pkg.budget.planned_cny)} | ${money(pkg.budget.contracted_cny)} | ${money(pkg.budget.paid_cny)} | ${money(pkg.budget.forecast_cny)} | ${effectivePackageStatus(pkg)} | ${pkg.gate_label ? `${pkg.gate_label}：` : ''}${pkg.payment_gate} | ${gateStatus(pkg)} |\n`;
}
budgetMd += '\n## 已知待分配预算缺口\n\n';
if (pendingBudgetGaps.length) {
  budgetMd += '| 系统编号 | 项目 | 当前已分配 | 当前需求估算 | 待分配缺口 | 处理状态 |\n|---|---|---:|---:|---:|---|\n';
  for (const pkg of pendingBudgetGaps) {
    budgetMd += `| ${pkg.id} | ${escapeCell(pkg.name)} | ${money(pkg.budget.planned_cny)} | ${money(pkg.budget.estimated_need_cny)} | ${money(pkg.gap_cny)} | ${escapeCell(pkg.budget.funding_status)} |\n`;
  }
  budgetMd += `\n已知缺口合计 **${money(knownPendingGap)}**。当前未分配额度为 ${money(control.control.unallocated_cny)}；若批准从未分配额度中等额补足，尚余${money(control.control.unallocated_cny - knownPendingGap)}，差额部分须另行批准资金来源，且在批准前不能自动视为已解决。\n`;
} else {
  budgetMd += '当前没有已量化但尚未分配的预算缺口。\n';
}
budgetMd += '\n## 旧预算与当前执行预算对账\n\n';
budgetMd += `- 当前一期执行上限：${money(control.budget_reconciliation.phase_1_ceiling_cny)}，唯一执行源为 \`${control.budget_reconciliation.execution_authority}\`。\n`;
budgetMd += `- 历史估算总额：${money(control.budget_reconciliation.historical_baseline.total_budget_cny)}；历史上限：${money(control.budget_reconciliation.historical_baseline.project_ceiling_cny)}。两者仅供追溯，不用于签约或付款。\n`;
budgetMd += `- 说明：${control.budget_reconciliation.explanation}\n`;
budgetMd += `\n## 尚未取得报价或工程量的缺口\n\n当前共有 **${unpricedComponents.length}个**费用项仍是“待报价/待算量”。因此目前只能证明计划分配合计没有超过${money(control.control.phase_ceiling_cny)}，**还不能证明最终合同不会超预算**。应在交房量房、设备选型和同口径报价完成后，把每个费用项的金额补齐，再比较父工作包控制额。\n`;
budgetMd += '\n## 询价轮次回填与父包对账\n\n';
budgetMd += `> ${escapeCell(quoteRound.source ?? '—')}  \n> ${escapeCell(quoteRound.pricing_note ?? '')}\n\n`;
budgetMd += '| 轮次记录 | 项目 | 归属工作包 | 轮次目标 | 轮次当前价 | 价格类型 | 状态 | 去重与边界 |\n|---|---|---|---:|---:|---|---|---|\n';
for (const record of quoteRoundRecords) {
  budgetMd += `| ${record.id} | ${escapeCell(record.item)} | ${record.pkg_id} | ${money(record.owner_target_cny)} | ${moneyOrPending(record.owner_current_cny)} | ${record.price_type} | ${escapeCell(record.status)} | ${escapeCell(record.dedup_rule)} |\n`;
}
budgetMd += `\n轮次目标合计 **${money(roundTargetTotal)}**（核心硬装 ${money(quoteRound.round_summary?.core_hard_finish_target_cny ?? null)} + 固定柜体 ${money(quoteRound.round_summary?.extended_cabinet_target_cny ?? null)}）；其中只有 **${money(roundQuotedTotal)}** 属 quoted_sheet（带报价单），其余为业主预算池、封顶价或候选价，不是承诺价，也不覆盖父包控制额。\n\n`;
const roundByPkg = new Map<string, number>();
for (const record of quoteRoundRecords) roundByPkg.set(record.pkg_id, (roundByPkg.get(record.pkg_id) ?? 0) + record.owner_target_cny);
budgetMd += '### 按父包汇总\n\n| 工作包 | 父包计划额 | 轮次目标合计 | 差额 | 处置 |\n|---|---:|---:|---:|---|\n';
for (const [pkgId, roundTotal] of [...roundByPkg.entries()].sort(([left], [right]) => left.localeCompare(right))) {
  const pkg = (control.work_packages ?? []).find((item: AnyRecord) => item.id === pkgId);
  const planned = pkg?.budget.planned_cny ?? 0;
  const diff = roundTotal - planned;
  const handling = pkg?.budget.funding_status
    ? `${pkg.budget.funding_status}（缺口 ${money(diff)}）`
    : (diff > 0 ? '超过父包计划额，待登记资金来源' : '计划额内');
  budgetMd += `| ${pkgId}｜${escapeCell(pkg?.name ?? '—')} | ${money(planned)} | ${money(roundTotal)} | ${money(diff)} | ${escapeCell(handling)} |\n`;
}
budgetMd += `\n注：本表差额按轮次目标计算；「已知待分配预算缺口」按 estimated_need_cny 计算（有报价单时取报价单口径，例如 PKG-070 设备划出后按裸价目标 4,500 控账，而不是原轮次目标 9,100），两者口径不同，且都不构成已批准资金。\n`;
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

let scheduleMd = header('一期施工计划', controlRelPath, [controlRelPath, roadmapRelPath]);
scheduleMd += '## 状态说明\n\n`not_started → in_progress → ready_for_inspection → passed`；发现问题进入 `failed`，现场条件不满足时为 `blocked`。\n\n';
scheduleMd += '## 施工顺序\n\n| 顺序 | 系统编号 | 施工项目 | 这一步具体做什么 | 参考工期 | 前一步必须完成 | 是否具备开工条件 | 当前进度 | 尚未解决的事项 | 预算 |\n|---:|---|---|---|---:|---|---|---|---|---:|\n';
for (const pkg of control.work_packages.filter((item: AnyRecord) => item.sequence < 900)) {
  scheduleMd += `| ${pkg.sequence} | ${pkg.id} | ${escapeCell(pkg.name)} | ${escapeCell(pkg.description)} | ${range(pkg.duration_workdays)} | ${list(pkg.dependencies)} | ${effectiveReadiness(pkg)} | ${effectivePackageStatus(pkg)} | ${list(pkg.blockers)} | ${money(pkg.budget.planned_cny)} |\n`;
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

let checklistMd = header('一期施工、预算与验收统一审计清单', controlRelPath, phaseInputPaths(control.phase_id, controlRelPath));
checklistMd += currentCheckpointSection();
checklistMd += '## 使用规则与数据联动\n\n';
checklistMd += '- 按“当前推进位置”找到工作包；被阻塞时先关闭列出的阻塞项，不跳过前置门槛。\n';
checklistMd += '- 若检查项标注“可在 blocked 中推进，仅预演不放施工”，可继续做可逆设计和资料准备；该项通过不会解除施工 readiness。\n';
checklistMd += '- 每项通过后记录检查人、时间、证据、`check_spec_sha256` 和 `project_data_sha256`；整改复验追加新记录并用 `supersedes` 指向旧记录。\n';
checklistMd += '- 关联的项目配置变化后，旧 PASS 自动显示 stale、对应验收/放行/付款门槛回到 pending；重新验收后追加新记录。\n';
checklistMd += '- 清单中标注「决策门禁」的检查项被 config/decision-gates.yaml 里未拍板的决策阻塞：拍板前不得判 passed；拍板后须在登记表补 decided_value、decided_by、decided_at 与 decision_evidence，旧口径复验追加新记录。\n';
checklistMd += '- 手写纸本只是现场记录；回填到 `control.yaml.audit_log.records` 后运行 `npm run schedule:render` 更新视图。\n\n';
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

checklistMd += '\n## 硬装询价轮次核对\n\n';
checklistMd += '- [ ] 轮次价格已按价格类型分列，quoted_sheet 之外的 owner_budget_pool / cap / candidate 未被当作合同承诺价。\n';
checklistMd += '- [ ] 轮次目标超过父包计划额的工作包已取得资金来源或业主书面批准；未批准前不得动用硬装预备金。\n';
checklistMd += '- [ ] 轮次记录与 COST 组件一一对应；瓦工与防水辅材、浴霸凉霸归属、通用五金等重复计费项已去重。\n';
checklistMd += '- [ ] 轮次记录进入锁定时已补 locked_cny、contract_ref 与 evidence_path，历史轮次只追加不覆盖。\n';
checklistMd += '\n| 勾选 | 轮次记录 | 项目 | 归属工作包 | 轮次目标 | 轮次当前价 | 价格类型 | 状态 |\n|---|---|---|---|---:|---:|---|---|\n';
for (const record of quoteRoundRecords) {
  checklistMd += `| [ ] | ${record.id} | ${escapeCell(record.item)} | ${record.pkg_id} | ${money(record.owner_target_cny)} | ${moneyOrPending(record.owner_current_cny)} | ${record.price_type} | ${escapeCell(record.status)} |\n`;
}
checklistMd += '\n';

for (const pkg of control.work_packages) {
  checklistMd += `<a id="${pkg.id.toLowerCase()}"></a>\n## ${pkg.id}｜${pkg.name}\n\n`;
  checklistMd += `- 通俗说明：${pkg.description}\n`;
  checklistMd += `- 预算：${money(pkg.budget.planned_cny)}；合同：${money(pkg.budget.contracted_cny)}；已付：${money(pkg.budget.paid_cny)}；预测：${money(pkg.budget.forecast_cny)}\n`;
  checklistMd += `- 依赖：${list(pkg.dependencies)}；就绪：\`${effectiveReadiness(pkg)}\`；执行：\`${effectivePackageStatus(pkg)}\`\n`;
  checklistMd += `- 责任角色：${list(pkg.owner_roles)}；${packageGateLabel(pkg)}：\`${pkg.payment_gate}\`\n`;
  checklistMd += `- 当前${packageGateLabel(pkg)}状态：\`${gateStatus(pkg)}\`\n`;
  if (pkg.blockers?.length) checklistMd += `- 阻塞项：${list(pkg.blockers)}\n`;
  checklistMd += `\n${selectorLinkTable(pkg.id, 'schedule/phase-1/checklist.md')}`;
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
  checklistMd += '\n| 勾选 | ID | 级别/节点/执行窗口 | 验收项 | 方法 | 通过标准 | 必需证据 | 检查标准指纹 | 结果/签名/日期 |\n|---|---|---|---|---|---|---|---|---|\n';
  for (const ref of pkg.acceptance_refs ?? []) {
    const item = acceptanceById.get(ref)!;
    const audit = auditDisplay(pkg.id, item.id);
    checklistMd += `| ${audit.box} | ${item.id} | ${item.severity}/引用 | ${escapeCell(item.item)} | ${escapeCell(item.method)} | ${escapeCell(item.standard)} | ${list(item.evidence?.length ? item.evidence : ['照片或检测记录'])} | \`${checkSpecHash(pkg, item.id)}\` | ${escapeCell(audit.result)} |\n`;
  }
  for (const item of pkg.checks ?? []) {
    const audit = auditDisplay(pkg.id, item.id);
    const executionWindow = item.can_run_while_blocked ? '可在 blocked 中推进，仅预演不放施工' : '阻塞解除后';
    checklistMd += `| ${audit.box} | ${item.id} | ${item.severity}/${item.checkpoint}/${executionWindow} | ${escapeCell(item.item)} | ${escapeCell(item.method)} | ${escapeCell(item.pass_condition)} | ${list(item.evidence_required)} | \`${checkSpecHash(pkg, item.id)}\` | ${escapeCell(audit.result)} |\n`;
  }
  // 决策门禁注释：本包检查项里被未拍板决策阻塞的，逐决策列出阻塞了哪些项。
  // 语义与 computeGateStatus 同向——阻塞期间这些项不得出现 passed 记录，
  // 付款门槛自然回到 pending；拍板记录写进 config/decision-gates.yaml。
  const packageOpenGates = new Map<string, { topic: string; checks: string[] }>();
  for (const check of packageChecks(pkg)) {
    for (const decision of openGates.get(check.id) ?? []) {
      const entry = packageOpenGates.get(decision.id) ?? { topic: decision.topic, checks: [] };
      entry.checks.push(check.id);
      packageOpenGates.set(decision.id, entry);
    }
  }
  if (packageOpenGates.size) {
    const detail = [...packageOpenGates.entries()]
      .map(([decisionId, entry]) => `${decisionId} ${entry.topic} → ${entry.checks.join('、')}`)
      .join('；');
    const blockedCount = [...packageOpenGates.values()].reduce((sum, entry) => sum + entry.checks.length, 0);
    checklistMd += `\n- [ ] 决策门禁：${blockedCount} 项检查被 ${packageOpenGates.size} 个未拍板决策阻塞（${detail}）；阻塞期间不得判 passed，付款门槛保持 pending，登记表见 config/decision-gates.yaml。\n`;
  }
  checklistMd += '\n- [ ] 所有 critical 检查通过；失败项已有整改和复验记录。\n';
  checklistMd += '- [ ] 必需证据路径已登记且文件可打开。\n';
  checklistMd += `- [ ] ${packageGateLabel(pkg)} \`${pkg.payment_gate}\` 已由责任人确认。\n\n`;
}
checklistMd += glossarySection();

const phase2Control = phaseControls.get('phase_2_function_upgrade') ?? {};
const phase3Control = phaseControls.get('phase_3_styling') ?? {};
const phase2ChecklistPath = 'schedule/phase-2/checklist.md';
const phase3ChecklistPath = 'schedule/phase-3/checklist.md';
const phase2Checklist = phaseChecklist('phase_2_function_upgrade', phase2Control, '二期功能升级', 'schedule/phase-2/control.yaml');
const phase3Checklist = phaseChecklist('phase_3_styling', phase3Control, '三期入住后优化', 'schedule/phase-3/control.yaml');

const projectSnapshot = fileSnapshot(projectInputPaths);
const pendingSiteText = fs.readFileSync(path.join(root, 'docs/pending-site-data.md'), 'utf8');
const pendingSiteCount = Number(pendingSiteText.match(/量表共\s*(\d+)\s*条/)?.[1] ?? 0);
let projectChecklist = `${snapshotComment(projectSnapshot)}# 项目进度与阶段 Checkpoint\n\n> 自动生成：请勿直接编辑。维护源为各阶段 control.yaml、roadmap.yaml、phase-scope.yaml、model-package-links.yaml、验收标准和已关联项目配置。  \n> 项目数据指纹：\`sha256:${snapshotDigest(projectSnapshot)}\`（${Object.keys(projectSnapshot).length} 个输入文件）  \n> 当前量房待确认台账：${pendingSiteCount} 个编号，详情见 [量房待填清单](../docs/pending-site-data.md)。\n\n`;
projectChecklist += '## 怎么用这份清单\n\n';
projectChecklist += '- 先看阶段表，按“当前状态”和“启动门槛”决定是否进入下一阶段。\n';
projectChecklist += '- 一期按 [一期施工与验收清单](phase-1/checklist.md) 的当前工作包推进；每个包展示开始条件、检查方法、通过标准、证据和关联项目数据。\n';
projectChecklist += '- 二期、三期目前仍是提案，只能核对启动门槛；选定范围后还要把每个项目拆成施工工作包，不能把候选清单当采购或施工指令。\n';
projectChecklist += '- 更新了项目配置或现场台账后，运行 `npm run schedule:render`。`npm run verify:schedule` 只读检查生成文件是否过期，不会替你悄悄重写。\n\n';
projectChecklist += '## 阶段路线与状态\n\n| 阶段 | 当前状态 | 当前预算口径 | 启动 / 下一步条件 | 执行清单 |\n|---|---|---:|---|---|\n';
for (const phase of roadmap.phases ?? []) {
  const phaseControl = phaseControls.get(phase.id) ?? {};
  const isPhase1 = phase.id === control.phase_id;
  const status = isPhase1 ? control.control.status : (phaseControl.status ?? 'unknown');
  const budgetText = isPhase1
    ? `${money(control.control.phase_ceiling_cny)} 上限`
    : `${money(phaseControl.budget?.estimate_min_cny ?? null)}—${money(phaseControl.budget?.estimate_max_cny ?? null)}`;
  const nextCondition = isPhase1
    ? (phase.activation_gate ?? '按 PKG-000 的量房、图纸、报价和合同检查点推进')
    : (phase.activation_gate ?? '查看本阶段启动门槛');
  const checklistPath = isPhase1 ? 'phase-1/checklist.md' : phase.id === 'phase_2_function_upgrade' ? 'phase-2/checklist.md' : 'phase-3/checklist.md';
  projectChecklist += `| ${escapeCell(phase.name)} | ${status} | ${budgetText} | ${escapeCell(nextCondition)} | [打开清单](${checklistPath}) |\n`;
}
projectChecklist += '\n## 当前应推进的工作包\n\n';
if (currentPackage) {
  const blockerNames = (currentPackage.blockers ?? []).map((id: string) => blockerById.get(id)?.item ?? id);
  const nextCheck = nextCheckpoint(currentPackage);
  const currentAction = nextCheck?.can_run_while_blocked
    ? '施工就绪保持 blocked；当前可推进预交房设计/资料准备'
    : effectiveReadiness(currentPackage) === 'blocked' ? '先解除开工阻塞' : `当前执行状态 ${effectivePackageStatus(currentPackage)}`;
  projectChecklist += `- **${currentPackage.id}｜${currentPackage.name}**：${currentAction}。\n`;
  projectChecklist += `- 要做：${escapeCell(currentPackage.description)}\n`;
  projectChecklist += `- 等待：${list(blockerNames)}\n`;
  projectChecklist += `- 下一检查点：${nextCheck ? `${nextCheck.id}｜${escapeCell(nextCheck.item)}（${nextCheck.can_run_while_blocked ? '预交房可推进，不放施工' : nextCheck.checkpoint ?? '验收'}）` : '当前包检查已通过，等待状态更新'}。\n`;
  projectChecklist += `- 责任角色：${list(currentPackage.owner_roles)}。详情见 [${currentPackage.id} 现场检查点](phase-1/checklist.md#${currentPackage.id.toLowerCase()})。\n\n`;
} else {
  projectChecklist += '- 一期工作包均已通过或豁免。\n\n';
}
projectChecklist += '## 当前关联项目数据版本\n\n| 数据源 | 当前 SHA-256 |\n|---|---|\n';
for (const [source, hash] of Object.entries(projectSnapshot)) projectChecklist += `| [${source}](../${source}) | \`${hash}\` |\n`;
projectChecklist += '\n任何输入源变化都会使此清单的输入指纹变化；验证器会报告旧视图及变化文件。已通过的现场检查还会比较自身记录的项目数据指纹和验收标准指纹，变化后转为 stale 并阻止付款放行。\n';

// 成本总表（cost.md）：数据源横跨 control.yaml、计算器快照与水电报价卡，映射与推导在
// cost-summary.ts。算不出就报错——render 模式直接失败、check 模式把 cost.md 报 stale，
// 不许静默出一张缺行或口径漂移的表。
let costMd: string | null = null;
let costError: string | null = null;
try {
  costMd = renderCostSummary(buildCostSummary(control), header('一期成本总表（硬装，含中央空调）', controlRelPath, COST_INPUT_PATHS));
} catch (error) {
  costError = error instanceof Error ? error.message : String(error);
}
if (costError && renderMode) {
  console.error(`- cost summary failed: ${costError}`);
  process.exit(1);
}

const outputViews: Array<{path: string; content: string}> = [
  {path: 'schedule/phase-1/budget.md', content: budgetMd},
  {path: 'schedule/phase-1/schedule.md', content: scheduleMd},
  {path: 'schedule/phase-1/checklist.md', content: checklistMd},
  {path: 'schedule/checklist.md', content: projectChecklist},
  {path: phase2ChecklistPath, content: phase2Checklist},
  {path: phase3ChecklistPath, content: phase3Checklist},
];
if (costMd != null) outputViews.splice(1, 0, {path: COST_SUMMARY_PATH, content: costMd});

const staleViews: string[] = [];
if (costError) staleViews.push(`${COST_SUMMARY_PATH}: cost summary failed: ${costError}`);
if (renderMode) {
  for (const view of outputViews) fs.writeFileSync(path.join(root, view.path), view.content);
} else {
  for (const view of outputViews) {
    const absolute = path.join(root, view.path);
    if (!fs.existsSync(absolute)) {
      staleViews.push(`${view.path}: missing; run npm run schedule:render`);
      continue;
    }
    const current = fs.readFileSync(absolute, 'utf8');
    if (current === view.content) continue;
    const priorSnapshotMatch = current.match(/<!-- schedule-input-snapshot:(\{[^\n]*\}) -->/);
    let priorSnapshot: Record<string, string> | undefined;
    try {
      priorSnapshot = priorSnapshotMatch ? JSON.parse(priorSnapshotMatch[1]) as Record<string, string> : undefined;
    } catch {
      priorSnapshot = undefined;
    }
    const currentSnapshot = fileSnapshot(view.path === 'schedule/phase-1/budget.md'
      ? [controlRelPath]
      : view.path === COST_SUMMARY_PATH
        ? COST_INPUT_PATHS
      : view.path === 'schedule/phase-1/schedule.md'
        ? [controlRelPath, roadmapRelPath]
        : view.path === 'schedule/phase-1/checklist.md'
          ? phaseInputPaths(control.phase_id, controlRelPath)
          : view.path === 'schedule/checklist.md'
            ? projectInputPaths
            : phaseInputPaths(view.path.includes('phase-2') ? 'phase_2_function_upgrade' : 'phase_3_styling', view.path.includes('phase-2') ? 'schedule/phase-2/control.yaml' : 'schedule/phase-3/control.yaml'));
    const changedInputs = priorSnapshot
      ? unique([...Object.keys(priorSnapshot), ...Object.keys(currentSnapshot)])
          .filter((source) => priorSnapshot?.[source] !== currentSnapshot[source])
      : [];
    staleViews.push(`${view.path}: ${changedInputs.length ? `inputs changed: ${changedInputs.join(', ')}` : 'content differs or source snapshot missing'}; run npm run schedule:render`);
  }
}

const staleAudits: string[] = control.audit_log.records.flatMap((record: AnyRecord) => {
  if (record.status !== 'passed') return [];
  const pkg = control.work_packages.find((item: AnyRecord) => item.id === record.package_id);
  if (!pkg) return [];
  const reasons = staleAuditReason(pkg, record.check_id, record);
  return reasons.length ? [`${record.package_id}/${record.check_id}: ${reasons.join('、')}`] : [];
});

if (!renderMode && (staleViews.length || staleAudits.length || stalePhaseGateRecords.length || packageGateIssues.length)) {
  console.error([
    ...staleViews.map((issue) => `- ${issue}`),
    ...staleAudits.map((issue) => `- stale audit: ${issue}; 复验后追加记录`),
    ...stalePhaseGateRecords.map((issue) => `- stale phase gate: ${issue}; 复核后追加记录`),
    ...packageGateIssues.map((issue) => `- package gate: ${issue}`),
  ].join('\n'));
  process.exitCode = 1;
}

console.log(`schedule control valid: ${roadmapPhaseIds.size} phases, ${control.work_packages.length} phase-1 packages, ${componentIds.size} cost components (${unpricedComponents.length} unpriced), ${usedCheckIds.size} auditable checks, ${money(allocated)} allocated, ${money(knownPendingGap)} known pending gap, ${openDecisionGates.length} open decision gates blocking ${openGatedCheckCount} checks`);
if (renderMode && (staleAudits.length || stalePhaseGateRecords.length || packageGateIssues.length)) {
  console.warn(`stale or inconsistent gate state: ${[...staleAudits, ...stalePhaseGateRecords, ...packageGateIssues].join('; ')}`);
}
if (process.argv.includes('--audit')) {
  const lockedRoundItems = quoteRoundRecords.filter((record: AnyRecord) => record.status === 'locked');
  console.log([
    `audit 待购项: ${unpricedComponents.length}/${componentIds.size} 个成本组件仍无金额`,
    `audit 轮次项: ${quoteRoundRecords.length} 条登记，其中已锁定 ${lockedRoundItems.length} 条`,
    `audit 价格口径: 带报价单 ${money(roundQuotedTotal)}，轮次目标合计 ${money(roundTargetTotal)}（不可当承诺价）`,
    `audit 已量化缺口: ${money(knownPendingGap)}；未分配额度 ${money(control.control.unallocated_cny)}，扣除缺口后余 ${money(control.control.unallocated_cny - knownPendingGap)}`,
  ].join('\n'));
}
