// tests/server/facts-lint.test.ts
// 非几何数据对账引擎（shared/facts-lint.ts）的单测 + 真实仓数据断言。
// 合成用例全部走内存 workspace（不碰 fs），真实用例用 readFileSync 读仓库根。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { load as parseYaml } from 'js-yaml';
import { lintFacts, type FactsRegistry, type FactsWorkspace } from '../../shared/facts-lint.js';

// ─── 内存 workspace ─────────────────────────────────────────────────────────

function workspaceOf(files: Record<string, string>, datasets: FactsWorkspace['datasets'] = {}): FactsWorkspace {
  return {
    read(rel: string): string | null { return Object.prototype.hasOwnProperty.call(files, rel) ? files[rel] : null; },
    load(rel: string): unknown | null {
      const text = this.read(rel);
      if (text === null) return null;
      try { return rel.endsWith('.json') ? JSON.parse(text) : parseYaml(text); } catch { return null; }
    },
    grep(rel: string, re: RegExp): RegExpExecArray[] {
      const text = this.read(rel);
      if (text === null) return [];
      const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
      global.lastIndex = 0;
      const out: RegExpExecArray[] = [];
      let m: RegExpExecArray | null;
      while ((m = global.exec(text)) !== null) {
        out.push(m);
        if (m[0].length === 0) global.lastIndex += 1;
      }
      return out;
    },
    datasets,
  };
}

const emptyRegistry: FactsRegistry = { scan: { include: ['docs/'], scalars: [] }, facts: [], contracts: [], coverage: [] };

// ─── T2 对账层 ───────────────────────────────────────────────────────────────

test('derived 权威值可从机器源推导，并与镜像逐条对账', () => {
  const registry: FactsRegistry = {
    ...emptyRegistry,
    facts: [{
      id: 'fact.circuit_count',
      kind: 'derived',
      value: '@config/electrical-topology.yaml:circuits.length',
      unit: '路',
      mirrors: [
        { path: 'docs/a.md', extract: '本户\\s*(\\d+)\\s*路', expect_matches: 1 },
        { path: 'docs/b.md', extract: '拓扑\\s*(\\d+)\\s*路', expect_matches: 1 },
      ],
    }],
  };
  const ws = workspaceOf({
    'config/electrical-topology.yaml': 'circuits:\n  - id: c1\n  - id: c2\n  - id: c3\n',
    'docs/a.md': '本户 3 路\n',
    'docs/b.md': '拓扑 2 路\n',
  });
  const result = lintFacts(registry, ws);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, 'fact_mismatch');
  assert.equal(result.errors[0].location, 'docs/b.md:1');
  assert.match(result.errors[0].message, /fact\.circuit_count/);
  assert.match(result.errors[0].message, /权威值 3 路/);
  assert.match(result.errors[0].message, /镜像值 2/);
});

test('narrative 权威值逐字定位失败时报 authoritative_unresolvable', () => {
  const registry: FactsRegistry = {
    ...emptyRegistry,
    facts: [{ id: 'fact.money', kind: 'narrative', value: '@docs/gone.md:合计 1,000 元', mirrors: [] }],
  };
  const result = lintFacts(registry, workspaceOf({ 'docs/here.md': '合计 1,000 元\n' }));
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, 'authoritative_unresolvable');
  assert.match(result.errors[0].message, /fact\.money/);
});

test('expect_matches 不命中时报 mirror_unresolvable，不允许静默跳过', () => {
  const registry: FactsRegistry = {
    ...emptyRegistry,
    facts: [{
      id: 'fact.area',
      kind: 'narrative',
      value: '@docs/auth.md:面积 12.75 ㎡',
      mirrors: [{ path: 'docs/mirror.md', extract: '面积约\\s*([\\d.]+)\\s*㎡', expect_matches: 1 }],
    }],
  };
  const nothing = lintFacts(registry, workspaceOf({
    'docs/auth.md': '面积 12.75 ㎡\n',
    'docs/mirror.md': '本行没有任何面积数字\n',
  }));
  assert.equal(nothing.errors.length, 1);
  assert.equal(nothing.errors[0].code, 'mirror_unresolvable');
  assert.match(nothing.errors[0].message, /命中 0 次，期望 1 次/);

  // 命中数多于期望同样报错（防止正则悄悄变宽把别处也吞进来）
  const twice = lintFacts(registry, workspaceOf({
    'docs/auth.md': '面积 12.75 ㎡\n',
    'docs/mirror.md': '面积约 12.75 ㎡\n面积约 8.35 ㎡\n',
  }));
  assert.equal(twice.errors.length, 1);
  assert.equal(twice.errors[0].code, 'mirror_unresolvable');
  assert.match(twice.errors[0].message, /命中 2 次，期望 1 次/);
});

test('镜像 severity: warning 时不一致只降级为警告', () => {
  const registry: FactsRegistry = {
    ...emptyRegistry,
    facts: [{
      id: 'fact.floor_height_net',
      kind: 'derived',
      value: '@config/house.yaml:project.floor_height',
      unit: 'm',
      mirrors: [{ path: 'README.md', extract: '层高[^0-9]{0,20}([\\d.]+)\\s*m', severity: 'warning', expect_matches: 1 }],
    }],
  };
  const result = lintFacts(registry, workspaceOf({
    'config/house.yaml': 'project:\n  floor_height: 2.8\n',
    'README.md': '| 层高 | **3.0m** |\n',
  }));
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].code, 'fact_mismatch');
  assert.equal(result.warnings[0].level, 'warning');
});

