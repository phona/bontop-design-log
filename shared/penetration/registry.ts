import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { load as parseYaml } from 'js-yaml';
import {
  deriveRuntimeGlassJoins,
  requiredClearance,
  type SpatialIssue,
} from '../spatial-validation.js';
import { validateRuntimePenetration } from './rules.js';
import { validateFurnitureClearance, profileFor, declaredDims } from './clearance.js';
import { validateFurnitureOpenings } from './openings.js';
import { buildRuntimeScene, collectPenetrationObjects, objectHasMesh, type SceneInputs } from './scene.js';
import {
  severityFloor,
  samePair,
  type AntiPenetrationConfig,
  type MepParticipationPolicy,
  type PenetrationRuleSpec,
  type WaiverSpec,
} from './types.js';

/**
 * 规则注册表：穿透层唯一入口。
 *
 * `verify:spatial`（并联期）与 `verify:penetration` 都调用 `runPenetrationChecks`，
 * 因此配置里的 severity 调整、豁免、新增规则对两个 CLI 同时生效，不会各自漂移。
 */

const ROOT = path.resolve(import.meta.dirname, '../..');
export const CONFIG_PATH = 'config/anti-penetration.yaml';
const SOURCE = 'config/house.yaml + shared/render/SceneBuilder.ts + shared/penetration/';

/** 代码里真实实现了的规则。配置申报与此清单互为镜像，缺一方即报错。 */
export const IMPLEMENTED_RULES: PenetrationRuleSpec[] = [
  { id: 'pen.furniture.wall', codes: ['furniture_wall_collision'], kinds: 'furniture↔wall', severity: 'error', enabled: true },
  {
    id: 'pen.furniture.wall_clearance',
    codes: ['furniture_clearance_insufficient', 'furniture_endpoint_clearance_insufficient', 'furniture_host_unknown', 'furniture_host_runtime_missing'],
    kinds: 'furniture↔host wall',
    severity: 'error',
    enabled: true,
  },
  { id: 'pen.furniture.glass', codes: ['furniture_glass_collision', 'furniture_glass_clearance_insufficient'], kinds: 'furniture↔glass/curtain/railing', severity: 'error', enabled: true },
  { id: 'pen.furniture.ceiling', codes: ['furniture_ceiling_collision'], kinds: 'furniture↔ceiling', severity: 'error', enabled: true },
  { id: 'pen.furniture.furniture', codes: ['furniture_furniture_collision', 'furniture_furniture_contact_tolerance'], kinds: 'furniture↔furniture', severity: 'error', enabled: true },
  { id: 'pen.glass.glass', codes: ['glass_runtime_collision'], kinds: 'glass↔glass', severity: 'error', enabled: true },
  { id: 'pen.furniture.opening_blocked', codes: ['pen.furniture.opening_blocked'], kinds: 'furniture↔door opening', severity: 'error', enabled: true },
];

/** 穿透族 code 全集：parity 测试与文档都引这一份，不各写一份。 */
export const PENETRATION_RULE_CODES: string[] = IMPLEMENTED_RULES.flatMap((rule) => rule.codes);

/** 规则层自身也会产出的 code（申报/豁免/机电策略），与规则 code 合起来即「穿透层全部产出」。 */
export const REGISTRY_CODES = [
  'pen.rule_duplicate',
  'pen.rule_severity_invalid',
  'pen.rule_code_unknown',
  'pen.rule_unimplemented',
  'pen.rule_undeclared',
  'pen.waiver_incomplete',
  'pen.waiver_rule_unknown',
  'pen.mep_participation_undeclared',
];

/** 穿透层产出全集：parity 测试与文档引这一份。 */
export const PENETRATION_LAYER_CODES: string[] = [...PENETRATION_RULE_CODES, ...REGISTRY_CODES];

export function loadAntiPenetrationConfig(): AntiPenetrationConfig {
  return parseYaml(readFileSync(path.join(ROOT, CONFIG_PATH), 'utf8')) as AntiPenetrationConfig;
}

