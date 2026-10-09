// 防穿模规则层的登记表 / 豁免 / 严重级下限 / 机电参与策略 / 洞口规则 / 兄弟 mesh 不变式。
//
// 这一层是「配置与实现互为镜像」的守门测试：申报了没实现、实现了没申报、豁免缺
// reason/owner/expires、机电类型未申报参与策略，都必须 fail-closed。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { load as parseYaml } from 'js-yaml';
import { readFileSync } from 'node:fs';
import {
  IMPLEMENTED_RULES,
  PENETRATION_LAYER_CODES,
  PENETRATION_RULE_CODES,
  applyPenetrationPolicy,
  loadAntiPenetrationConfig,
  validateAntiPenetrationRegistry,
  validateMepParticipation,
  resolveMepParticipation,
  type MepParticipationInput,
} from '../../shared/penetration/registry.js';
import { validateFurnitureOpenings } from '../../shared/penetration/openings.js';
import { loadSceneInputs, buildRuntimeScene, collectPenetrationObjects } from '../../shared/penetration/scene.js';
import type { SpatialIssue } from '../../shared/spatial-validation.js';

const issue = (code: string, entity: string, level: SpatialIssue['level'] = 'error'): SpatialIssue => ({
  level, code, entity, source: 'test', message: `${code} on ${entity}`, evidence: {},
});

describe('anti-penetration registry', () => {
  it('accepts the shipped config: every implemented rule is declared and vice versa', () => {
    const config = loadAntiPenetrationConfig();
    assert.deepEqual(validateAntiPenetrationRegistry(config), []);
    assert.equal(IMPLEMENTED_RULES.length, (config.rules ?? []).length);
  });

  it('fails closed when config declares a rule with no implementation', () => {
    const config = loadAntiPenetrationConfig();
    config.rules.push({ id: 'pen.furniture.teleport', codes: ['furniture_teleport_collision'], kinds: 'x', severity: 'error', enabled: true });
    const issues = validateAntiPenetrationRegistry(config);
    assert.ok(issues.some((item) => item.code === 'pen.rule_unimplemented' && item.entity === 'pen.furniture.teleport'));
  });

  it('fails closed when an implemented rule is missing from config', () => {
    const config = loadAntiPenetrationConfig();
    config.rules = config.rules.filter((rule) => rule.id !== 'pen.furniture.opening_blocked');
    const issues = validateAntiPenetrationRegistry(config);
    assert.ok(issues.some((item) => item.code === 'pen.rule_undeclared' && item.entity === 'pen.furniture.opening_blocked'));
  });

  it('rejects duplicate rule ids, bad severity and unknown codes', () => {
    const config = loadAntiPenetrationConfig();
    config.rules.push({ ...config.rules[0] });
    config.rules.push({ id: 'pen.bad.severity', codes: [], kinds: 'x', severity: 'fatal' as 'error', enabled: true });
    config.rules.push({ id: 'pen.bad.code', codes: ['not_a_real_code'], kinds: 'x', severity: 'error', enabled: true });
    const codes = validateAntiPenetrationRegistry(config).map((item) => item.code);
    assert.ok(codes.includes('pen.rule_duplicate'));
    assert.ok(codes.includes('pen.rule_severity_invalid'));
    assert.ok(codes.includes('pen.rule_code_unknown'));
  });
});

describe('penetration severity floor', () => {
  const config = loadAntiPenetrationConfig();

  it('lets config tighten a warning but never loosen an error', () => {
    const tightened = applyPenetrationPolicy([issue('pen.furniture.opening_blocked', 'a↔b', 'warning')], config, '2026-10-09');
    assert.equal(tightened[0].level, 'error', 'config severity is a floor and may only tighten');

    const kept = applyPenetrationPolicy([issue('furniture_wall_collision', 'a↔b', 'error')], config, '2026-10-09');
    assert.equal(kept[0].level, 'error', 'config can never盖住 a rule-level error');

    const untouched = applyPenetrationPolicy([issue('furniture_glass_clearance_insufficient', 'a↔b', 'warning')], config, '2026-10-09');
    assert.equal(untouched[0].level, 'warning', 'glass clearance stays warning: floor is warning');
  });

  it('downgrades a disabled rule to info instead of silently dropping it', () => {
    const disabled = parseYaml(readFileSync(new URL('../../config/anti-penetration.yaml', import.meta.url), 'utf8')) as typeof config;
    disabled.rules = disabled.rules.map((rule) => (rule.id === 'pen.furniture.ceiling' ? { ...rule, enabled: false } : rule));
    const issues = applyPenetrationPolicy([issue('furniture_ceiling_collision', 'a↔b', 'error')], disabled, '2026-10-09');
    assert.equal(issues.length, 1, 'a disabled rule must still be visible');
    assert.equal(issues[0].level, 'info');
    assert.match(issues[0].message, /已在配置中禁用/);
  });
});

