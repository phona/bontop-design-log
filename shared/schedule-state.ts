/**
 * schedule 控制源的共享 loader（自装交互审批第一步，2026-11-02）。
 *
 * 存在理由：scripts/schedule/control.ts 是 1105 行零 export 的纯脚本，import
 * 即读文件、即校验、即 process.exit——server 与前端无法复用，而交互审批的
 * 只读 API 需要的正是同一份判定。本模块把「加载 + 校验 + 派生」抽成无副作用
 * 的 loadScheduleState(root)，control.ts 退化为「loader + 渲染器 + CLI」的薄壳
 * （渲染输出逐字不变，tests/server/control-contract-validation.test.ts 钉的
 * 错误文案在这里原样保留）。
 *
 * 铁律：判定规则只有这一份。UI / API 只消费本模块的输出，不得另写一套。
 * 模型包关联的解析（loadModelPackageLinks）仍留在 server/model-package-links.ts
 * 单一实现，由调用方注入——shared/ 不反向依赖 server/。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as yaml from 'js-yaml';
import { computeGateStatus } from './gate-status.js';
import { contractArchivePathProblem, isValidCalendarDateText } from './contract-archive.js';
import { DECISION_GATES_PATH, loadDecisionGates, openGatesByCheck, type Decision, type DecisionGates } from './decision-gates.js';
import { MODEL_PACKAGE_LINKS_PATH } from './model-package-links.js';
import type { ModelPackageLinks } from './model-package-links.js';
import { collectDeclaredFurnitureIds, type DeclaredFurnitureIdEntry } from './furniture-object-id.js';
import type { FurnishingsYaml } from './types.js';

type AnyRecord = Record<string, any>;

export const CONTROL_REL_PATH = 'schedule/phase-1/control.yaml';
export const ACCEPTANCE_REL_PATH = 'config/acceptance.yaml';
export const ROADMAP_REL_PATH = 'schedule/roadmap.yaml';

export interface ScheduleState {
  root: string;
  errors: string[];
  control: AnyRecord;
  acceptance: AnyRecord;
  roadmap: AnyRecord;
  modelPackageLinks: ModelPackageLinks;
  decisionGates: DecisionGates;
  openDecisionGates: Decision[];
  openGatedCheckCount: number;
  openGates: Map<string, Decision[]>;
  roadmapPhaseIds: Set<string>;
  packageIds: Set<string>;
  checkIds: Set<string>;
  componentIds: Set<string>;
  usedCheckIds: Set<string>;
  packageCheckKeys: Set<string>;
  quoteRecordIds: Set<string>;
  phaseControls: Map<string, AnyRecord>;
  hotWaterDecision: AnyRecord | undefined;
  acceptanceById: Map<string, AnyRecord>;
  blockerById: Map<string, AnyRecord>;
  orderedPackages: AnyRecord[];
  auditByCheckKey: Map<string, AnyRecord>;
  quoteRound: AnyRecord;
  quoteRoundRecords: AnyRecord[];
  quoteRecords: AnyRecord[];
  appliancePackage: AnyRecord | undefined;
  pendingBudgetGaps: AnyRecord[];
  knownPendingGap: number;
  unpricedComponents: AnyRecord[];
  roundTargetTotal: number;
  roundQuotedTotal: number;
  poolTotals: Map<string, number>;
  allocated: number;
  fixed: number;
  // ─── 派生判定（渲染器与 API 共用，规则只有这一份）───
  money: (value: number | null) => string;
  moneyOrPending: (value: number | null) => string;
  range: (value: AnyRecord) => string;
  list: (value: unknown[] | undefined) => string;
  escapeCell: (value: unknown) => string;
  sha256: (value: string) => string;
  unique: <T>(values: T[]) => T[];
  fileSnapshot: (paths: string[]) => Record<string, string>;
  snapshotDigest: (snapshot: Record<string, string>) => string;
  scopeSummary: (selector: AnyRecord) => string;
  packageModelLinks: (packageId: string) => AnyRecord[];
  packageProjectPaths: (pkg: AnyRecord) => string[];
  packageProjectSnapshot: (pkg: AnyRecord) => Record<string, string>;
  packageProjectFingerprint: (pkg: AnyRecord) => string;
  phaseInputPaths: (phaseId: string, phaseControlPath: string) => string[];
  phaseDataInputPaths: (phaseId: string) => string[];
  projectInputPaths: string[];
  snapshotComment: (snapshot: Record<string, string>) => string;
  fingerprintLine: (paths: string[]) => { snapshot: Record<string, string>; text: string };
  header: (title: string, sourcePath: string, inputPaths: string[]) => string;
  packageChecks: (pkg: AnyRecord) => AnyRecord[];
  packageGateLabel: (pkg: AnyRecord) => string;
  checkSpecHash: (pkg: AnyRecord, checkId: string) => string;
  staleAuditReason: (pkg: AnyRecord, checkId: string, record: AnyRecord) => string[];
  auditStatusFor: (packageId: string, checkId: string) => string | undefined;
  gateStatus: (pkg: AnyRecord) => string;
  auditDisplay: (packageId: string, checkId: string) => { box: string; result: string };
  glossarySection: () => string;
  blockerIsClosed: (blocker: AnyRecord | undefined) => boolean;
  packageWaiverIsValid: (pkg: AnyRecord) => boolean;
  packagePrerequisiteIssues: (pkg: AnyRecord) => string[];
  effectiveReadiness: (pkg: AnyRecord) => string;
  effectivePackageStatus: (pkg: AnyRecord) => string;
  packageGateIssues: string[];
  currentPackage: AnyRecord | undefined;
  nextCheckpoint: (pkg: AnyRecord) => AnyRecord | undefined;
}

/**
 * 加载 + 校验 + 派生。返回 errors（由调用方决定退出/呈现），不退出、不打印。
 * modelPackageLinks 由调用方注入（server/model-package-links.ts 是唯一解析器）。
 */