test('数值归一化去掉逗号/货币符/单位，tolerance 生效', () => {
  const registry: FactsRegistry = {
    ...emptyRegistry,
    facts: [{
      id: 'fact.money',
      kind: 'narrative',
      value: '@docs/auth.md:合计 36,000 元',
      tolerance: 0,
      mirrors: [{ path: 'docs/mirror.md', extract: '成交价\\s*¥?([\\d,]+)' }],
    }],
  };
  const result = lintFacts(registry, workspaceOf({
    'docs/auth.md': '合计 36,000 元\n',
    'docs/mirror.md': '成交价 ¥36,000 元\n',
  }));
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);
});

// ─── T3 契约层 ───────────────────────────────────────────────────────────────

test('mutex：同一文件内互斥表述并存即报错', () => {
  const registry: FactsRegistry = {
    ...emptyRegistry,
    contracts: [{
      id: 'c.hvac_price_boundary_mutex',
      kind: 'mutex',
      scope: ['docs/'],
      patterns: ['(?<![不])含.{0,4}复合风管', '不含复合风管'],
    }],
  };
  const files = { 'scan.files': ['docs/a.md', 'docs/b.md', 'docs/c.md'] };
  const conflict = lintFacts(registry, workspaceOf({
    // mutex 的判定域是「同一文件」：两个文件各自含一类才构成并存
    'docs/a.md': '合计 36,000 元（含辅材、含复合风管）；⚠️ 该 36,000 不含复合风管\n',
    'docs/b.md': '含辅材、含复合风管\n',
    'docs/c.md': '只含辅材，没提风管\n',
  }, files));
  assert.equal(conflict.errors.length, 1);
  assert.equal(conflict.errors[0].location, 'docs/a.md:1');
  assert.equal(conflict.errors[0].code, 'mutex_violation');

  // 两类分布在两个不同文件（各有其一）时不报
  const split = lintFacts(registry, workspaceOf({
    'docs/a.md': '含辅材、含复合风管\n',
    'docs/b.md': '不含复合风管\n',
  }, files));
  assert.equal(split.errors.length, 0);
});

test('mutex：否定环视避免「含复合风管」被子串「不含复合风管」误命中', () => {
  const registry: FactsRegistry = {
    ...emptyRegistry,
    contracts: [{ id: 'c.x', kind: 'mutex', scope: ['docs/'], patterns: ['(?<![不])含复合风管', '不含复合风管'] }],
  };
  const files = { 'scan.files': ['docs/a.md'] };
  const onlyNegative = lintFacts(registry, workspaceOf({ 'docs/a.md': '该价不含复合风管\n' }, files));
  assert.equal(onlyNegative.errors.length, 0);
  const withPositive = lintFacts(registry, workspaceOf({ 'docs/a.md': '含复合风管\n该价不含复合风管\n' }, files));
  assert.equal(withPositive.errors.length, 1);
});

test('unique：allow_suffix 的补充条目不与正牌判重，两个无后缀同号才报重号', () => {
  const registry: FactsRegistry = {
    ...emptyRegistry,
    contracts: [{
      id: 'c.dec_unique',
      kind: 'unique',
      source: 'docs/decision_log.md',
      pattern: '^#+\\s*(DEC-\\d{4}-\\d{2}-\\d{2}-[A-Za-z0-9.]+)',
      allow_suffix: ['-补', '-补2', '.1', '.2', '.3'],
    }],
  };
  const clean = lintFacts(registry, workspaceOf({ 'docs/decision_log.md': [
    '# DEC-2026-01-01-001 正牌',
    '# DEC-2026-01-01-001-补 补充',
    '# DEC-2026-01-01-001-补2 再补充',
    '# DEC-2026-01-01-001.1 修订',
    '# DEC-2026-01-01-002 另一条',
  ].join('\n') }));
  assert.equal(clean.errors.length, 0);

  const dup = lintFacts(registry, workspaceOf({ 'docs/decision_log.md': [
    '# DEC-2026-01-01-001 正牌',
    '# DEC-2026-01-01-001-补 补充',
    '# DEC-2026-01-01-002 另一条',
    '# DEC-2026-01-01-002 重号',
  ].join('\n') }));
  assert.equal(dup.errors.length, 1);
  assert.equal(dup.errors[0].code, 'duplicate_id');
  assert.equal(dup.errors[0].location, 'docs/decision_log.md:4');
});

test('sum：逐项 allocation 求和与声明的 total 不等时报错，相等则通过', () => {
  const registry: FactsRegistry = {
    ...emptyRegistry,
    contracts: [{ id: 'c.templates_allocation_sum', kind: 'sum', source: 'config/pitfalls.yaml', items_path: 'templates', field: 'allocation' }],
  };
  const doc = [
    'templates:',
    '  - id: ok',
    '    total: 100',
    '    allocation: { a: 40, b: 60 }',
    '  - id: bad',
    '    total: 200',
    '    allocation: { a: 40, b: 60 }',
  ].join('\n');
  const result = lintFacts(registry, workspaceOf({ 'config/pitfalls.yaml': doc }));
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, 'sum_mismatch');
  assert.match(result.errors[0].message, /templates\.bad 合计 100 ≠ 声明 200/);
});