describe('penetration waivers', () => {
  const base = loadAntiPenetrationConfig();
  const config = {
    ...base,
    waivers: [{
      id: 'w-test-01', rule: 'pen.furniture.furniture', pair: ['furniture:kitchen:fridge:5', 'furniture:kitchen:kitchen_cabinet_run:4'] as [string, string],
      reason: 'test waiver', owner: 'owner', expires: '2027-06-30',
    }],
  };

  it('suppresses only the exact declared pair, in either order', () => {
    const forward = applyPenetrationPolicy([issue('furniture_furniture_collision', 'furniture:kitchen:fridge:5↔furniture:kitchen:kitchen_cabinet_run:4')], config, '2026-10-09');
    assert.equal(forward.length, 0);
    const backward = applyPenetrationPolicy([issue('furniture_furniture_collision', 'furniture:kitchen:kitchen_cabinet_run:4↔furniture:kitchen:fridge:5')], config, '2026-10-09');
    assert.equal(backward.length, 0);
    const other = applyPenetrationPolicy([issue('furniture_furniture_collision', 'furniture:kitchen:fridge:5↔furniture:kitchen:sink:8')], config, '2026-10-09');
    assert.equal(other.length, 1, 'waivers bind stable runtime ids, never a whole type');
  });

  it('revives an expired waiver as an error carrying the waiver id', () => {
    const expired = { ...config, waivers: [{ ...config.waivers![0], expires: '2026-01-01' }] };
    const issues = applyPenetrationPolicy([issue('furniture_furniture_collision', 'furniture:kitchen:fridge:5↔furniture:kitchen:kitchen_cabinet_run:4')], expired, '2026-10-09');
    assert.equal(issues.length, 1);
    assert.equal(issues[0].level, 'error');
    assert.match(issues[0].message, /w-test-01/);
    assert.equal((issues[0].evidence as { expired_waiver?: string }).expired_waiver, 'w-test-01');
  });

  it('rejects waivers without reason/owner/expires or with an unknown rule', () => {
    const broken = {
      ...base,
      waivers: [
        { id: 'w-bad-01', rule: 'pen.furniture.furniture', pair: ['a', 'b'] as [string, string], reason: '', owner: '', expires: '' },
        { id: 'w-bad-02', rule: 'pen.nope', pair: ['a', 'b'] as [string, string], reason: 'r', owner: 'o', expires: '2027-01-01' },
      ],
    };
    const codes = validateAntiPenetrationRegistry(broken).map((item) => item.code);
    assert.ok(codes.includes('pen.waiver_incomplete'));
    assert.ok(codes.includes('pen.waiver_rule_unknown'));
  });
});

describe('mep participation policy', () => {
  const config = loadAntiPenetrationConfig();

  it('declares every placed mep coordination type', () => {
    const inputs = loadSceneInputs();
    const declared = new Set((config.mep_parts?.participation ?? []).flatMap((entry) => entry.types));
    const placed = new Set<string>();
    for (const items of Object.values(inputs.house.furnishings ?? {})) {
      for (const item of items) {
        const raw = item as unknown as Record<string, unknown>;
        if (raw.x === undefined && raw.z === undefined && raw.wall === undefined && raw.along === undefined) continue;
        placed.add(String(raw.type ?? ''));
      }
    }
    for (const type of placed) {
      if (!(inputs.config.mep_coordination_types ?? []).includes(type)) continue;
      assert.ok(declared.has(type), `placed mep type ${type} must declare a participation policy`);
    }
  });

  it('fails closed when a placed mep type has no declared policy', () => {
    const inputs: MepParticipationInput = {
      house: { furnishings: { master_bedroom: [{ type: 'mb_vanity_pvc_box', x: 1, z: 1 }] } },
      config: { mep_coordination_types: ['mb_vanity_pvc_box'] },
    };
    const issues = validateMepParticipation(inputs, { ...config, mep_parts: { participation: [] } });
    assert.ok(issues.some((item) => item.code === 'pen.mep_participation_undeclared' && item.level === 'error'));
  });

  it('resolves the declared policy per type', () => {
    assert.equal(resolveMepParticipation('mb_vanity_pvc_service_chase', config), 'excluded');
    assert.equal(resolveMepParticipation('sofa_3seat', config), undefined);
  });
});