export function loadScheduleState(root: string, options: { modelPackageLinks: ModelPackageLinks }): ScheduleState {
  const phaseDir = path.join(root, 'schedule/phase-1');
  const controlPath = path.join(phaseDir, 'control.yaml');
  const acceptancePath = path.join(root, ACCEPTANCE_REL_PATH);
  const roadmapPath = path.join(root, ROADMAP_REL_PATH);
  const controlRelPath = CONTROL_REL_PATH;
  const acceptanceRelPath = ACCEPTANCE_REL_PATH;
  const roadmapRelPath = ROADMAP_REL_PATH;
  const control = yaml.load(fs.readFileSync(controlPath, 'utf8')) as AnyRecord;
  const acceptance = yaml.load(fs.readFileSync(acceptancePath, 'utf8')) as AnyRecord;
  const roadmap = yaml.load(fs.readFileSync(roadmapPath, 'utf8')) as AnyRecord;
  // 成本项 targets（issue #98 PR-8，按对象算账）的合法取值域 = house.yaml furnishings
  // 已声明的稳定对象 id。对象 id 的唯一实现在 furniture-object-id.ts，这里只取清单，
  // 不另写第二套 id 公式。
  const house = yaml.load(fs.readFileSync(path.join(root, 'config/house.yaml'), 'utf8')) as { furnishings?: FurnishingsYaml };
  const furnitureObjects: DeclaredFurnitureIdEntry[] = collectDeclaredFurnitureIds(house.furnishings ?? {});
  const furnitureObjectById = new Map(furnitureObjects.map((entry) => [entry.id, entry]));
  const modelPackageLinks = options.modelPackageLinks;
  const decisionGates = loadDecisionGates(root);
  const openDecisionGates = decisionGates.decisions.filter((decision) => decision.scope === 'acceptance' && decision.status === 'open');
  const openGatedCheckCount = new Set(openDecisionGates.flatMap((decision) => decision.blocks ?? [])).size;
  const openGates = openGatesByCheck(decisionGates);

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
    const paths = [MODEL_PACKAGE_LINKS_PATH, 'schedule/phase-scope.yaml', 'config/acceptance.yaml', DECISION_GATES_PATH];
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
    const paths = [phaseControlPath, roadmapRelPath, 'schedule/phase-scope.yaml', MODEL_PACKAGE_LINKS_PATH, acceptanceRelPath, DECISION_GATES_PATH];
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
    const paths = ['schedule/phase-scope.yaml', MODEL_PACKAGE_LINKS_PATH, acceptanceRelPath, DECISION_GATES_PATH];
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
    DECISION_GATES_PATH,
    MODEL_PACKAGE_LINKS_PATH,
    'docs/pending-site-data.md',
    ...Object.values(modelPackageLinks.authorities),
  ]).sort();

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
      // 成本项对象归属（issue #98 PR-8）：可选 `targets: [对象稳定 id]`。只收非空字符串
      // 数组、全屋唯一且指向 placed 对象——count-only 条目无 runtime 对象可归属；
      // 归属未定（如 COST-150-01，开放项 D19）就不写 targets，不许用占位对象假装归属。
      if (component.targets !== undefined) {
        const targets = component.targets;
        if (!Array.isArray(targets) || targets.length === 0 || targets.some((target: unknown) => typeof target !== 'string' || !target.trim())) {
          errors.push(`${component.id}: targets 必须是非空的对象稳定 id 字符串数组`);
        } else {
          const seenTargets = new Set<string>();
          for (const target of targets) {
            const objectEntry = furnitureObjectById.get(target);
            if (!objectEntry) {
              errors.push(`${component.id}: cost target "${target}" 不是 config/house.yaml furnishings 已声明的对象稳定 id`);
            } else if (objectEntry.placement === 'count_only') {
              errors.push(`${component.id}: cost target "${target}" 是 count-only 条目，无 runtime 对象可归属`);
            }
            if (seenTargets.has(target)) errors.push(`${component.id}: duplicate cost target "${target}"`);
            seenTargets.add(target);
          }
        }
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

  return {
    root, errors, control, acceptance, roadmap, modelPackageLinks, decisionGates,
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
  };
}