test('sum：total_path 模式只累加指定字段，不把 material/actual/labor 一起算进去', () => {
  const registry: FactsRegistry = {
    ...emptyRegistry,
    contracts: [{ id: 'c.base_budget_sum', kind: 'sum', source: 'config/budget/base.json', items_path: 'categories', field: 'budget', total_path: 'total_budget' }],
  };
  const result = lintFacts(registry, workspaceOf({
    'config/budget/base.json': JSON.stringify({
      total_budget: 100,
      categories: { x: { budget: 60, material: 100, actual: 0 }, y: { budget: 40, material: 0, actual: 0 } },
    }),
  }));
  assert.equal(result.errors.length, 0);
});

test('fk：引用 id 不在目标集合里即 dangling；severity: warning 时降级', () => {
  const registry: FactsRegistry = {
    ...emptyRegistry,
    contracts: [{
      id: 'c.material_ref',
      kind: 'fk',
      severity: 'warning',
      ref_pattern: '\\b([a-z][a-z0-9]*(?:_[a-z0-9]+)*_\\d{2})\\b',
      ref_scope: ['docs/'],
      target: 'config/materials.yaml',
      target_pattern: '- id:\\s*["\']?([A-Za-z0-9_.\\-]+)["\']?',
    }],
  };
  const result = lintFacts(registry, workspaceOf({
    'docs/procurement.md': '候选 floor_tile_04，另有 floor_tile_01\n',
    'config/materials.yaml': 'materials:\n  - id: "floor_tile_01"\n',
  }, { 'contract.files': ['docs/procurement.md', 'config/materials.yaml'] }));
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].code, 'dangling_reference');
  assert.match(result.warnings[0].message, /floor_tile_04/);
});

test('requires：条件对象的同级缺少 then 字段时报错', () => {
  const registry: FactsRegistry = {
    ...emptyRegistry,
    contracts: [{
      id: 'c.contract_requires_lock',
      kind: 'requires',
      path: 'schedule/control.yaml',
      when: { field: 'status', equals: 'locked' },
      then: ['locked_cny', 'contract_ref', 'evidence_path'],
    }],
  };
  const result = lintFacts(registry, workspaceOf({
    'schedule/control.yaml': [
      'records:',
      '  - id: A',
      '    status: locked',
      '    locked_cny: 100',
      '    contract_ref: "c-1"',
      '    evidence_path: "contracts/x/"',
      '  - id: B',
      '    status: locked',
      '  - id: C',
      '    status: pending',
    ].join('\n'),
  }, { 'contract.files': ['schedule/control.yaml'] }));
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, 'required_field_missing');
  assert.match(result.errors[0].message, /B 缺少 locked_cny、contract_ref、evidence_path/);
});

test('parity：右表缺失或字段不等都报错', () => {
  const registry: FactsRegistry = {
    ...emptyRegistry,
    contracts: [{
      id: 'c.light_height_parity',
      kind: 'parity',
      left: { path: 'config/electrical.yaml', key: 'id', field: 'height', filter_field: 'type', filter_values: ['ceiling_light'] },
      right: { path: 'config/render/overrides.yaml', key: 'id', field: 'anchorY' },
    }],
  };
  const result = lintFacts(registry, workspaceOf({
    'config/electrical.yaml': '- id: a\n  type: ceiling_light\n  height: 2.8\n- id: b\n  type: ceiling_light\n  height: 2.5\n- id: c\n  type: socket\n  height: 0.3\n',
    'config/render/overrides.yaml': '- id: a\n  anchorY: 2.55\n',
  }));
  assert.equal(result.errors.length, 2);
  assert.deepEqual(result.errors.map((i) => i.code).sort(), ['parity_mismatch', 'parity_missing']);
  assert.match(result.errors.find((i) => i.code === 'parity_mismatch')!.message, /config\/electrical\.yaml\.height=2\.8 ≠ config\/render\/overrides\.yaml\.anchorY=2\.55/);
});

test('non_empty：规则引用的目标 type 不存在时报空转，规则自带 file 时改从该文件取集合', () => {
  const registry: FactsRegistry = {
    ...emptyRegistry,
    contracts: [{
      id: 'c.rule_targets_exist',
      kind: 'non_empty',
      source: 'config/verify-rules.yaml',
      sections: ['proximity', 'clearance'],
      rule_fields: ['b.match.type', 'furniture_types'],
      rule_file_field: 'b.file',
      file_map: { ceiling: 'config/ceiling.yaml', furniture: 'config/house.yaml' },
      target: 'config/house.yaml',
      target_path: 'furnishings',
      key_field: 'type',
    }],
  };
  const result = lintFacts(registry, workspaceOf({
    'config/verify-rules.yaml': [
      'proximity:',
      '  - id: r1',
      '    b: { file: furniture, match: { type: tv_stand } }',
      '  - id: r2',
      '    b: { file: ceiling, match: { type: ac_indoor } }',
      'clearance:',
      '  furniture_types: [wardrobe_240, bed_180]',
    ].join('\n'),
    'config/ceiling.yaml': '- id: z\n  type: ac_indoor\n',
    'config/house.yaml': 'furnishings:\n  master_bedroom:\n    - type: bed_180\n',
  }));
  // tv_stand（furniture 域）与 wardrobe_240（默认域）空转；ac_indoor 在 ceiling.yaml 里存在，不报
  assert.equal(result.warnings.length, 2);
  assert.deepEqual(result.warnings.map((i) => i.code), ['rule_target_absent', 'rule_target_absent']);
  assert.match(result.warnings[0].message, /tv_stand.*config\/house\.yaml 的 type/);
});