/** 配置与实现互为镜像：申报了没实现、实现了没申报、重复 id、非法 severity 都报错。 */
export function validateAntiPenetrationRegistry(config: AntiPenetrationConfig, source = CONFIG_PATH): SpatialIssue[] {
  const issues: SpatialIssue[] = [];
  const seen = new Set<string>();
  for (const rule of config.rules ?? []) {
    if (seen.has(rule.id)) {
      issues.push({ level: 'error', code: 'pen.rule_duplicate', entity: rule.id, source, message: `rule ${rule.id} is declared twice`, evidence: { rule: rule.id } });
    }
    seen.add(rule.id);
    if (rule.severity !== 'error' && rule.severity !== 'warning') {
      issues.push({ level: 'error', code: 'pen.rule_severity_invalid', entity: rule.id, source, message: `rule ${rule.id} must declare severity error|warning`, evidence: { severity: rule.severity } });
    }
    if (!(rule.codes ?? []).every((code) => IMPLEMENTED_RULES.some((implemented) => implemented.codes.includes(code)))) {
      issues.push({ level: 'error', code: 'pen.rule_code_unknown', entity: rule.id, source, message: `rule ${rule.id} declares a code no implementation produces`, evidence: { codes: rule.codes } });
    }
    if (!IMPLEMENTED_RULES.some((implemented) => implemented.id === rule.id)) {
      issues.push({ level: 'error', code: 'pen.rule_unimplemented', entity: rule.id, source, message: `rule ${rule.id} is declared in config but has no implementation`, evidence: { rule: rule.id } });
    }
  }
  for (const implemented of IMPLEMENTED_RULES) {
    if (!seen.has(implemented.id)) {
      issues.push({ level: 'error', code: 'pen.rule_undeclared', entity: implemented.id, source, message: `implemented rule ${implemented.id} is not declared in ${CONFIG_PATH}`, evidence: { rule: implemented.id } });
    }
  }
  for (const waiver of config.waivers ?? []) {
    if (!waiver.reason || !waiver.owner || !waiver.expires) {
      issues.push({ level: 'error', code: 'pen.waiver_incomplete', entity: waiver.id, source, message: `waiver ${waiver.id} must carry reason, owner and expires`, evidence: { waiver } });
    }
    if (!seen.has(waiver.rule)) {
      issues.push({ level: 'error', code: 'pen.waiver_rule_unknown', entity: waiver.id, source, message: `waiver ${waiver.id} references unknown rule ${waiver.rule}`, evidence: { rule: waiver.rule } });
    }
  }
  return issues;
}

/** 每个 placed 的机电协调类型都必须显式申报参与策略；未申报 → fail-closed。 */
export function resolveMepParticipation(type: string, config: AntiPenetrationConfig): MepParticipationPolicy | undefined {
  return config.mep_parts?.participation?.find((entry) => entry.types.includes(type))?.policy;
}

export interface MepParticipationInput {
  house: { furnishings?: Record<string, unknown[]> };
  config: { mep_coordination_types?: string[] };
}

export function validateMepParticipation(inputs: MepParticipationInput, antiConfig: AntiPenetrationConfig, source = CONFIG_PATH): SpatialIssue[] {
  const issues: SpatialIssue[] = [];
  const declared = new Set((antiConfig.mep_parts?.participation ?? []).flatMap((entry) => entry.types));
  const placed = new Set<string>();
  for (const items of Object.values(inputs.house.furnishings ?? {})) {
    for (const entry of items ?? []) {
      const raw = entry as Record<string, unknown>;
      if (raw.x === undefined && raw.z === undefined && raw.wall === undefined && raw.along === undefined) continue;
      placed.add(String(raw.type ?? ''));
    }
  }
  for (const type of placed) {
    if (!(inputs.config.mep_coordination_types ?? []).includes(type)) continue;
    if (!declared.has(type)) {
      issues.push({ level: 'error', code: 'pen.mep_participation_undeclared', entity: type, source, message: `placed mep coordination type ${type} has no declared participation policy`, evidence: { type, declared_types: [...declared] } });
    }
  }
  return issues;
}

function ruleForCode(code: string, config: AntiPenetrationConfig): PenetrationRuleSpec | undefined {
  return (config.rules ?? []).find((rule) => (rule.codes ?? []).includes(code));
}

function applySeverityFloor(issues: SpatialIssue[], config: AntiPenetrationConfig): SpatialIssue[] {
  return issues.map((issue) => {
    const rule = ruleForCode(issue.code, config);
    if (!rule) return issue;
    if (!rule.enabled) {
      // 禁用的规则不静默消失：降为 info 并标注，仍可在报告里看见。
      return { ...issue, level: 'info', message: `${issue.message}（规则 ${rule.id} 已在配置中禁用）` };
    }
    return { ...issue, level: severityFloor(issue.level, rule.severity) };
  });
}

function applyWaivers(issues: SpatialIssue[], config: AntiPenetrationConfig, today: string): SpatialIssue[] {
  const waivers = config.waivers ?? [];
  const kept: SpatialIssue[] = [];
  for (const issue of issues) {
    const [left, right] = issue.entity.split('↔');
    const rule = ruleForCode(issue.code, config);
    const matched = rule && left !== undefined && right !== undefined
      ? waivers.find((waiver) => waiver.rule === rule.id && samePair(left, right, waiver.pair))
      : undefined;
    if (!matched) {
      kept.push(issue);
      continue;
    }
    if (matched.expires < today) {
      // 到期豁免不静默失效：原问题复活并带上豁免编号，便于追溯当初为什么放过。
      kept.push({
        ...issue,
        message: `${issue.message}（豁免 ${matched.id} 已于 ${matched.expires} 到期，自动复活）`,
        evidence: { ...issue.evidence, expired_waiver: matched.id, waiver_expires: matched.expires },
      });
    }
  }
  return kept;
}