// ─── next-action：把「现在干什么」从既有数据里推导出来（设计稿 §7） ──────────────
// 三条线索全部已在上面算出：readiness 就绪包、open 门禁、未报价组件；再加系统外
// 阻塞项单列。排序按「解除下游数量」——依赖拓扑深度，不是拍脑袋。

export type NextActionKind = 'ready_package' | 'decision_gate' | 'quote_pending' | 'external_blocker';

export interface NextActionItem {
  kind: NextActionKind;
  ref: string;
  title: string;
  detail: string;
  unblocks: number;
  package_id?: string;
}

/** 依赖拓扑：每个包被多少下游包（含传递）依赖。 */
function downstreamCounts(state: ScheduleState): Map<string, number> {
  const dependents = new Map<string, Set<string>>();
  for (const pkg of state.control.work_packages ?? []) {
    for (const dependency of pkg.dependencies ?? []) {
      if (!dependents.has(dependency)) dependents.set(dependency, new Set());
      dependents.get(dependency)!.add(pkg.id);
    }
  }
  const counts = new Map<string, number>();
  const countFrom = (id: string, seen: Set<string>): number => {
    if (counts.has(id)) return counts.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    let total = 0;
    for (const dependent of dependents.get(id) ?? []) {
      total += 1 + countFrom(dependent, seen);
    }
    counts.set(id, total);
    return total;
  };
  for (const pkg of state.control.work_packages ?? []) countFrom(pkg.id, new Set());
  return counts;
}