test('overlap：两个 dataset 的多边形有交叠时报出双方 id 与面积', () => {
  const registry: FactsRegistry = {
    ...emptyRegistry,
    contracts: [{
      id: 'c.layout_region_room_overlap',
      kind: 'overlap',
      datasets: ['layout.floor_regions', 'layout.rooms'],
    }],
  };
  const result = lintFacts(registry, workspaceOf({}, {
    'layout.floor_regions': [{ id: 'corridor_floor', points: [{ x: 4.2, z: 5.55 }, { x: 7.2, z: 5.55 }, { x: 7.2, z: 7.8 }, { x: 4.2, z: 7.8 }] }],
    'layout.rooms': [
      { id: 'study', polygon: [{ x: 4.2, z: 5.55 }, { x: 7.2, z: 5.55 }, { x: 7.2, z: 9.8 }, { x: 4.2, z: 9.8 }] },
      { id: 'kitchen', polygon: [{ x: 7.2, z: 0 }, { x: 10.8, z: 0 }, { x: 10.8, z: 2.4 }, { x: 7.2, z: 2.4 }] },
    ],
  }));
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, 'polygon_overlap');
  assert.match(result.errors[0].message, /corridor_floor 与 layout\.rooms\/study 多边形交叠，交叠面积 6\.75㎡/);
});

// ─── T1 发现层 / T4 覆盖层 ───────────────────────────────────────────────────

test('scan：未被任何 mirror/exempt 覆盖的标量出现报 unregistered_fact_occurrence', () => {
  const scalar = { id: 'money', pattern: '[¥￥]\\s?([\\d,]{4,})' };
  const bare: FactsRegistry = { ...emptyRegistry, scan: { include: ['docs/'], scalars: [scalar] } };
  const result = lintFacts(bare, workspaceOf({ 'docs/a.md': '成交价 ¥36,000 元\n历史 ¥29,000 元\n' }, { 'scan.files': ['docs/a.md'] }));
  assert.equal(result.warnings.length, 2);
  assert.equal(result.warnings[0].code, 'unregistered_fact_occurrence');
  const byValue = new Map(result.warnings.map((i) => [i.message.match(/的值 (\d+) /)![1], i]));
  assert.match(byValue.get('36000')!.message, /标量 money 的值 36000 出现 1 次.*docs\/a\.md:1/);
  assert.match(byValue.get('29000')!.message, /docs\/a\.md:2/);

  const covered: FactsRegistry = {
    ...emptyRegistry,
    scan: { include: ['docs/'], scalars: [scalar], exempt_occurrences: [{ path: 'docs/', pattern: '.', reason: '测试：整目录登记为噪声' }] },
    facts: [{ id: 'f', kind: 'narrative', value: '@docs/a.md:成交价 ¥36,000 元', mirrors: [{ path: 'docs/a.md', extract: '成交价\\s*¥?([\\d,]+)' }] }],
  };
  const quiet = lintFacts(covered, workspaceOf({ 'docs/a.md': '成交价 ¥36,000 元\n历史 ¥29,000 元\n' }, { 'scan.files': ['docs/a.md'] }));
  assert.equal(quiet.warnings.length, 0);
  assert.equal(quiet.errors.length, 0);
});

test('coverage：未登记的顶层字段报 field_uncovered，声称为 reader 却不读它的源码报 error', () => {
  const registry: FactsRegistry = {
    ...emptyRegistry,
    coverage: [
      { file: 'config/a.yaml', field: 'registered', readers: ['shared/reader.ts'] },
      { file: 'config/a.yaml', field: 'orphan', readers: [] },
    ],
  };
  const result = lintFacts(registry, workspaceOf({
    'config/a.yaml': 'registered: 1\norphan: 2\nsurprise: 3\n',
    'shared/reader.ts': 'export const registered = 1;\n',
  }, { 'coverage.files': ['config/a.yaml'] }));
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].code, 'field_uncovered');
  assert.match(result.warnings[0].message, /config\/a\.yaml 顶层字段 surprise 未登记/);

  const liar: FactsRegistry = { ...emptyRegistry, coverage: [{ file: 'config/a.yaml', field: 'registered', readers: ['shared/absent.ts'] }] };
  const lied = lintFacts(liar, workspaceOf({ 'config/a.yaml': 'registered: 1\n' }, { 'coverage.files': ['config/a.yaml'] }));
  assert.equal(lied.errors.length, 1);
  assert.equal(lied.errors[0].code, 'declared_reader_does_not_read');
});

// ─── 真实仓数据 ──────────────────────────────────────────────────────────────

const realWorkspace = (): FactsWorkspace => {
  const read = (rel: string): string | null => {
    try { return readFileSync(rel, 'utf8'); } catch { return null; }
  };
  return {
    read,
    load(rel: string): unknown | null {
      const text = read(rel);
      if (text === null) return null;
      try { return rel.endsWith('.json') ? JSON.parse(text) : parseYaml(text); } catch { return null; }
    },
    grep(rel: string, re: RegExp): RegExpExecArray[] {
      const text = read(rel);
      if (text === null) return [];
      const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
      global.lastIndex = 0;
      const out: RegExpExecArray[] = [];
      let m: RegExpExecArray | null;
      while ((m = global.exec(text)) !== null) {
        out.push(m);
        if (m[0].length === 0) global.lastIndex += 1;
      }
      return out;
    },
    datasets: {
      'scan.files': [],
      'contract.files': [],
      'coverage.files': [],
      'layout.rooms': [],
      'layout.floor_regions': [],
    },
  };
};

