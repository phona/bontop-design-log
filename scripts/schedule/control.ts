import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import * as yaml from 'js-yaml';
import { computeGateStatus } from './gate-status.js';
import { buildCostSummary, renderCostSummary, contractArchivePathProblem, isValidCalendarDateText, COST_INPUT_PATHS, COST_SUMMARY_PATH } from './cost-summary.js';
import { loadModelPackageLinks, MODEL_PACKAGE_LINKS_PATH } from '../../server/model-package-links.js';

type AnyRecord = Record<string, any>;

const root = process.cwd();
const phaseDir = path.join(root, 'schedule/phase-1');
const controlPath = path.join(phaseDir, 'control.yaml');
const acceptancePath = path.join(root, 'config/acceptance.yaml');
const roadmapPath = path.join(root, 'schedule/roadmap.yaml');
const controlRelPath = 'schedule/phase-1/control.yaml';
const acceptanceRelPath = 'config/acceptance.yaml';
const roadmapRelPath = 'schedule/roadmap.yaml';
const control = yaml.load(fs.readFileSync(controlPath, 'utf8')) as AnyRecord;
const acceptance = yaml.load(fs.readFileSync(acceptancePath, 'utf8')) as AnyRecord;
const roadmap = yaml.load(fs.readFileSync(roadmapPath, 'utf8')) as AnyRecord;
const modelPackageLinks = loadModelPackageLinks(MODEL_PACKAGE_LINKS_PATH);

const money = (value: number | null) => value == null ? '—' : `¥${value.toLocaleString('zh-CN')}`;
const moneyOrPending = (value: number | null) => value == null ? '待报价/待算量' : money(value);
const range = (value: AnyRecord) => value.min === value.max ? `${value.min}天` : `${value.min}—${value.max}天`;
const list = (value: unknown[] | undefined) => value?.length ? value.join('、') : '无';
const escapeCell = (value: unknown) => String(value ?? '—').replaceAll('|', '\\|').replaceAll('\n', '<br>');
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const unique = <T>(values: T[]) => [...new Set(values)];

function fileSnapshot(paths: string[]): Record<string, string> {
  return Object.fromEntries(unique(paths).sort().map((file) => {
    const absolute = path.resolve(root, file);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      throw new Error(`schedule input is missing or not a file: ${file}`);
    }
    return [file, sha256(fs.readFileSync(absolute, 'utf8'))];
  }));
}

function snapshotDigest(snapshot: Record<string, string>): string {
  return sha256(JSON.stringify(Object.entries(snapshot).sort(([left], [right]) => left.localeCompare(right))));
}