export function computeNextActions(state: ScheduleState): NextActionItem[] {
  const downstream = downstreamCounts(state);
  const items: NextActionItem[] = [];

  for (const pkg of state.orderedPackages) {
    if (state.effectiveReadiness(pkg) !== 'ready') continue;
    if (state.gateStatus(pkg) === 'passed') continue;
    const next = state.nextCheckpoint(pkg);
    items.push({
      kind: 'ready_package',
      ref: pkg.id,
      title: `${pkg.id}｜${pkg.name} 可以开工/验收`,
      detail: next
        ? `${state.escapeCell(next.item)}（${next.id}）；通过标准：${state.escapeCell(next.pass_condition ?? next.standard ?? '')}`
        : pkg.description,
      unblocks: downstream.get(pkg.id) ?? 0,
      package_id: pkg.id,
    });
  }

  for (const decision of state.openDecisionGates) {
    items.push({
      kind: 'decision_gate',
      ref: decision.id,
      title: `拍板 ${decision.id}：${decision.topic}`,
      detail: `${decision.question ?? ''}${(decision.blocks ?? []).length ? `；阻塞检查：${(decision.blocks ?? []).join('、')}` : ''}`,
      unblocks: (decision.blocks ?? []).length,
    });
  }

  const unpricedByPackage = new Map<string, AnyRecord[]>();
  for (const component of state.unpricedComponents) {
    if (!unpricedByPackage.has(component.package_id)) unpricedByPackage.set(component.package_id, []);
    unpricedByPackage.get(component.package_id)!.push(component);
  }
  for (const [packageId, components] of [...unpricedByPackage.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const pkg = state.control.work_packages.find((item: AnyRecord) => item.id === packageId);
    const names = components.slice(0, 5).map((component: AnyRecord) => component.name).join('、');
    items.push({
      kind: 'quote_pending',
      ref: packageId,
      title: `${pkg?.name ?? packageId}（${packageId}）有 ${components.length} 个费用项待询价`,
      detail: `${names}${components.length > 5 ? ' 等' : ''}；「待报价/待算量」不是 0 元`,
      unblocks: downstream.get(packageId) ?? 0,
      package_id: packageId,
    });
  }

  for (const blocker of state.control.global_blockers ?? []) {
    if (state.blockerIsClosed(blocker)) continue;
    const blockedPackages = (state.control.work_packages ?? []).filter((pkg: AnyRecord) => (pkg.blockers ?? []).includes(blocker.id));
    const unblocks = blockedPackages.reduce((sum: number, pkg: AnyRecord) => sum + 1 + (downstream.get(pkg.id) ?? 0), 0);
    items.push({
      kind: 'external_blocker',
      ref: blocker.id,
      title: `等外部方：${blocker.item}`,
      detail: `解除条件：${blocker.clears_when}；责任角色：${state.list(blocker.owner_roles)}`,
      unblocks,
    });
  }

  const kindRank: Record<NextActionKind, number> = {ready_package: 0, decision_gate: 1, quote_pending: 2, external_blocker: 3};
  return items.sort((left, right) =>
    right.unblocks - left.unblocks
    || kindRank[left.kind] - kindRank[right.kind]
    || left.ref.localeCompare(right.ref));
}

// ─── snapshot：给只读 API / 前端的结构化投影（纯数据，可 JSON 序列化） ──────────

export interface ScheduleCheckView {
  id: string;
  item: string;
  source: 'acceptance' | 'package';
  severity?: string;
  checkpoint?: string;
  method?: string;
  pass_condition?: string;
  evidence_required: string[];
  can_run_while_blocked?: boolean;
  audit_status?: string;
  stale_reasons?: string[];
  /** 当前审计记录（auditByCheckKey 的最后一条）。id 是复验 supersedes 的锚点：
   *  validateDraft 要求 supersedes 必须等于本包本检查的当前记录 id。 */
  audit?: {id: string; checked_by?: string; checked_at?: string; evidence?: string[]; supersedes?: string};
  open_gates?: string[];
  check_spec_sha256: string;
}

export interface SchedulePackageView {
  id: string;
  name: string;
  sequence: number;
  description: string;
  status: string;
  readiness: string;
  effective_readiness: string;
  effective_status: string;
  dependencies: string[];
  owner_roles: string[];
  payment_gate: string;
  gate_label: string;
  gate_status: string;
  blockers: Array<{id: string; item?: string; status?: string; clears_when?: string; closed: boolean}>;
  budget: {
    planned_cny: number | null;
    contracted_cny: number | null;
    paid_cny: number | null;
    forecast_cny: number | null;
    estimated_need_cny?: number | null;
    funding_status?: string;
    allocation_status?: string;
    component_count: number;
    unpriced_count: number;
  };
  checks: ScheduleCheckView[];
  project_fingerprint: string;
}

export interface ScheduleSnapshot {
  phase: {
    id: string;
    status: string;
    current_gate: string;
    ceiling_cny: number;
    allocated_cny: number;
    unallocated_cny: number;
    known_pending_gap_cny: number;
  };
  counts: {
    packages: number;
    checks: number;
    cost_components: number;
    unpriced_components: number;
    open_decision_gates: number;
    open_gated_checks: number;
    ready_packages: number;
  };
  data_fingerprint: string;
  packages: SchedulePackageView[];
  decision_gates: {open: Array<{id: string; topic: string; scope: string; blocks: string[]; question?: string}>; decided_count: number};
  global_blockers: Array<{id: string; item?: string; status?: string; clears_when?: string; owner_roles?: string[]; closed: boolean}>;
  next_actions: NextActionItem[];
  stale_audits: string[];
  package_gate_issues: string[];
}

export function computeStaleAudits(state: ScheduleState): string[] {
  return (state.control.audit_log?.records ?? []).flatMap((record: AnyRecord) => {
    if (record.status !== 'passed') return [];
    const pkg = state.control.work_packages.find((item: AnyRecord) => item.id === record.package_id);
    if (!pkg) return [];
    const reasons = state.staleAuditReason(pkg, record.check_id, record);
    return reasons.length ? [`${record.package_id}/${record.check_id}: ${reasons.join('、')}`] : [];
  });
}

export function buildScheduleSnapshot(state: ScheduleState): ScheduleSnapshot {
  // 全量工作包（含 sequence=900 的 PKG-900 硬装预备金）：进度图要把它作为
  // 常驻侧车道显示（设计稿 §9），orderedPackages 的 <900 过滤只服务于
  // 「当前推进位置」的施工顺序语义，不适配可视图。
  const allPackages = [...state.control.work_packages].sort((left: AnyRecord, right: AnyRecord) => left.sequence - right.sequence);
  const packages: SchedulePackageView[] = allPackages.map((pkg: AnyRecord) => {
    const acceptanceRefs = new Set<string>(pkg.acceptance_refs ?? []);
    const checks: ScheduleCheckView[] = state.packageChecks(pkg).map((check: AnyRecord) => {
      const auditStatus = state.auditStatusFor(pkg.id, check.id);
      const record = state.auditByCheckKey.get(`${pkg.id}:${check.id}`);
      const openGateIds = (state.openGates.get(check.id) ?? []).map((decision) => decision.id);
      return {
        id: check.id,
        item: check.item,
        source: acceptanceRefs.has(check.id) ? 'acceptance' : 'package',
        severity: check.severity,
        checkpoint: check.checkpoint,
        method: check.method,
        pass_condition: check.pass_condition ?? check.standard,
        evidence_required: check.evidence_required ?? [],
        can_run_while_blocked: check.can_run_while_blocked === true ? true : undefined,
        audit_status: auditStatus,
        stale_reasons: auditStatus === 'stale' && record
          ? state.staleAuditReason(pkg, check.id, record)
          : undefined,
        audit: record
          ? {id: record.id, checked_by: record.checked_by, checked_at: record.checked_at, evidence: record.evidence, supersedes: record.supersedes}
          : undefined,
        open_gates: openGateIds.length ? openGateIds : undefined,
        check_spec_sha256: state.checkSpecHash(pkg, check.id),
      };
    });
    const components = pkg.budget?.components ?? [];
    return {
      id: pkg.id,
      name: pkg.name,
      sequence: pkg.sequence,
      description: pkg.description,
      status: pkg.status,
      readiness: pkg.readiness,
      effective_readiness: state.effectiveReadiness(pkg),
      effective_status: state.effectivePackageStatus(pkg),
      dependencies: pkg.dependencies ?? [],
      owner_roles: pkg.owner_roles ?? [],
      payment_gate: pkg.payment_gate,
      gate_label: state.packageGateLabel(pkg),
      gate_status: state.gateStatus(pkg),
      blockers: (pkg.blockers ?? []).map((id: string) => {
        const blocker = state.blockerById.get(id);
        return {
          id,
          item: blocker?.item,
          status: blocker?.status,
          clears_when: blocker?.clears_when,
          closed: state.blockerIsClosed(blocker),
        };
      }),
      budget: {
        planned_cny: pkg.budget?.planned_cny ?? null,
        contracted_cny: pkg.budget?.contracted_cny ?? null,
        paid_cny: pkg.budget?.paid_cny ?? null,
        forecast_cny: pkg.budget?.forecast_cny ?? null,
        estimated_need_cny: pkg.budget?.estimated_need_cny ?? null,
        funding_status: pkg.budget?.funding_status,
        allocation_status: pkg.budget?.allocation_status,
        component_count: components.length,
        unpriced_count: components.filter((component: AnyRecord) => component.planned_cny == null).length,
      },
      checks,
      project_fingerprint: state.packageProjectFingerprint(pkg),
    };
  });

  return {
    phase: {
      id: state.control.phase_id,
      status: state.control.control.status,
      current_gate: state.control.control.current_gate,
      ceiling_cny: state.control.control.phase_ceiling_cny,
      allocated_cny: state.control.control.allocated_cny,
      unallocated_cny: state.control.control.unallocated_cny,
      known_pending_gap_cny: state.knownPendingGap,
    },
    counts: {
      packages: packages.length,
      checks: state.usedCheckIds.size,
      cost_components: state.componentIds.size,
      unpriced_components: state.unpricedComponents.length,
      open_decision_gates: state.openDecisionGates.length,
      open_gated_checks: state.openGatedCheckCount,
      ready_packages: packages.filter((pkg) => pkg.effective_readiness === 'ready').length,
    },
    data_fingerprint: state.snapshotDigest(state.fileSnapshot(state.projectInputPaths)),
    packages,
    decision_gates: {
      open: state.openDecisionGates.map((decision) => ({
        id: decision.id,
        topic: decision.topic,
        scope: decision.scope,
        blocks: decision.blocks ?? [],
        question: decision.question,
      })),
      decided_count: state.decisionGates.decisions.filter((decision) => decision.status === 'decided').length,
    },
    global_blockers: (state.control.global_blockers ?? []).map((blocker: AnyRecord) => ({
      id: blocker.id,
      item: blocker.item,
      status: blocker.status,
      clears_when: blocker.clears_when,
      owner_roles: blocker.owner_roles,
      closed: state.blockerIsClosed(blocker),
    })),
    next_actions: computeNextActions(state),
    stale_audits: computeStaleAudits(state),
    package_gate_issues: state.packageGateIssues,
  };
}