test('真实登记表：fact.circuit_count 的四个镜像在真实文件上全部解析且与权威值 20 路一致', () => {
  // 2026-10-04 数据修正（A1/A2）后，acceptance.yaml:283 与 pending-site-data.md:90 的
  // 「19 路」已改为「20 路」，与 electrical-topology.yaml circuits.length=20 收敛。
  // 本测试原先断言「必须抓到 19 ≠ 20 的漂移」；漂移已修，故改为断言收敛后的不变量：
  // 四个 mirror（acceptance / pending-site-data / mep-construction-guidance / checklist×2）
  // 的 expect_matches 全部命中、且抽得值都等于权威值 → 0 error。
  const registry = parseYaml(readFileSync('config/facts.yaml', 'utf8')) as FactsRegistry;
  const circuit = (registry.facts ?? []).find((f) => f.id === 'fact.circuit_count')!;
  assert.ok(circuit, 'config/facts.yaml 必须登记 fact.circuit_count');
  assert.equal(circuit.mirrors?.length, 4, 'fact.circuit_count 必须保留 4 个镜像，不许删');
  const result = lintFacts({ ...emptyRegistry, facts: [circuit] }, realWorkspace());
  assert.deepEqual(result.errors, [], `circuit_count 对账应全绿，实际：${JSON.stringify(result.errors)}`);
});

test('真实登记表：11 条 fact 的权威值全部可解析（该报的 mismatch 照报，但无 authoritative_unresolvable）', () => {
  const registry = parseYaml(readFileSync('config/facts.yaml', 'utf8')) as FactsRegistry;
  const ws = realWorkspace();
  const result = lintFacts({ ...emptyRegistry, facts: registry.facts ?? [] }, ws);
  assert.equal(result.errors.filter((i) => i.code === 'authoritative_unresolvable').length, 0);
  const unresolvable = result.errors.filter((i) => i.code === 'mirror_unresolvable');
  assert.deepEqual(unresolvable, []);
});

test('verify-facts 入口脚本可执行且带出登记表与退出契约', () => {
  // 当前仓里存在真实漂移，退出码 1 是预期；这里只校验输出契约与登记表规模。
  const run = spawnSync('npx', ['tsx', 'scripts/verify/facts/verify-facts.ts'], { encoding: 'utf8' });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  // 规模数字不写死：登记表会随豁免/新契约增长，这里只校验「带出了登记表摘要」这一输出契约。
  assert.match(output, /登记表 config\/facts\.yaml：facts \d+ 条、contracts \d+ 条、coverage \d+ 条、scalars \d+ 个/);
  assert.match(output, /verify-facts: \d+ fail\(s\), \d+ warning\(s\)|verify-facts: OK \(\d+ warning\(s\)\)/);
  assert.ok(run.status === 0 || run.status === 1, `unexpected exit ${run.status}`);
});

// ─── fk 两级解析（短引反查 / 主题断言）与 overlap 的 follow 约定 ─────────────────

const fkRegistry = (extra: Record<string, unknown> = {}): FactsRegistry => ({
  ...emptyRegistry,
  contracts: [{
    id: 'c.dec_ref_resolvable',
    kind: 'fk',
    ref_pattern: '(DEC-(?:\\d{4}-\\d{2}-\\d{2}-)?\\d{3})\\b',
    ref_scope: ['config/'],
    target: 'docs/decision_log.md',
    target_pattern: '^#+\\s*(DEC-\\d{4}-\\d{2}-\\d{2}-\\d{3})\\b.*',
    ...extra,
  }],
});

test('fk：短引 DEC-nnn 按序号唯一反查到全引 → 不报 dangling，进 notes', () => {
  const ws = workspaceOf({
    'config/a.yaml': '# 见 DEC-045\n墙: x\n',
    'docs/decision_log.md': '### DEC-2026-08-26-045 主卧空调檐口定案\n正文\n',
  }, { 'contract.files': ['config/a.yaml'] });
  const result = lintFacts(fkRegistry(), ws);
  assert.equal(result.errors.filter((i) => i.code === 'dangling_reference').length, 0);
  assert.match((result.notes ?? []).join('\n'), /1 处短引按序号唯一反查/);
});

test('fk：序号反查不到才报 dangling_reference（error）', () => {
  const ws = workspaceOf({
    'config/a.yaml': '# 见 DEC-099\n',
    'docs/decision_log.md': '### DEC-2026-08-26-045 主卧空调檐口定案\n',
  }, { 'contract.files': ['config/a.yaml'] });
  const result = lintFacts(fkRegistry(), ws);
  assert.equal(result.errors.filter((i) => i.code === 'dangling_reference').length, 1);
});