function scopeSummary(selector: AnyRecord): string {
  return Object.entries(selector)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : String(value)}`)
    .join('; ');
}

function packageModelLinks(packageId: string): AnyRecord[] {
  return modelPackageLinks.links.filter((link) => link.budget_ref.id === packageId) as AnyRecord[];
}

function packageProjectPaths(pkg: AnyRecord): string[] {
  const links = packageModelLinks(pkg.id);
  const paths = [MODEL_PACKAGE_LINKS_PATH, 'schedule/phase-scope.yaml', 'config/acceptance.yaml'];
  for (const link of links) {
    for (const scope of link.scope ?? []) {
      const authorityPath = modelPackageLinks.authorities[scope.source];
      if (authorityPath) paths.push(authorityPath);
    }
  }
  if (pkg.include_site_data_ledger === true || (pkg.blockers ?? []).some((id: string) => ['BLK-HANDOVER', 'BLK-SURVEY-DATA-FREEZE'].includes(id))) {
    paths.push('docs/pending-site-data.md');
  }
  return unique(paths).sort();
}

function packageProjectSnapshot(pkg: AnyRecord): Record<string, string> {
  return fileSnapshot(packageProjectPaths(pkg));
}

function packageProjectFingerprint(pkg: AnyRecord): string {
  return snapshotDigest(packageProjectSnapshot(pkg));
}

function phaseInputPaths(phaseId: string, phaseControlPath: string): string[] {
  const links = modelPackageLinks.links.filter((link) => link.phase_id === phaseId);
  const paths = [phaseControlPath, roadmapRelPath, 'schedule/phase-scope.yaml', MODEL_PACKAGE_LINKS_PATH, acceptanceRelPath];
  if (phaseId === control.phase_id) paths.push('docs/pending-site-data.md');
  if (phaseId === 'phase_2_function_upgrade' || phaseId === 'phase_3_styling') paths.push('schedule/phase-1/control.yaml');
  if (phaseId === 'phase_3_styling') paths.push('schedule/phase-2/control.yaml');
  for (const link of links) {
    for (const scope of link.scope ?? []) {
      const authorityPath = modelPackageLinks.authorities[scope.source];
      if (authorityPath) paths.push(authorityPath);
    }
  }
  return unique(paths).sort();
}

function phaseDataInputPaths(phaseId: string): string[] {
  const links = modelPackageLinks.links.filter((link) => link.phase_id === phaseId);
  const paths = ['schedule/phase-scope.yaml', MODEL_PACKAGE_LINKS_PATH, acceptanceRelPath];
  if (phaseId === 'phase_2_function_upgrade' || phaseId === 'phase_3_styling') paths.push('schedule/phase-1/control.yaml');
  if (phaseId === 'phase_3_styling') paths.push('schedule/phase-2/control.yaml');
  for (const link of links) {
    for (const scope of link.scope ?? []) {
      const authorityPath = modelPackageLinks.authorities[scope.source];
      if (authorityPath && !authorityPath.startsWith('schedule/phase-')) paths.push(authorityPath);
    }
  }
  if (phaseId === control.phase_id) paths.push('docs/pending-site-data.md');
  return unique(paths).sort();
}

const projectInputPaths = unique([
  roadmapRelPath,
  'schedule/phase-scope.yaml',
  'schedule/phase-1/control.yaml',
  'schedule/phase-2/control.yaml',
  'schedule/phase-3/control.yaml',
  'config/acceptance.yaml',
  MODEL_PACKAGE_LINKS_PATH,
  'docs/pending-site-data.md',
  ...Object.values(modelPackageLinks.authorities),
]).sort();

const renderMode = process.argv.includes('--render');

const errors: string[] = [];
const roadmapPhaseIds = new Set<string>();
const packageIds = new Set<string>();
const checkIds = new Set<string>();
const componentIds = new Set<string>();
const usedCheckIds = new Set<string>();
const packageCheckKeys = new Set<string>();
const quoteRecordIds = new Set<string>();
const phaseControls = new Map<string, AnyRecord>();
const hotWaterDecision = control.appliance_quote_register?.hot_water_decision;
const acceptanceById = new Map<string, AnyRecord>();
const blockerIds = new Set<string>((control.global_blockers ?? []).map((item: AnyRecord) => item.id));
const poolIds = new Set<string>((control.budget_pools ?? []).map((item: AnyRecord) => item.id));
const blockerStatusValues = new Set<string>(control.control.blocker_status_values ?? []);
for (const blocker of control.global_blockers ?? []) {
  if (!blockerStatusValues.has(blocker.status)) errors.push(`${blocker.id}: invalid blocker status ${blocker.status}`);
}

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
  phaseControls.set(phase.id, phaseControl);
  if (phaseControl.phase_id !== phase.id) errors.push(`${phase.id}: control phase_id mismatch`);
  const phaseGateIds = new Set<string>((phaseControl.activation_gates ?? []).map((gate: AnyRecord) => gate.id));
  const phaseAuditIds = new Set<string>();
  for (const record of phaseControl.audit?.records ?? []) {
    if (phaseAuditIds.has(record.id)) errors.push(`${phase.id}: duplicate audit record id ${record.id}`);
    phaseAuditIds.add(record.id);
    if (!phaseGateIds.has(record.gate_id)) errors.push(`${phase.id}/${record.id}: unknown activation gate ${record.gate_id}`);
    if (!(phaseControl.audit?.record_schema?.status_values ?? []).includes(record.status)) errors.push(`${phase.id}/${record.id}: invalid audit status ${record.status}`);
    if (!record.checked_at || !record.checked_by) errors.push(`${phase.id}/${record.id}: missing checked_at or checked_by`);
    if (!Array.isArray(record.evidence)) errors.push(`${phase.id}/${record.id}: evidence must be an array`);
    if (record.status === 'passed' && (!record.evidence.length || !record.gate_spec_sha256 || !record.project_data_sha256)) {
      errors.push(`${phase.id}/${record.id}: passed gate requires evidence and current gate/project data fingerprints`);
    }
    if (record.supersedes && !phaseAuditIds.has(record.supersedes)) errors.push(`${phase.id}/${record.id}: supersedes must reference an earlier audit record`);
  }
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
    if (check.can_run_while_blocked && check.does_not_release_construction !== true) {
      errors.push(`${check.id}: can_run_while_blocked requires does_not_release_construction: true`);
    }
  }
}

// DEC-2026-10-05-R12 复审补的门禁：flow 映射里的裸标量含半角逗号会被 js-yaml 在逗号处截断，
// 残段变成带逗号的垃圾键（值为 undefined）。出现这类键说明 description/quantity_basis 尾部条款
// 已从解析层静默丢失——报错并要求给值加双引号（同 COST-030-02 先例）。
//
// 2026-10-12 修正：原实现只查半角逗号 ','，但截断发生在「18,500」「4,000」「3,684」这类
// 千分位里的半角逗号，而**残段垃圾键里往往只剩全角逗号「，」**——COST-060-02/060-04/120-01
// 三条因此长期静默丢失尾部条款（description 截在「约4」「预算池18」「轨道灯约3」）。
// 现同时查半角与全角；任一命中即报。
const COMMA_CHARS = [',', '，'];
for (const pkg of control.work_packages ?? []) {
  for (const component of pkg.budget?.components ?? []) {
    const truncatedKeys = Object.keys(component).filter((key: string) => COMMA_CHARS.some((ch) => key.includes(ch)));
    if (truncatedKeys.length) {
      errors.push(`${component.id ?? pkg.id}: flow 标量疑被逗号截断（垃圾键：${truncatedKeys.join(' / ')}）——请给含逗号（半角 , 或全角 ，）的 description/quantity_basis 加双引号`);
    }
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

const quoteRound = control.hard_finish_quote_rounds ?? {};
const quoteRoundRecords: AnyRecord[] = quoteRound.records ?? [];
const quoteRoundPriceTypes: string[] = quoteRound.record_schema?.price_type_values ?? [];
const quoteRoundIds = new Set<string>();
for (const record of quoteRoundRecords) {
  if (quoteRoundIds.has(record.id)) errors.push(`duplicate hard finish quote round id: ${record.id}`);
  quoteRoundIds.add(record.id);
  const roundPkg = (control.work_packages ?? []).find((item: AnyRecord) => item.id === record.pkg_id);
  if (!roundPkg) errors.push(`${record.id}: unknown pkg_id ${record.pkg_id}`);
  const roundComponentIds = new Set((roundPkg?.budget?.components ?? []).map((item: AnyRecord) => item.id));
  for (const componentId of record.component_ids ?? []) {
    if (!roundComponentIds.has(componentId)) errors.push(`${record.id}: component ${componentId} not in ${record.pkg_id}`);
  }
  if (!quoteRoundPriceTypes.includes(record.price_type)) errors.push(`${record.id}: invalid price_type ${record.price_type}`);
  if (typeof record.owner_target_cny !== 'number' || record.owner_target_cny < 0) errors.push(`${record.id}: owner_target_cny must be a non-negative number`);
  if (record.owner_current_cny != null && (typeof record.owner_current_cny !== 'number' || record.owner_current_cny < 0)) {
    errors.push(`${record.id}: owner_current_cny must be null or a non-negative number`);
  }
  if (!record.item || !record.round_id || !record.status) errors.push(`${record.id}: incomplete hard finish quote round record`);
  if (record.supersedes && !quoteRoundIds.has(record.supersedes)) errors.push(`${record.id}: supersedes must reference an earlier round record`);
  if (record.status === 'locked' && (record.locked_cny == null || !record.contract_ref)) {
    errors.push(`${record.id}: status locked requires locked_cny and contract_ref`);
  }
  if (record.contract != null) {
    // 合同结构化登记（2026-10-23 收口）：带 contract 块的轮次即已转合同，登记
    // 字段是成本总表守卫（cost-summary.ts）的机读单源。口径在这里就钉死，不
    // 许带病数据流到生成器才炸：金额须与 locked_cny 一致；deal_status 只认
    // signed（唯一「已成交」取值）；signed_at 须为真实日历日期的
    // YYYY-MM-DD（严格回读比对，与成本守卫共用 isValidCalendarDateText；
    // 登记处已加引号走字符串形态）；includes/excludes 必须在位；
    // archive_paths 逐条为 {path, sha256}：path 经共用核查
    // contractArchivePathProblem 钉死在 contracts/ 归档区内（规范路径、
    // 非符号链接、realpath 不出界）、sha256 为 64 位十六进制（登记时钉
    // 死的原件字节哈希）、文件真实存在且非空；哈希与文件字节的实算比
    // 对在成本守卫（cost-summary.ts）做，数据层这里只钉形态、范围与在位。
    const contract = record.contract;
    if (typeof contract !== 'object' || Array.isArray(contract)) {
      errors.push(`${record.id}: contract must be a mapping`);
    } else {
      if (typeof contract.amount_cny !== 'number' || contract.amount_cny <= 0) {
        errors.push(`${record.id}: contract.amount_cny must be a positive number`);
      } else if (contract.amount_cny !== record.locked_cny) {
        errors.push(`${record.id}: contract.amount_cny=${contract.amount_cny} 与 locked_cny=${record.locked_cny} 不一致——登记金额与锁定金额必须同值`);
      }
      if (contract.deal_status !== 'signed') {
        errors.push(`${record.id}: contract.deal_status must be signed (got ${contract.deal_status})`);
      }
      const signedAtText = contract.signed_at instanceof Date
        ? contract.signed_at.toISOString().slice(0, 10)
        : contract.signed_at;
      // 严格日历校验（复审第二轮 P2）：Date.parse 会把 2026-02-30 归一
      // 化成 03-02 而不报 NaN——必须逐项回读比对（isValidCalendarDateText
      // 与成本守卫共用）。control.yaml 里 signed_at 已加引号走字符串形
      // 态，归一化在解析期就不存在；Date 形态仅为兼容未加引号的旧写法。
      if (typeof signedAtText !== 'string' || !isValidCalendarDateText(signedAtText)) {
        errors.push(`${record.id}: contract.signed_at must be a real YYYY-MM-DD calendar date (got ${contract.signed_at})`);
      }
      if (typeof contract.includes !== 'string' || !contract.includes) {
        errors.push(`${record.id}: contract.includes missing`);
      }
      if (typeof contract.excludes !== 'string' || !contract.excludes) {
        errors.push(`${record.id}: contract.excludes missing`);
      }
      if (!Array.isArray(contract.archive_paths) || contract.archive_paths.length === 0) {
        errors.push(`${record.id}: contract.archive_paths must be a non-empty array`);
      } else {
        for (const archiveEntry of contract.archive_paths) {
          if (typeof archiveEntry !== 'object' || archiveEntry === null || Array.isArray(archiveEntry)) {
            errors.push(`${record.id}: contract.archive_paths 条目必须是 {path, sha256} 登记（got ${archiveEntry === null ? 'null' : typeof archiveEntry}）`);
            continue;
          }
          const archivePath = archiveEntry.path;
          const archiveSha256 = archiveEntry.sha256;
          if (typeof archivePath !== 'string') {
            errors.push(`${record.id}: contract.archive_paths 的 path 必须是 contracts/ 归档区内的规范路径字符串（got ${archivePath}）`);
            continue;
          }
          if (typeof archiveSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(archiveSha256)) {
            errors.push(`${record.id}: contract.archive_paths 条目 ${archivePath} 的 sha256 必须是 64 位十六进制（got ${archiveSha256}）`);
            continue;
          }
          // 路径边界与实体核查与成本守卫共用 contractArchivePathProblem
          // （复审第二轮 P1）：规范路径（.. / . 段越界）、非符号链接、
          // realpath 不离开 contracts/、文件存在非空，一处口径两处生效。
          const archiveProblem = contractArchivePathProblem(archivePath, root);
          if (archiveProblem) errors.push(`${record.id}: ${archiveProblem}`);
        }
      }
    }
  }
  if (record.evidence_path) {
    // 证据存在性必须看**内容**，不能只看路径。fs.existsSync 对目录恒为 true 且不看条目，
    // 于是「一个只放了 README.md 的空目录」会被判成有证据——QR-2026-10-03-08
    // （唯一一条 price_type: quoted_sheet、¥9,537）的 evidence_path 指向
    // contracts/2026-10-03/，该目录下只有 1119 字节的 README.md、没有任何报价单原件，
    // 却长期通过本检查。判定改为：
    //   - 指向文件 → 必须存在且非空（size > 0）；
    //   - 指向目录 → 目录内至少要有一个**非 README** 的条目（README/说明文件与
    //     点文件不算证据，否则又是同一漏洞换了个壳）。
    const evidenceAbs = path.join(root, record.evidence_path);
    let evidenceError: string | null = null;
    try {
      const stat = fs.statSync(evidenceAbs);
      if (stat.isDirectory()) {
        const entries = fs.readdirSync(evidenceAbs)
          .filter((entry: string) => !entry.startsWith('.') && !entry.toLowerCase().startsWith('readme'));
        if (!entries.length) {
          evidenceError = `evidence_path 是目录但只有 README/说明文件，没有报价单或合同原件：${record.evidence_path}`;
        }
      } else if (stat.size === 0) {
        evidenceError = `evidence_path 指向空文件（0 字节）：${record.evidence_path}`;
      }
    } catch {
      evidenceError = `evidence_path does not exist: ${record.evidence_path}`;
    }
    if (evidenceError) errors.push(`${record.id}: ${evidenceError}`);
  }
}
const roundTargetTotal = quoteRoundRecords.reduce((sum: number, record: AnyRecord) => sum + (record.owner_target_cny ?? 0), 0);
const roundQuotedTotal = quoteRoundRecords
  .filter((record: AnyRecord) => record.price_type === 'quoted_sheet')
  .reduce((sum: number, record: AnyRecord) => sum + (record.owner_current_cny ?? record.owner_target_cny ?? 0), 0);
if (quoteRound.round_summary?.all_in_target_cny != null && roundTargetTotal !== quoteRound.round_summary.all_in_target_cny) {
  errors.push(`hard finish quote rounds: records=${roundTargetTotal}, round_summary.all_in_target_cny=${quoteRound.round_summary.all_in_target_cny}`);
}
if (quoteRound.round_summary?.quoted_sheet_only_cny != null && roundQuotedTotal !== quoteRound.round_summary.quoted_sheet_only_cny) {
  errors.push(`hard finish quote rounds: quoted_sheet=${roundQuotedTotal}, round_summary.quoted_sheet_only_cny=${quoteRound.round_summary.quoted_sheet_only_cny}`);
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

const snapshotComment = (snapshot: Record<string, string>) => `<!-- schedule-input-snapshot:${JSON.stringify(snapshot)} -->\n`;
const fingerprintLine = (paths: string[]) => {
  const snapshot = fileSnapshot(paths);
  return {
    snapshot,
    text: `> 项目数据指纹：\`sha256:${snapshotDigest(snapshot)}\`（${Object.keys(snapshot).length} 个输入文件；验证时会检查本页是否过期）\n`,
  };
};
const header = (title: string, sourcePath: string, inputPaths: string[]) => {
  const {snapshot, text} = fingerprintLine(inputPaths);
  const phaseStatus = title.startsWith('一期')
    ? `当前阶段：${control.control.current_gate}；总体状态：${control.control.status}`
    : `维护源：${sourcePath}`;
  return `${snapshotComment(snapshot)}# ${title}\n\n> 自动生成：请勿直接编辑。维护源：\`${sourcePath}\`  \n${text}> 控制源声明更新日期：${control.updated_at}  \n> ${phaseStatus}\n\n`;
};
const packageChecks = (pkg: AnyRecord) => [
  // 引用型验收项的必需证据以 acceptance.yaml 的 evidence 为准（渲染与指纹同源）；
  // 维护源未定义 evidence 时才回退泛称，避免清单只剩「照片或检测记录」而丢失具体证据要求。
  ...(pkg.acceptance_refs ?? []).map((ref: string) => {
    const item = acceptanceById.get(ref);
    return {...item, id: ref, checkpoint: '引用', evidence_required: item?.evidence?.length ? item.evidence : ['照片或检测记录']};
  }),
  ...(pkg.checks ?? []),
];
const packageGateLabel = (pkg: AnyRecord) => pkg.gate_label ?? '付款门槛';
const checkSpecHash = (pkg: AnyRecord, checkId: string) => {
  const check = packageChecks(pkg).find((item: AnyRecord) => item.id === checkId);
  const blockerSpecs = (pkg.blockers ?? []).map((id: string) => {
    const blocker = blockerById.get(id);
    return blocker ? {id: blocker.id, item: blocker.item, clears_when: blocker.clears_when, trigger: blocker.trigger, owner_roles: blocker.owner_roles} : {id};
  });
  const packageSpec = {
    id: pkg.id,
    name: pkg.name,
    description: pkg.description,
    sequence: pkg.sequence,
    dependencies: pkg.dependencies ?? [],
    owner_roles: pkg.owner_roles ?? [],
    blockerSpecs,
  };
  return check ? sha256(JSON.stringify({packageSpec, check})) : '';
};
const staleAuditReason = (pkg: AnyRecord, checkId: string, record: AnyRecord): string[] => {
  const reasons: string[] = [];
  const currentCheckHash = checkSpecHash(pkg, checkId);
  if (!record.check_spec_sha256) reasons.push('验收记录缺少检查标准指纹');
  else if (record.check_spec_sha256 !== currentCheckHash) reasons.push('检查标准已变化');
  const currentProjectHash = packageProjectFingerprint(pkg);
  if (!record.project_data_sha256) reasons.push('验收记录缺少项目数据指纹');
  else if (record.project_data_sha256 !== currentProjectHash) reasons.push('项目数据已变化');
  return reasons;
};
const auditStatusFor = (packageId: string, checkId: string) => {
  const record = auditByCheckKey.get(`${packageId}:${checkId}`);
  if (!record) return undefined;
  if (record.status === 'passed') {
    const pkg = control.work_packages.find((item: AnyRecord) => item.id === packageId);
    if (pkg && staleAuditReason(pkg, checkId, record).length) return 'stale';
  }
  return record.status;
};
const gateStatus = (pkg: AnyRecord) => {
  return computeGateStatus(
    packageChecks(pkg),
    auditStatusFor,
    pkg.id,
  );
};
const auditDisplay = (packageId: string, checkId: string) => {
  const record = auditByCheckKey.get(`${packageId}:${checkId}`);
  if (!record) return {box: '[ ]', result: 'pending'};
  const pkg = control.work_packages.find((item: AnyRecord) => item.id === packageId);
  if (record.status === 'passed' && pkg) {
    const reasons = staleAuditReason(pkg, checkId, record);
    if (reasons.length) return {box: '[~]', result: `stale；${reasons.join('、')}；须复验并追加记录`};
  }
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

const blockerById = new Map<string, AnyRecord>((control.global_blockers ?? []).map((item: AnyRecord) => [item.id, item]));
const orderedPackages = control.work_packages.filter((pkg: AnyRecord) => pkg.sequence < 900).sort((a: AnyRecord, b: AnyRecord) => a.sequence - b.sequence);

function blockerIsClosed(blocker: AnyRecord | undefined): boolean {
  if (!blocker) return false;
  if (blocker.status === 'resolved') {
    return Boolean(blocker.resolved_by && blocker.resolved_at && blocker.resolution_evidence?.length);
  }
  if (blocker.status === 'waived') {
    return Boolean(blocker.waived_by && blocker.waiver_reason && blocker.resolution_evidence?.length);
  }
  return false;
}

function packageWaiverIsValid(pkg: AnyRecord): boolean {
  return Boolean(pkg.waiver?.approved_by && pkg.waiver?.reason && pkg.waiver?.evidence?.length);
}

function packagePrerequisiteIssues(pkg: AnyRecord): string[] {
  const issues: string[] = [];
  for (const dependencyId of pkg.dependencies ?? []) {
    const dependency = control.work_packages.find((item: AnyRecord) => item.id === dependencyId);
    if (!dependency) {
      issues.push(`缺少依赖包 ${dependencyId}`);
      continue;
    }
    const complete = dependency.status === 'passed'
      ? gateStatus(dependency) === 'passed' && (dependency.blockers ?? []).every((id: string) => blockerIsClosed(blockerById.get(id)))
      : dependency.status === 'waived' && packageWaiverIsValid(dependency);
    if (!complete) issues.push(`依赖包 ${dependencyId} 尚未通过当前验收或豁免`);
  }
  for (const blockerId of pkg.blockers ?? []) {
    if (!blockerIsClosed(blockerById.get(blockerId))) issues.push(`阻塞项 ${blockerId} 尚未有证据关闭`);
  }
  return issues;
}

function effectiveReadiness(pkg: AnyRecord): string {
  if (pkg.readiness === 'ready' && packagePrerequisiteIssues(pkg).length) return 'blocked';
  return pkg.readiness;
}

function effectivePackageStatus(pkg: AnyRecord): string {
  if (pkg.status === 'passed' && (effectiveReadiness(pkg) !== 'ready' || gateStatus(pkg) !== 'passed')) {
    return gateStatus(pkg) === 'pending' ? 'stale_or_unverified' : 'blocked_by_precondition';
  }
  if (['in_progress', 'ready_for_inspection'].includes(pkg.status) && effectiveReadiness(pkg) === 'blocked') {
    return 'blocked_by_precondition';
  }
  return pkg.status;
}

const packageGateIssues = control.work_packages.flatMap((pkg: AnyRecord) => {
  const issues: string[] = [];
  const prerequisiteIssues = packagePrerequisiteIssues(pkg);
  if (pkg.readiness === 'ready' && prerequisiteIssues.length) {
    issues.push(`${pkg.id}: readiness=ready 但${prerequisiteIssues.join('、')}`);
  }
  if (['in_progress', 'ready_for_inspection'].includes(pkg.status) && effectiveReadiness(pkg) !== 'ready') {
    issues.push(`${pkg.id}: status=${pkg.status} 但开工前置条件未满足`);
  }
  if (pkg.status === 'passed' && (effectiveReadiness(pkg) !== 'ready' || gateStatus(pkg) !== 'passed')) {
    issues.push(`${pkg.id}: status=passed 但依赖、阻塞项或当前验收门槛未通过`);
  }
  if (pkg.status === 'waived' && !packageWaiverIsValid(pkg)) {
    issues.push(`${pkg.id}: status=waived 缺少批准人、原因或证据`);
  }
  return issues;
});
for (const blocker of control.global_blockers ?? []) {
  if (['resolved', 'waived'].includes(blocker.status) && !blockerIsClosed(blocker)) {
    packageGateIssues.push(`${blocker.id}: 已关闭状态缺少责任人、日期或证据`);
  }
}

const currentPackage = orderedPackages.find((pkg: AnyRecord) => !(
  (pkg.status === 'passed' && effectiveReadiness(pkg) === 'ready' && gateStatus(pkg) === 'passed')
  || (pkg.status === 'waived' && packageWaiverIsValid(pkg))
));

function nextCheckpoint(pkg: AnyRecord): AnyRecord | undefined {
  const pending = packageChecks(pkg).filter((check: AnyRecord) => auditStatusFor(pkg.id, check.id) !== 'passed');
  if (effectiveReadiness(pkg) === 'blocked') {
    return pending.find((check: AnyRecord) => check.can_run_while_blocked) ?? pending[0];
  }
  return pending[0];
}

function selectorLinkTable(packageId: string, outputPath: string): string {
  const links = packageModelLinks(packageId);
  let markdown = '### 关联项目数据\n\n| 数据文件 | 本工作包引用范围 | 映射状态 |\n|---|---|---|\n';
  if (!links.length) markdown += '| — | 未登记项目模型映射 | 未映射 |\n';
  for (const link of links) {
    for (const scope of link.scope ?? []) {
      const sourcePath = modelPackageLinks.authorities[scope.source] ?? scope.source;
      const relativePath = path.posix.relative(path.posix.dirname(outputPath), sourcePath);
      markdown += `| [${sourcePath}](${relativePath}) | ${escapeCell(scopeSummary(scope.select))} | ${link.mapping_status} |\n`;
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
    const sourcePaths = link?.scope?.map((scope) => modelPackageLinks.authorities[scope.source]).filter(Boolean) ?? [];
    const sourceText = unique(sourcePaths).map((itemPath) => {
      const rel = path.posix.relative(path.posix.dirname(`${sourcePath.slice(0, sourcePath.lastIndexOf('/'))}/checklist.md`), itemPath);
      const scopes = (link?.scope ?? []).filter((scope) => modelPackageLinks.authorities[scope.source] === itemPath).map((scope) => scopeSummary(scope.select));
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

const staleAudits = control.audit_log.records.flatMap((record: AnyRecord) => {
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

console.log(`schedule control valid: ${roadmapPhaseIds.size} phases, ${control.work_packages.length} phase-1 packages, ${componentIds.size} cost components (${unpricedComponents.length} unpriced), ${usedCheckIds.size} auditable checks, ${money(allocated)} allocated, ${money(knownPendingGap)} known pending gap`);
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
