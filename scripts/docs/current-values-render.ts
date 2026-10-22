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
import { resolveLayout } from '../../server/layout-resolver.js';
import { computeMasonryTakeoff, type MasonryTakeoffInput } from '../../shared/masonry-takeoff.js';

const ROOT = path.resolve(import.meta.dirname, '../..');

export const CV_INPUTS = [
  'config/ceiling.yaml',
  'config/electrical-topology.yaml',
  'config/electrical.yaml',
  'config/house.yaml',
  'config/hvac.yaml',
  'config/layout/model-geometry.yaml',
  'config/layout/overlay.yaml',
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
const round4 = (n: number): string => String(parseFloat(n.toFixed(4)));
const round3 = (n: number): string => String(parseFloat(n.toFixed(3)));

function masonryAreas(): { wall: number; sill: number } {
  // 与 tests/server/masonry-takeoff.test.ts 的 buildInput 同口径装配（config → 模块输入），
  // 面积一律由 shared/masonry-takeoff 从 overlay 声明实算，禁止硬编码（批 4 审阅修复）。
  const mg = yaml('config/layout/model-geometry.yaml');
  const ov = yaml('config/layout/overlay.yaml');
  const tile = yaml('config/tile-comparison.yaml');
  const layout = resolveLayout(mg) as any;
  const suppressed = new Set<string>();
  for (const entry of ov.suppress ?? []) {
    for (const key of ['wall', 'walls'] as const) {
      const v = (entry as any)[key];
      if (!v) continue;
      for (const w of Array.isArray(v) ? v : [v]) suppressed.add(String(w));
    }
  }
  const walls = (layout.walls as any[]).map((wall) => ({
    id: wall.id, x1: wall.x1, z1: wall.z1, x2: wall.x2, z2: wall.z2,
    ...(wall.segments?.length ? { segments: wall.segments.map((sg: any) => ({ x1: sg.x1, z1: sg.z1, x2: sg.x2, z2: sg.z2 })) } : {}),
    ...(wall.openings?.length ? { openings: wall.openings } : {}),
    suppressed: suppressed.has(wall.id),
  }));
  const wallById = new Map(walls.map((w) => [w.id, w]));
  if (!Array.isArray(ov.elements) || ov.elements.length === 0) {
    throw new Error('overlay.yaml 缺少 elements 声明：拒绝静默生成 0 ㎡（字段改名/缺失必须报红）');
  }
  const elements: any[] = ov.elements;
  const baySills = elements.filter((e) => e.type === 'bay_sill').map((e) => {
    const wallIds: string[] = e.walls ?? (e.wall ? [e.wall] : []);
    const wall: any = wallById.get(wallIds[0]);
    return { id: e.id, wall: wallIds[0], height: e.height, depth: e.depth, sill: e.sill ?? 0,
      ...(wall?.segments ? { segments: wall.segments } : {}) };
  });
  const rooms = (layout.rooms as any[]).filter((r) => !r.semantic_only).map((r) => ({
    id: r.id, areaSqm: r.area ?? r.width * r.depth,
    ...((r.points ?? []).length ? { points: r.points.map((p: any) => ({ x: p.x, z: p.z })) }
      : { rect: { x: r.x, z: r.z, width: r.width, depth: r.depth } }),
  }));
  const input: MasonryTakeoffInput = {
    walls, baySills, rooms,
    wallRegions: elements.filter((e) => e.type === 'wall_region').map((e) => ({
      id: e.id, wall: e.wall, room: e.room, along: e.along, bottom: e.bottom ?? 0, height: e.height, zone: e.zone })),
    sillRegions: elements.filter((e) => e.type === 'sill_region').map((e) => ({
      id: e.id, element: e.element, room: e.room, face: e.face, along: e.along, zone: e.zone })),
    dryRoomIds: tile.dry_room_ids, wetRoomIds: tile.wet_room_ids,
    floorRegions: elements.filter((e) => e.type === 'floor_region').map((e) => ({
      id: e.id,
      areaSqm: Math.abs((e.points ?? []).reduce((sum: number, p: any, i: number, all: any[]) => {
        const n = all[(i + 1) % all.length]; return sum + p.x * n.z - n.x * p.z; }, 0) / 2),
      points: (e.points ?? []).map((p: any) => ({ x: p.x, z: p.z })),
      excluded: e.excluded === true, follow: e.follow, room: e.room, zone: e.zone })),
    clearHeight: (() => {
      // 与 server/budget-calculator.ts 同口径：厨卫铝扣板完成面（floor_height − thickness），
      // 取三区最大值；配置派生，禁止硬编码（二审修复：原误写 2.8 > takeoff 上限 2.65 而不自知）。
      const floorH = yaml('config/house.yaml').project.floor_height as number;
      const zones = yaml('config/ceiling.yaml') as any[];
      const finishes = ['ceiling_kitchen', 'ceiling_master_bath', 'ceiling_guest_bath'].map((id) => {
        const z = zones.find((x) => x.id === id);
        if (!z) throw new Error(`ceiling.yaml 缺少 ${id} 区，无法派生贴砖净高上限`);
        return floorH - (z.thickness as number);
      });
      return Math.max(...finishes);
    })(),
  } as MasonryTakeoffInput;
  const result = computeMasonryTakeoff(input);
  return { wall: result.wallTileSqm, sill: result.sillTileSqm };
}

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
          if (!pool) throw new Error('budget_pools 缺 hvac 池');
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
        value: () => `${round4(masonryAreas().wall)} ㎡`,
        source: 'config/layout/overlay.yaml（wall/sill_region 声明）+ config/layout/model-geometry.yaml（几何）+ config/tile-comparison.yaml（干湿分区）+ config/ceiling.yaml（净高上限）→ shared/masonry-takeoff.ts 实算；tests/server/masonry-takeoff.test.ts:160-168',
        note: () => {
          const a = masonryAreas();
          return `窗台/防水台 sill_region 另计 ${round3(a.sill)} ㎡；合计 ${round4(a.wall + a.sill)} ㎡由契约 c.masonry_tile_area_parity 三方对账 ※`;
        },
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
          if (!model) throw new Error('外机型号串解析失败：hvac.yaml outdoor.model 格式已变');
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
          // 按房间逐条派生（批 4 审阅修复）：型号/容量从各房 indoor 串解析，
          // 房间标签由 ac 锚点映射，互换任一房间型号都会改变输出。
          // 房间标签由 indoor 串内的 ac_* 锚点决定（三审修复：不依赖数组顺序——
          // 两条 living_dining 仅靠顺序区分会把 71T2/42T2 静默标错房间），
          // 并校验锚点与结构化 rooms[].room 一致，不一致即抛错。
          const ANCHORS: Record<string, { room: string; label: string }> = {
            ac_living: { room: 'living_dining', label: '客厅' },
            ac_dining: { room: 'living_dining', label: '餐厅' },
            ac_master: { room: 'master_bedroom', label: '主卧' },
            ac_parent: { room: 'study', label: '书房' },
            ac_child: { room: 'bedroom_nw', label: '儿童房' },
            ac_study: { room: 'bedroom_se', label: '客房' },
          };
          const labelOf = (r: { room: string; indoor: string }): string => {
            const ac = r.indoor.match(/ac_\w+/)?.[0];
            if (!ac || !ANCHORS[ac]) throw new Error(`逐房映射：indoor 缺 ac_* 锚点：${r.indoor.slice(0, 60)}`);
            const expected = ANCHORS[ac];
            if (r.room !== expected.room) {
              throw new Error(`逐房映射锚点与房间不一致：${ac} 应属 ${expected.room}，实际登记 ${r.room}`);
            }
            return expected.label;
          };
          const rooms = plan(c).load_design.rooms as Array<{ room: string; indoor: string }>;
          const parsed = rooms.map((r) => {
            const model = r.indoor.match(/MJV-[0-9A-Z/-]+/)?.[0];
            const kw = r.indoor.match(/(\d+\.\d+)kW/)?.[1];
            if (!model || !kw) throw new Error(`逐房映射解析失败：${r.indoor.slice(0, 60)}`);
            return { label: labelOf(r), model, kw };
          });
          const head = parsed.slice(0, 3).map((p) => `${p.label} ${p.model} ${p.kw}kW`);
          const tail = parsed.slice(3);
          const same = tail.every((p) => p.model === tail[0].model && p.kw === tail[0].kw);
          const tailText = same
            ? `${tail.map((p) => p.label).join('/')}各 ${tail[0].model} ${tail[0].kw}kW`
            : tail.map((p) => `${p.label} ${p.model} ${p.kw}kW`).join('；');
          return [...head, tailText].join('；');
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
          if (ids.length === 0) throw new Error('topology 未找到 hvac 内机回路');
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
          if (ids.length === 0) throw new Error('topology 未找到 hvac 外机回路：拒绝输出 0 路');
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
          if (!p) throw new Error('electrical.yaml 缺 panel_strong_entry_left 点位');
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
          if (numbered === 0) throw new Error('pending 台账编号行匹配为 0：表格格式已变，拒绝静默输出 0 条');
          const sub = (c.pendingText.match(/^\| \d+[a-z] \|/gm) ?? []).length;
          return `${numbered} 条编号`;
        },
        source: 'docs/pending-site-data.md:3',
        note: (c) => {
          const numbered = (c.pendingText.match(/^\| \d+ \|/gm) ?? []).length;
          if (numbered === 0) throw new Error('pending 台账编号行匹配为 0：表格格式已变，拒绝静默输出 0 条');
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