/** 严重级下限 + 豁免过滤。纯函数，测试可用合成配置直接驱动。 */
export function applyPenetrationPolicy(issues: SpatialIssue[], config: AntiPenetrationConfig, today: string): SpatialIssue[] {
  return applyWaivers(applySeverityFloor(issues, config), config, today);
}

export interface PenetrationRunResult {
  issues: SpatialIssue[];
  /** 规则层自身配置问题（申报/豁免/mep 策略），与几何结论分开上报。 */
  registryIssues: SpatialIssue[];
}

/**
 * 跑全部穿透规则。两个 CLI 共用；`today` 由调用方注入（YYYY-MM-DD），
 * 保证测试可复现、CLI 不使用隐式当前时间。
 */
export function runPenetrationChecks(inputs: SceneInputs, scene: ReturnType<typeof buildRuntimeScene>, today: string): PenetrationRunResult {
  const config = loadAntiPenetrationConfig();
  const registryIssues = validateAntiPenetrationRegistry(config);
  registryIssues.push(...validateMepParticipation(inputs, config));

  const collected = collectPenetrationObjects(scene, inputs.structuralPaths);
  const issues: SpatialIssue[] = [];

  issues.push(...validateRuntimePenetration({
    furniture: collected.furniture,
    walls: collected.walls,
    glass: collected.glass,
    ceilings: collected.ceilings,
    relationships: inputs.config.relationships,
    glassJoins: deriveRuntimeGlassJoins(inputs.structuralPaths, inputs.config.overlay_replacements ?? []),
    mepTypes: inputs.config.mep_coordination_types,
    collisionMargin: inputs.config.tolerance_profiles?.default?.collision_margin ?? 0.005,
    glassRequiredClearance: requiredClearance(inputs.config.tolerance_profiles?.curtain_wall ?? {}),
    source: SOURCE,
  }));

  // 只有显式申报为 solid 的机电构件才按实体参与墙穿透；默认 excluded
  // （预留区/管井不是实体，穿墙由 MEP 专项校验负责，见配置注释）。
  const solidMep = collected.furniture.filter((object) => {
    const type = collected.furnitureEntries.find((entry) => entry.entity === object.id)?.type;
    return type !== undefined && resolveMepParticipation(type, config) === 'solid';
  });
  if (solidMep.length > 0) {
    issues.push(...validateRuntimePenetration({ furniture: solidMep, walls: collected.walls, source: SOURCE }));
  }

  issues.push(...validateFurnitureOpenings({ walls: inputs.layout.walls, furniture: collected.furnitureEntries, source: SOURCE }));
  issues.push(...placedClearanceIssues(inputs, collected));

  return { issues: applyPenetrationPolicy(issues, config, today), registryIssues };
}

function placedClearanceIssues(inputs: SceneInputs, collected: ReturnType<typeof collectPenetrationObjects>): SpatialIssue[] {
  const issues: SpatialIssue[] = [];
  const config = inputs.config;
  const wallMap = new Map(inputs.layout.walls.map((wall) => [wall.id, wall]));
  const furnitureById = new Map(collected.furnitureEntries.map((entry) => [entry.entity, entry]));
  for (const [roomId, items] of Object.entries(inputs.house.furnishings ?? {})) {
    let runtimeIndex = 0;
    for (const raw of items) {
      const item = raw as unknown as Record<string, unknown>;
      const isPlaced = item.x !== undefined || item.z !== undefined || item.wall !== undefined || item.along !== undefined;
      if (!isPlaced) continue;
      const type = String(item.type ?? '');
      const runtimeId = `furniture:${roomId}:${type}:${runtimeIndex}`;
      runtimeIndex++;
      const dims = declaredDims(item, type);
      if (!dims || dims.width <= 0 || dims.depth <= 0) continue;
      const entry = furnitureById.get(runtimeId);
      if (!entry) continue;
      if (!entry.object || !objectHasMesh(entry.object)) continue;
      const override = profileFor(type, config);
      if (!override) continue;
      const profile = config.tolerance_profiles?.[override.profile] ?? config.tolerance_profiles?.default ?? {};
      issues.push(...validateFurnitureClearance({ entry, type, override, profile, wallEntries: collected.wallEntries, wallMap, source: SOURCE }));
    }
  }
  return issues;
}