test('fk：序号一对多报 reference_ambiguous 且降为 warning（人类可解析、机器不可裁决）', () => {
  const ws = workspaceOf({
    'config/a.yaml': '# 见 DEC-013\n',
    'docs/decision_log.md': '### DEC-2026-08-01-013 窗帘预算调整\n### DEC-2026-08-02-013 设计审查\n',
  }, { 'contract.files': ['config/a.yaml'] });
  const result = lintFacts(fkRegistry(), ws);
  assert.equal(result.warnings.filter((i) => i.code === 'reference_ambiguous').length, 1);
  assert.equal(result.errors.filter((i) => i.code === 'reference_ambiguous').length, 0);
  assert.match(result.warnings[0].message, /对应两条|对应多条/);
});

test('fk：subject_assertions 抓「解析成功但主题不符」——DEC-045 类错配', () => {
  const ws = workspaceOf({
    'config/a.yaml': '# 见 DEC-045\n',
    'docs/decision_log.md': '### DEC-2026-08-26-045 主卧空调檐口定案 + 条带东北角通顶储物柜\n',
  }, { 'contract.files': ['config/a.yaml'] });
  const result = lintFacts(fkRegistry({
    subject_assertions: [{ ref: 'DEC-045', expect: '主卫|悬浮板', note: '该决策从未入账' }],
  }), ws);
  const hit = result.errors.filter((i) => i.code === 'reference_subject_mismatch');
  assert.equal(hit.length, 1);
  assert.match(hit[0].message, /主卧空调檐口定案/);
  assert.match(hit[0].message, /该决策从未入账/);
});

test('fk：subject_assertions 主题相符时不报', () => {
  const ws = workspaceOf({
    'config/a.yaml': '# 见 DEC-045\n',
    'docs/decision_log.md': '### DEC-2026-08-26-045 主卫东墙四件同轴 + 悬浮板\n',
  }, { 'contract.files': ['config/a.yaml'] });
  const result = lintFacts(fkRegistry({ subject_assertions: [{ ref: 'DEC-045', expect: '主卫|悬浮板' }] }), ws);
  assert.equal(result.errors.filter((i) => i.code === 'reference_subject_mismatch').length, 0);
});

test('fk：登记表自身必须从扫描域排除，否则自引用既虚增计数又污染定位', () => {
  // 真实入口（scripts/verify/facts/verify-facts.ts）已把 config/facts.yaml 从
  // scan.files/contract.files 里过滤掉；这里证明「不过滤」的后果。
  const files = {
    'config/facts.yaml': "subject_assertions:\n  - ref: 'DEC-045'\n",
    'config/a.yaml': '# 见 DEC-045\n',
    'docs/decision_log.md': '### DEC-2026-08-26-045 主卫东墙四件同轴\n',
  };
  const datasets = { 'contract.files': ['config/facts.yaml', 'config/a.yaml'] };
  const base = fkRegistry().contracts![0];
  const scoped = lintFacts({ ...emptyRegistry, contracts: [{ ...base, ref_scope: ['config/a.yaml'] }] }, workspaceOf(files, datasets));
  assert.match((scoped.notes ?? []).join('\n'), /1 处短引/);
  const polluted = lintFacts({ ...emptyRegistry, contracts: [{ ...base, ref_scope: ['config/'] }] }, workspaceOf(files, datasets));
  assert.match((polluted.notes ?? []).join('\n'), /2 处短引/); // 1 真引用 + 1 登记表自引用
});

test('overlap：floor_region 声明 follow 即有意子区域，不计交叠且进 notes', () => {
  const registry: FactsRegistry = {
    ...emptyRegistry,
    contracts: [{ id: 'c.layout_region_room_overlap', kind: 'overlap', datasets: ['layout.floor_regions', 'layout.rooms'] }],
  };
  const sq = (x1: number, z1: number, x2: number, z2: number) => [
    { x: x1, z: z1 }, { x: x2, z: z1 }, { x: x2, z: z2 }, { x: x1, z: z2 },
  ];
  const followed = lintFacts(registry, workspaceOf({}, {
    'layout.floor_regions': [{ id: 'entry_foyer_floor', follow: 'living_dining', points: sq(0, 0, 5, 5) }],
    'layout.rooms': [{ id: 'living_dining', polygon: sq(0, 0, 10, 10) }],
  }));
  assert.equal(followed.errors.filter((i) => i.code === 'polygon_overlap').length, 0);
  assert.match((followed.notes ?? []).join('\n'), /1 个 floor_region 声明了 follow/);

  const orphan = lintFacts(registry, workspaceOf({}, {
    'layout.floor_regions': [{ id: 'corridor_floor', follow: null, points: sq(0, 0, 5, 5) }],
    'layout.rooms': [{ id: 'study', polygon: sq(0, 0, 10, 10) }],
  }));
  assert.equal(orphan.errors.filter((i) => i.code === 'polygon_overlap').length, 1);
  assert.match(orphan.errors[0].message, /corridor_floor.*study|study.*corridor_floor/);
});

test('overlap：ignore_follow=false 时恢复全量报告（逃生阀）', () => {
  const registry: FactsRegistry = {
    ...emptyRegistry,
    contracts: [{ id: 'c.o', kind: 'overlap', datasets: ['a', 'b'], ignore_follow: false }],
  };
  const sq = (x1: number, z1: number, x2: number, z2: number) => [
    { x: x1, z: z1 }, { x: x2, z: z1 }, { x: x2, z: z2 }, { x: x1, z: z2 },
  ];
  const result = lintFacts(registry, workspaceOf({}, {
    a: [{ id: 'r1', follow: 'room', points: sq(0, 0, 5, 5) }],
    b: [{ id: 'room', polygon: sq(0, 0, 10, 10) }],
  }));
  assert.equal(result.errors.filter((i) => i.code === 'polygon_overlap').length, 1);
});

