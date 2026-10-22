/**
 * CURRENT-VALUES.md 的渲染器（文档精简批 4，2026-10-22）。
 *
 * 本表原为手抄转抄层，靠维护纪律人工同步，是典型的「第二份真相」漂移源。
 * 批 4 将其改为生成视图（与 schedule 生成视图同构）：
 *   - 能从权威源机械取值的行（计数、金额、标高、面积、型号串）由本渲染器
 *     现场从 config / 台账文件抽取，改源即变；
 *   - 只能编辑判断的行（选型串、口径注脚）保留字面文本，但其权威源文件
 *     全部纳入输入指纹——源一变，指纹即不符，verify:current-values 报红，
 *     迫使逐行复核后重跑生成，不再静默过期。
 * 生成：npm run docs:generate-current-values；校验：verify:current-values
 * （已挂 verify:all）。禁止手改 docs/CURRENT-VALUES.md。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { load as loadYaml } from 'js-yaml';

const ROOT = path.resolve(import.meta.dirname, '../..');

export const CV_INPUTS = [
  'config/ceiling.yaml',
  'config/electrical-topology.yaml',
  'config/electrical.yaml',
  'config/house.yaml',
  'config/hvac.yaml',
  'config/layout/model-geometry.yaml',
  'config/materials.yaml',
  'config/mep-hvac-coordination.yaml',
  'config/tile-comparison.yaml',
  'docs/mep-construction-guidance.md',
  'docs/pending-site-data.md',
  'schedule/phase-1/control.yaml',
  'shared/masonry-takeoff.ts',
];

export function inputsFingerprint(): string {
  const h = crypto.createHash('sha256');
  for (const rel of CV_INPUTS) {
    h.update(rel);
    h.update('\0');
    h.update(fs.readFileSync(path.join(ROOT, rel)));
    h.update('\0');
  }
  return h.digest('hex');
}

function yaml(rel: string): any {
  return loadYaml(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}
const fmt = (n: number): string => String(parseFloat(n.toFixed(3)));
const fmt2 = (n: number): string => n.toFixed(2);

interface Ctx {
  control: any;
  hvac: any;
  topology: any;
  electrical: any[];
  house: any;
  ceiling: any[];
  mep: any;
  geometry: any;
  pendingText: string;
}

function loadCtx(): Ctx {
  return {
    control: yaml('schedule/phase-1/control.yaml'),
    hvac: yaml('config/hvac.yaml'),
    topology: yaml('config/electrical-topology.yaml'),
    electrical: yaml('config/electrical.yaml'),
    house: yaml('config/house.yaml'),
    ceiling: yaml('config/ceiling.yaml'),
    mep: yaml('config/mep-hvac-coordination.yaml'),
    geometry: yaml('config/layout/model-geometry.yaml'),
    pendingText: fs.readFileSync(path.join(ROOT, 'docs/pending-site-data.md'), 'utf8'),
  };
}

interface Row {
  label: string;
  value: (c: Ctx) => string;
  source: string;
  note: string | ((c: Ctx) => string);
}
interface Section {
  title: string;
  rows: Row[];
}

const plan = (c: Ctx): any => c.hvac.plans.find((p: any) => p.id === 'A2');

const SECTIONS: Section[] = [
  {
    title: '预算与阶段',
    rows: [
      {
        label: '一期执行上限',
        value: (c) => `${c.control.control.phase_ceiling_cny} 元`,
        source: 'schedule/phase-1/control.yaml:17,56',
        note: '已分配额同值、未分配 0；历史基线 208000/190000 已作废 ※',
      },
      {
        label: '一期预算池',
        value: (c) => {
          const pools = c.control.budget_pools as Array<{ name: string; planned_cny: number }>;
          const sum = pools.reduce((a, p) => a + p.planned_cny, 0);
          if (sum !== c.control.control.phase_ceiling_cny) {
            throw new Error(`预算池合计 ${sum} ≠ 执行上限 ${c.control.control.phase_ceiling_cny}`);
          }
          return `${pools.length} 池：${pools.map((p) => `${p.name} ${p.planned_cny}`).join(' / ')}`;
        },
        source: 'schedule/phase-1/control.yaml:34-52',
        note: '六池合计 = 执行上限；家电 16000 含 GC5 追加 4000',
      },
      {
        label: '暖通执行池',
        value: (c) => {
          const pool = (c.control.budget_pools as any[]).find((p) => p.id === 'hvac');
          return `${pool.planned_cny} 元`;
        },
        source: 'schedule/phase-1/control.yaml:40',
        note: '与合同成交价同额；原 33000 询价口径作废',
      },
      {
        label: '全硬装询价轮次目标',
        value: (c) => {
          const s = c.control.hard_finish_quote_rounds.round_summary;
          return `all_in ${s.all_in_target_cny} 元（核心 ${s.core_hard_finish_target_cny} + 柜体 ${s.extended_cabinet_target_cny}）`;
        },
        source: 'schedule/phase-1/control.yaml:203-207',
        note: '业主提供的预算池/封顶/候选价，**不是合同承诺**',
      },
      {
        label: '墙砖面积（wall_region 实算）',
        value: () => '21.2555 ㎡',
        source: 'shared/masonry-takeoff.ts；tests/server/masonry-takeoff.test.ts:160-168',
        note: '窗台/防水台 sill_region 另计 15.468 ㎡；合计 36.7236 ㎡由契约 c.masonry_tile_area_parity 三方对账 ※',
      },
    ],
  },
  {
    title: '暖通',
    rows: [
      {
        label: '外机（成交配置）',
        value: (c) => {
          const p = plan(c);
          const model = (p.outdoor.model as string).match(/MJV-[A-Z0-9-]+/)?.[0];
          const kw = p.load_design.outdoor_nominal_kw;
          return `美的领航者Ⅳ ${model}，${fmt(kw)}kW / 大7匹 / 220V`;
        },
        source: 'config/hvac.yaml:23-32',
        note: '成交配置 DEC-2026-10-04-R1；区别于三代 MJV-200W-E01-LHⅢ',
      },
      {
        label: '内机额定合计',
        value: (c) => `${fmt(plan(c).load_design.indoor_nominal_kw_total)}kW`,
        source: 'config/hvac.yaml:37',
        note: '六台双出风 /P-SS 全带泵；由 tests/server/vrf-config.test.ts 强制 ※',
      },
      {
        label: '连接率',
        value: (c) => {
          const ld = plan(c).load_design;
          const r = ld.indoor_nominal_kw_total / ld.outdoor_nominal_kw;
          return `${r.toFixed(3)}（约 ${r.toFixed(2)}）`;
        },
        source: 'config/hvac.yaml:39',
        note: '25.3÷20.0；行业上限 1.30；同由 vrf-config.test.ts 断言',
      },
      {
        label: '合同成交价',
        value: (c) => `${plan(c).commercial.price_cny} 元`,
        source: 'config/hvac.yaml:12,18',
        note: '含辅材；**不含**复合风管与风口加长（加长 100 元/米另计）、不含税 ※',
      },
      {
        label: '逐房内机映射',
        value: (c) => {
          // 字面串是编辑口径（小房三间同型号合并表述）；此处断言六台型号
          // 与字面串一致，型号一改即生成失败，防止映射表静默过期。
          const rooms = plan(c).load_design.rooms as Array<{ indoor: string }>;
          const tokens = rooms
            .map((r) => (r.indoor.match(/MJV-[0-9A-Z/-]+/)?.[0] ?? ''))
            .sort()
            .join(',');
          const expected = [
            'MJV-28T2/P-SS',
            'MJV-28T2/P-SS',
            'MJV-28T2/P-SS',
            'MJV-42T2/P-SS',
            'MJV-56T2/P-SS',
            'MJV-71T2/P-SS',
          ].join(',');
          if (tokens !== expected) throw new Error(`内机型号集合漂移：${tokens}`);
          return '客厅 MJV-71T2/P-SS 7.1kW；餐厅 MJV-42T2/P-SS 4.2kW；主卧 MJV-56T2/P-SS 5.6kW；书房/儿童房/客房各 MJV-28T2/P-SS 2.8kW';
        },
        source: 'config/hvac.yaml:42-72',
        note: '2026-10-05 业主确认；机位/风口/吊顶净空仍待量房与厂家深化',
      },
      {
        label: '西设备平台',
        value: (c) => {
          const verts = new Map((c.geometry.vertices as any[]).map((v) => [v.id, v]));
          const pts = (c.geometry.platform.boundary as string[]).map((id) => verts.get(id));
          const xs = pts.map((p: any) => p.x);
          const zs = pts.map((p: any) => p.z);
          const sx = Math.max(...xs) - Math.min(...xs);
          const sz = Math.max(...zs) - Math.min(...zs);
          return `${fmt(sx)}×${fmt2(sz)} m（bbox ${(sx * sz).toFixed(2)} ㎡）`;
        },
        source: 'config/hvac.yaml:33',
        note: '含 r=1.0 西北圆角后「可用约 1.39 ㎡」是**估算**，权威 bbox 见 fact.west_platform_area ※',
      },
      {
        label: '外机外廓',
        value: (c) => {
          const o = plan(c).outdoor;
          return `${fmt2(o.width)}×${fmt2(o.depth)}×${fmt2(o.height)} m`;
        },
        source: 'config/hvac.yaml:29-31',
        note: '**estimated**；200W 级实测尺寸与平台散热核算 site_pending（pending-site-data.md #39）',
      },
    ],
  },
  {
    title: '电气',
    rows: [
      {
        label: '回路总数',
        value: (c) => `${(c.topology.circuits as any[]).length} 路`,
        source: 'config/electrical-topology.yaml:5',
        note: 'circuits.length=20；DEC-2026-10-13-R5 删电视墙灯带整条照明回路后回到 20；fact.circuit_count 对账 ※',
      },
      {
        label: '空调内机回路',
        value: (c) => {
          const ids = (c.topology.circuits as any[])
            .map((x) => x.id as string)
            .filter((id) => id.startsWith('hvac_power_') && !id.includes('outdoor'));
          return `${ids.length} 路：${ids.join(' + ')}`;
        },
        source: 'config/electrical-topology.yaml:71,82',
        note: '6 台内机暂并口径；厂家正式配电图确认前不冻结供电分组',
      },
      {
        label: '空调外机回路',
        value: (c) => {
          const ids = (c.topology.circuits as any[])
            .map((x) => x.id as string)
            .filter((id) => id.includes('hvac_power_outdoor'));
          return `${ids.length} 路 ${ids.join(' + ')}`;
        },
        source: 'config/electrical-topology.yaml:94',
        note: 'GB 55038 7.4.4 单独成路；C32A+漏保 / 4.0mm²(φ20) proposed，输入估 ≈6kW',
      },
      {
        label: '电气点位数',
        value: (c) => `${c.electrical.length} 个`,
        source: 'config/electrical-topology.yaml:15',
        note: '即 config/electrical.yaml 条目数；点位增删必须同步此数与 fact.electrical_points_count ※',
      },
      {
        label: '强电箱',
        value: (c) => {
          const p = (c.electrical as any[]).find((x) => x.id === 'panel_strong_entry_left');
          const mm = (n: number) => Math.round(n * 1000);
          return `底边离地 ${fmt(p.mount_height)}m；箱体 ${mm(p.width)}×${mm(p.body_height)}×${mm(p.depth)}mm`;
        },
        source: 'config/electrical.yaml:702-705',
        note: '20 路 + 2P 进线 + 浪涌需**双排**；单/双排与进线截面待复测（pending-site-data.md #30）',
      },
    ],
  },
  {
    title: '几何与标高',
    rows: [
      {
        label: '结构层高/室内净高',
        value: (c) => `${fmt2(c.house.project.floor_height)} m`,
        source: 'config/house.yaml:7；docs/mep-construction-guidance.md:76',
        note: '邻户结构板 +2830 佐证；fact.floor_height_net 由 house.yaml 派生 ※',
      },
      {
        label: 'A 区吊顶完成面',
        value: (c) => {
          const z = (c.ceiling as any[]).find((x) => x.id === 'ceiling_living');
          return `${fmt2(c.house.project.floor_height - z.thickness)} m`;
        },
        source: 'config/mep-hvac-coordination.yaml:7',
        note: '0.30m 降板（2.80−0.30）；完成面权威为 config/ceiling.yaml（guidance:141 明文）',
      },
      {
        label: 'B 区铝扣板完成面',
        value: (c) => {
          const z = (c.ceiling as any[]).find((x) => x.id === 'ceiling_kitchen');
          return `${fmt2(c.house.project.floor_height - z.thickness)} m`;
        },
        source: 'config/mep-hvac-coordination.yaml:12',
        note: '0.15m 板厚；厨房/主卫/客卫三区，空腔仅 150mm',
      },
      {
        label: '客餐厅面积',
        value: (c) => {
          const room = (c.house.rooms as any[]).find((r) => r.id === 'living_dining');
          return `${fmt2(room.area)} ㎡`;
        },
        source: 'config/house.yaml:178；config/hvac.yaml:36',
        note: 'polygon 实测；bbox 45.88 ㎡含 1.3㎡ 凹口 ※',
      },
      {
        label: '套内面积',
        value: (c) => `${fmt2(c.house.project.usable_area)} ㎡`,
        source: 'config/house.yaml:6',
        note: '合同净口径；与毛口径/赠送/建面三口径未闭合见 pending-site-data.md #40 ※',
      },
      {
        label: 'MEP 路线总数',
        value: (c) => `${(c.mep.routes as any[]).length} 条`,
        source: 'config/mep-hvac-coordination.yaml:4',
        note: '走线表 routes 条目数；fact.mep_routes_count ※',
      },
    ],
  },
  {
    title: '材料选型',
    rows: [
      {
        label: '地砖选型基准',
        value: () => 'KT 200×1200 木纹长条砖，29 元/片',
        source: 'config/materials.yaml:748-769；config/tile-comparison.yaml:163-166',
        note: '2026-10-12 业主定的**可推翻工作基准**（非终选）；手写报价 516 片=14964 元；箱规 unknown 前不能下单',
      },
      {
        label: '燃气热水器',
        value: () => '海尔 KL7PRO（静音王，16L 水伺服+增压）',
        source: 'schedule/phase-1/control.yaml:71,181-186',
        note: 'DEC-2026-10-05-R5 定方向；BLK-WATER-HEATER-SITE 未解且一手核价前不下单',
      },
      {
        label: '微蒸烤一体机',
        value: () => '美的 GC5（TR850E-TSBC00，55L，3200W）',
        source: 'schedule/phase-1/control.yaml:191-193',
        note: 'DEC-2026-10-05-R4 定标方向；需 16A 专用回路，激活时同步 fact.circuit_count',
      },
      {
        label: '智能马桶',
        value: () => '九牧 ZQ6650 ×2，封顶 5598 元',
        source: 'schedule/phase-1/control.yaml:395-402',
        note: '封顶价不是成交价；坑距 305/400 待核（pending-site-data.md #31）',
      },
    ],
  },
  {
    title: '待决',
    rows: [
      {
        label: '待决台账条数',
        value: (c) => {
          const numbered = (c.pendingText.match(/^\| \d+ \|/gm) ?? []).length;
          const sub = (c.pendingText.match(/^\| \d+[a-z] \|/gm) ?? []).length;
          return `${numbered} 条编号`;
        },
        source: 'docs/pending-site-data.md:3',
        note: (c) => {
          const numbered = (c.pendingText.match(/^\| \d+ \|/gm) ?? []).length;
          const sub = (c.pendingText.match(/^\| (\d+[a-z]) \|/gm) ?? []).length;
          const subNames = [...c.pendingText.matchAll(/^\| (\d+[a-z]) \|/gm)].map((m) => `#${m[1]}`);
          return `#1–#${numbered}${sub ? ` + ${subNames.join('、')} 子项` : ''} = ${numbered + sub} 行；fact.pending_site_data_count 锚在表头，新增/关闭必须同步编号数 ※`;
        },
      },
      {
        label: '#30 强电箱规格',
        value: () => 'pending（单/双排、回路数、进线截面）',
        source: 'docs/pending-site-data.md:105',
        note: '20 路 + 2P + 浪涌需双排；1.65m 底边仅在双排时合规',
      },
      {
        label: '#39 暖通待验证项',
        value: () => 'pending（外机实测尺寸/平台散热/厂家配电图/风口加长计价/冷负荷计算书）',
        source: 'docs/pending-site-data.md:115',
        note: '已成交 36000，但上述项闭环前不冻结施工',
      },
    ],
  },
];

export function renderCurrentValues(): string {
  const c = loadCtx();
  const fp = inputsFingerprint();
  const out: string[] = [];
  out.push('# 现行值速查表（CURRENT-VALUES）');
  out.push('');
  out.push(
    `<!-- 生成物，禁止手改：由 scripts/docs/current-values-render.ts 从权威源渲染（文档精简批 4）。`,
  );
  out.push(`     重跑：npm run docs:generate-current-values；校验：npm run verify:all -- --only verify-current-values`);
  out.push(`     inputs-fingerprint: sha256:${fp} -->`);
  out.push('');
  out.push(
    '> **本表是什么**：一张回答「现在的准数是什么」的表。服务两类读者——AI（grep 到冲突值时第一步查这里，判断哪条现行）和人（不用翻 5 份文档）。',
  );
  out.push('>');
  out.push(
    '> **权威声明**：本表是速查汇总，**权威仍在各 config / docs 原文**。本表与权威冲突时，**以权威为准，并立即修订本表**（连同「权威源」列里的 `file:line`）。本表不创设事实，只转抄；任何情况下不得为了让本表好看而反向改权威源。',
  );
  out.push('>');
  out.push('> **读法**：');
  out.push(
    '> - 「现行值」列是当前生效口径；带 `pending` / `estimated` / `候选` / `封顶` 字样的是未冻结项，引用时必须连同状态一起引。',
  );
  out.push('> - 「权威源」列为 `file:line`，可逐处跳转核对。');
  out.push(
    '> - 「备注」列写口径边界（含/不含、估算/实测、封顶/成交）。**引用本表必须连同边界一起引**，只引数字会丢口径。',
  );
  out.push(
    '> - 标 ※ 的口径已由 `config/facts.yaml` 的 fact / 契约或 `tests/server/` 断言做机器对账；改这些数会先被门禁拦住，改完必须同步本表。',
  );
  out.push(
    '> - **生成口径（批 4 起）**：可机械取值的行由渲染器从权威源现取；编辑判断行保留字面，但其全部权威源已纳入文件头指纹——源文件一变，`verify:current-values` 即报红，须逐行复核后重跑生成。',
  );
  for (const section of SECTIONS) {
    out.push('');
    out.push(`## ${section.title}`);
    out.push('');
    out.push('| 口径 | 现行值 | 权威源（file:line） | 备注 |');
    out.push('|---|---|---|---|');
    for (const row of section.rows) {
      const note = typeof row.note === 'function' ? row.note(c) : row.note;
      out.push(`| ${row.label} | ${row.value(c)} | ${row.source} | ${note} |`);
    }
  }
  out.push('');
  out.push('---');
  out.push('');
  out.push('## 维护纪律');
  out.push('');
  out.push(
    '1. **新增口径**：先定位权威源（config 优先，docs 次之），在本表登记一行并写全 `file:line`；同时确认该数已被 `verify:facts` 的 fact / 契约或 `tests/server/` 覆盖。未被覆盖的高频数，按 `config/facts.yaml` 头部维护铁律补 mirror（必须写 `extract` + `expect_matches`，命中数不符即失败，不许静默跳过）。',
  );
  out.push(
    '2. **改数顺序**：改权威源 → 跑 `npm run verify:facts` 与 `npm run test:server` → 重跑 `npm run docs:generate-current-values` 同步本表。本表与权威冲突时，以权威为准并立即修本表；**不许反向改权威来迁就本表**。',
  );
  out.push(
    '3. **引用方纪律**：任何文档引用本表发现冲突，以权威源为准，并回来修本表；不得把本表当作第二权威，也不得因「本表已登记」就跳过权威源核对。',
  );
  out.push(
    '4. **汇总视图身份**：本表已按汇总视图整文件登记进 `config/facts.yaml` 的 `scan.exempt_occurrences`（数值均为已登记权威值的转抄），关键行另由 fact mirror 逐条对账。该豁免只免 T1 发现层的重复报警，**不免权威源侧的对账**；不得以本表已豁免为由在权威源里放松登记。',
  );
  out.push(
    '5. **生成纪律（批 4 起）**：本表禁止手改。新增/修改行请改 `scripts/docs/current-values-render.ts` 的行规约（取值器或字面行）后重跑生成；`verify:current-values` 以「渲染结果与文件逐字节一致」为契约，源文件变动而本表未复核重生成时必然报红。',
  );
  out.push('');
  return out.join('\n');
}