describe('furniture vs door openings', () => {
  const wall = (id: string, x1: number, z1: number, x2: number, z2: number) => ({ id, x1, z1, x2, z2, height: 2.8, openings: [] as never[] });
  const entry = (entity: string, type: string, minY: number, maxY: number, minX: number, maxX: number, minZ: number, maxZ: number) => ({
    entity, type, box: { minX, maxX, minY, maxY, minZ, maxZ },
  });

  it('reports furniture whose footprint blocks the door clear width', () => {
    const walls = [{
      ...wall('w_test', 0, 0, 3, 0),
      openings: [{ id: 'd_test', type: 'door', x: 1.5, z: 0, width: 0.9, height: 2.1 }],
    }];
    const issues = validateFurnitureOpenings({
      walls: walls as never,
      furniture: [entry('furniture:room:wardrobe_180:0', 'wardrobe_180', 0, 2.4, 1.2, 1.8, -0.3, 0.3)],
      source: 'test',
    });
    assert.ok(issues.some((item) => item.code === 'pen.furniture.opening_blocked' && item.level === 'error'));
    assert.equal((issues[0].evidence as { opening?: string }).opening, 'd_test');
  });

  it('ignores objects above the passage clear height, below the floor and windows', () => {
    const walls = [{
      ...wall('w_test', 0, 0, 3, 0),
      openings: [
        { id: 'd_test', type: 'door', x: 1.5, z: 0, width: 0.9, height: 2.1 },
        { id: 'w_test_win', type: 'window', x: 0.5, z: 0, width: 1.5, height: 1.4, sill: 0.9 },
      ],
    }];
    const ceilingMounted = entry('furniture:room:condensate_pipe_ac_outlet:0', 'condensate_pipe_ac_outlet', 2.63, 2.67, 1.2, 1.8, -0.3, 0.3);
    const kickboard = entry('furniture:room:skirt:0', 'skirt', 0, 0.01, 1.2, 1.8, -0.3, 0.3);
    const atWindow = entry('furniture:room:desk:0', 'desk', 0, 0.75, 0.2, 0.8, -0.4, 0.4);
    const issues = validateFurnitureOpenings({ walls: walls as never, furniture: [ceilingMounted, kickboard, atWindow], source: 'test' });
    assert.equal(issues.length, 0, 'ceiling-mounted parts, skirt boards and window openings must not count as blocking');
  });
});

describe('penetration collection invariants', () => {
  it('honours the declared sibling_policy: one runtime entry per placed furniture entity', () => {
    // config/anti-penetration.yaml 的 sibling_policy.one_entry_per_entity 是显式声明；
    // 2026-10-09 实测 60/60。复合家具一旦开始产出多条记录，家具互撞就会出现兄弟 mesh
    // 假阳——这里先红，再决定是豁免还是修几何，不加推测性规则。
    const config = loadAntiPenetrationConfig();
    assert.equal(config.sibling_policy?.one_entry_per_entity, true, 'sibling_policy must stay declared');
    const inputs = loadSceneInputs();
    const collected = collectPenetrationObjects(buildRuntimeScene(inputs), inputs.structuralPaths);
    const counts = new Map<string, number>();
    for (const item of collected.furnitureEntries) counts.set(item.entity, (counts.get(item.entity) ?? 0) + 1);
    const duplicated = [...counts.entries()].filter(([, count]) => count > 1);
    assert.deepEqual(duplicated, [], 'one runtime entity must not produce several collection entries');
  });

  it('keeps the penetration code registry free of duplicates', () => {
    assert.equal(new Set(PENETRATION_RULE_CODES).size, PENETRATION_RULE_CODES.length);
    assert.equal(new Set(PENETRATION_LAYER_CODES).size, PENETRATION_LAYER_CODES.length);
  });
});