// ─── 2026-10-04 新增契约层：count / pointer / type_ref / supersede / requires_when 泛化 ───

test('requires_when：when.exists 要求「声明了 X 就必须写 Y」，max_abs 限定偏移区间', () => {
  const registry: FactsRegistry = {
    ...emptyRegistry,
    contracts: [{
      id: 'c.light_height_parity', kind: 'requires_when',
      path: 'config/render/overrides.yaml',
      when: { field: 'anchorY_offset', exists: true },
      then: ['basis'], max_abs: 0.5,
    }],
  };
  const ok = lintFacts(registry, workspaceOf({
    'config/render/overrides.yaml': '- id: a\n  anchorY_offset: -0.25\n  basis: "灯罩厚度"\n',
  }));
  assert.equal(ok.errors.length, 0);

  const noBasis = lintFacts(registry, workspaceOf({
    'config/render/overrides.yaml': '- id: a\n  anchorY_offset: -0.25\n',
  }));
  assert.equal(noBasis.errors.filter((i) => i.code === 'required_field_missing').length, 1);

  const tooFar = lintFacts(registry, workspaceOf({
    'config/render/overrides.yaml': '- id: a\n  anchorY_offset: -0.9\n  basis: "离谱"\n',
  }));
  assert.equal(tooFar.errors.filter((i) => i.code === 'required_field_out_of_range').length, 1);
});

test('requires_when：when.pattern 匹配同义状态词，min_matches 把「契约空转」变成 error', () => {
  const registry: FactsRegistry = {
    ...emptyRegistry,
    contracts: [{
      id: 'c.lock', kind: 'requires_when', path: 'schedule/phase-1/control.yaml',
      when: { field: 'status', pattern: 'locked$' },
      then: ['locked_cny', 'contract_ref', 'evidence_path'],
      min_matches: 1,
    }],
  };
  // 同义状态词也命中：budget_pool_locked 匹配 /locked$/，纳入检查且三证齐全才放行
  const synonymMissingEvidence = lintFacts(registry, workspaceOf({
    'schedule/phase-1/control.yaml': 'records:\n  - id: r1\n    status: budget_pool_locked\n',
  }));
  // 每个命中对象报一条 issue，缺的字段在消息里列全
  assert.equal(synonymMissingEvidence.errors.filter((i) => i.code === 'required_field_missing').length, 1);
  assert.match(synonymMissingEvidence.errors[0].message, /locked_cny、contract_ref、evidence_path/);

  // 契约空转：状态词被改成不含 locked 的同义词，命中数掉到 0 → 本身即 error
  const armed = lintFacts(registry, workspaceOf({
    'schedule/phase-1/control.yaml': 'records:\n  - id: r1\n    status: budget_pool_confirmed_quote_pending\n',
  }));
  assert.equal(armed.errors.filter((i) => i.code === 'required_condition_unmatched').length, 1);
  assert.match(armed.errors[0].message, /min_matches=1/);

  const matched = lintFacts(registry, workspaceOf({
    'schedule/phase-1/control.yaml': 'records:\n  - id: r1\n    status: locked\n    locked_cny: 1\n    contract_ref: c\n    evidence_path: e\n',
  }));
  assert.equal(matched.errors.length, 0);
});

test('count：机器条目数 vs prose 声明计数，distinct 按去重条目计', () => {
  const registry: FactsRegistry = {
    ...emptyRegistry,
    contracts: [{
      id: 'c.items', kind: 'count', source: 'config/acceptance.yaml', items_path: 'phases', count_field: 'items',
      prose: [{ path: 'schedule/phase-1/checklist.md', extract: '^\\| \\[ \\] \\| (check_[a-z_0-9]+)', expect_matches: 3, distinct: true }],
    }],
  };
  const ok = lintFacts(registry, workspaceOf({
    'config/acceptance.yaml': 'phases:\n  - id: p1\n    items: [{id: a}, {id: b}]\n  - id: p2\n    items: [{id: c}]\n',
    // 同一验收项被两个工作包引用 → 行数 4、去重后 3
    'schedule/phase-1/checklist.md': '| [ ] | check_a |\n| [ ] | check_a |\n| [ ] | check_b |\n| [ ] | check_c |\n',
  }));
  assert.equal(ok.errors.length, 0);

  const drift = lintFacts(registry, workspaceOf({
    'config/acceptance.yaml': 'phases:\n  - id: p1\n    items: [{id: a}, {id: b}, {id: c}, {id: d}]\n',
    'schedule/phase-1/checklist.md': '| [ ] | check_a |\n| [ ] | check_b |\n| [ ] | check_c |\n',
  }));
  assert.equal(drift.errors.filter((i) => i.code === 'count_mismatch').length, 1);
  assert.match(drift.errors[0].message, /实际 4 条/);
});

test('pointer：prose 引用的仓库内路径必须真实存在，allow 必须写 reason', () => {
  const registry: FactsRegistry = {
    ...emptyRegistry,
    contracts: [{
      id: 'c.paths', kind: 'pointer', ref_scope: ['README.md'],
      path_pattern: '((?:config|docs|schedule)/[A-Za-z0-9_\\-./]+\\.(?:yaml|md))',
      allow: [{ path: 'docs/archive.md', reason: '外部 skill 产出，未随仓库提交' }],
    }],
  };
  const datasets = { 'contract.files': ['README.md'] };
  const ok = lintFacts(registry, workspaceOf({
    'README.md': '见 `config/electrical.yaml` 与 `docs/archive.md`\n',
    'config/electrical.yaml': 'id: a\n',
  }, datasets));
  assert.equal(ok.errors.length, 0);

  const dangling = lintFacts(registry, workspaceOf({
    'README.md': '见 `config/electrical.yaml` 与 `config/does-not-exist.yaml`\n',
    'config/electrical.yaml': 'id: a\n',
  }, datasets));
  assert.equal(dangling.errors.filter((i) => i.code === 'pointer_dangling').length, 1);

  const noReason = lintFacts({
    ...emptyRegistry,
    contracts: [{ id: 'c.paths', kind: 'pointer', ref_scope: ['README.md'], path_pattern: '(config/[a-z]+\\.yaml)', allow: [{ path: 'config/x.yaml' }] }],
  }, workspaceOf({ 'README.md': 'x\n' }, datasets));
  assert.equal(noReason.errors.filter((i) => i.code === 'pointer_allow_without_reason').length, 1);
});

test('type_ref：规则引用的家具 type 必须存在于 house.yaml furnishings', () => {
  const registry: FactsRegistry = {
    ...emptyRegistry,
    contracts: [{
      id: 'c.types', kind: 'type_ref', sources: ['config/verify-rules.yaml'],
      under: ['match', 'furniture_types'], target: 'config/house.yaml', target_path: 'furnishings', key_field: 'type',
    }],
  };
  const ok = lintFacts(registry, workspaceOf({
    'config/verify-rules.yaml': 'proximity:\n  - id: r1\n    b: { match: { type: tv_stand } }\n    furniture_types: [wardrobe_240]\n',
    'config/house.yaml': 'furnishings:\n  master_bedroom:\n    - { type: tv_stand }\n    - { type: wardrobe_240 }\n',
  }));
  assert.equal(ok.errors.length, 0);

  const drift = lintFacts(registry, workspaceOf({
    'config/verify-rules.yaml': 'proximity:\n  - id: r1\n    b: { match: { type: tv_stand_renamed } }\n',
    'config/house.yaml': 'furnishings:\n  master_bedroom:\n    - { type: tv_stand }\n',
  }));
  assert.equal(drift.errors.filter((i) => i.code === 'type_ref_absent').length, 1);
});

test('supersede：作废字段必须自证退场，且被指名的现行权威必须存在并带活字段', () => {
  const contract = {
    id: 'c.sup', kind: 'supersede' as const, source: 'config/budget/base.json',
    fields: ['total_budget', 'project_ceiling'],
    superseded_by: 'schedule/phase-1/control.yaml', live_field: 'control.phase_ceiling_cny',
    must_declare: ['status', 'superseded_by', 'note'],
  };
  const registry: FactsRegistry = { ...emptyRegistry, contracts: [contract] };
  const ok = lintFacts(registry, workspaceOf({
    'config/budget/base.json': JSON.stringify({
      status: 'superseded', superseded_by: 'schedule/phase-1/control.yaml', note: 'x',
      total_budget: 208000, project_ceiling: 190000,
    }),
    'schedule/phase-1/control.yaml': 'control:\n  phase_ceiling_cny: 206000\n',
  }));
  assert.equal(ok.errors.length, 0);

  const reactivated = lintFacts(registry, workspaceOf({
    'config/budget/base.json': JSON.stringify({ total_budget: 208000, project_ceiling: 190000 }),
    'schedule/phase-1/control.yaml': 'control:\n  phase_ceiling_cny: 206000\n',
  }));
  assert.equal(reactivated.errors.filter((i) => i.code === 'supersede_undeclared').length, 3);

  const wrongAuthority = lintFacts(registry, workspaceOf({
    'config/budget/base.json': JSON.stringify({
      status: 'superseded', superseded_by: 'config/other.yaml', note: 'x',
      total_budget: 1, project_ceiling: 2,
    }),
    'schedule/phase-1/control.yaml': 'control:\n  phase_ceiling_cny: 206000\n',
  }));
  assert.equal(wrongAuthority.errors.filter((i) => i.code === 'supersede_authority_mismatch').length, 1);
});

test('带 pending 的豁免与契约在 INFO 里露面，不退化成静默待办', () => {
  const registry: FactsRegistry = {
    ...emptyRegistry,
    facts: [{
      id: 'fact.x', kind: 'derived', value: '@config/a.yaml:n',
      exempt: [{ path: 'docs/b.md', pattern: 'zzz', reason: '对交际待裁决', pending: '业主改口径' }],
    }],
    contracts: [{ id: 'c.armed', kind: 'requires_when', path: 'config/a.yaml', when: { field: 'status', equals: 'x' }, then: ['y'], min_matches: 0, pending: '词汇表未启用' }],
  };
  const notes = (lintFacts(registry, workspaceOf({ 'config/a.yaml': 'n: 1\n' })).notes ?? []).join('\n');
  assert.match(notes, /fact\.x 豁免待决/);
  assert.match(notes, /业主改口径/);
  assert.match(notes, /contract c\.armed 待决/);
});
