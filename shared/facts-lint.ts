// shared/facts-lint.ts
// 非几何数据对账引擎（`npm run verify:facts` 的核心）。
//
// 本层防线解决什么问题
// ───────────────────
// 既有 12 道 verify 门禁（topology / layout / furniture / rules / collision / spatial /
// data-consistency / mep / electrical / project-render-facts / lighting-config）只回答
// 「几何与点位自洽吗」：多边形闭合、墙段包含、走线不穿墙、回路全覆盖、灯具高度一致。
// 它们**不回答**「同一个事实在多处书写时是否一致」——回路数、成交金额、面积口径、容量、
// 决策编号这些**非几何标量**被散写在 config / docs / schedule 的注释、表格与叙述里，
// 彼此从不对账，于是 19 路 / 20 路、48 条 / 73 条、190k / 206k、1.60㎡ / 2.48㎡ 这类
// 漂移可以长期静默存在。
//
// 与几何门禁的分工
// ────────────────
//   几何门禁：单一权威源（model-geometry.yaml）→ 派生量必须与之一致（机器算）。
//   本层门禁：**人写的叙述**必须与机器源一致（正则抽 + 对账）。
// 因此本引擎纯函数、不碰 fs；所有文件内容由调用方（入口脚本 / 测试）经
// FactsWorkspace 注入，任何文件缺失都退化为「解析不了」而不是崩溃。
//
// 登记表如何维护（config/facts.yaml）
// ─────────────────────────────────
//  铁律 1：新增镜像（fact.mirrors）必须写清 extract 正则与 expect_matches；
//          命中数不符即 mirror_unresolvable——**禁止静默跳过**。
//  铁律 2：新增豁免（fact.exempt / scan.exempt_occurrences）必须写 reason，
//          说明「这是历史留档 / 渲染产物 / 双口径未收敛」中的哪一种。
//          没有 reason 的豁免视为谎言，评审时应驳回。
//  铁律 3：权威值只允许来自机器源（kind: derived）或显式登记的叙述锚点
//          （kind: narrative），不允许手抄数字。
//
// 四层结构（T1..T4）
//   T1 scan      —— 发现层：include 范围内每个标量的每次出现，必须被某个 fact 的
//                   mirror / exempt 或 scan.exempt_occurrences 覆盖，否则报
//                   unregistered_fact_occurrence（把「没人认领的数字」变成显式债务）。
//   T2 facts     —— 对账层：权威值 ↔ 镜像值逐个比较。
//   T3 contracts —— 契约层：唯一性 / 外键 / 条件必填 / 非空转 / 互斥 / 求和 / 对齐 / 交叠。
//   T4 coverage  —— 覆盖层：config 顶层字段必须登记，且登记的 reader 必须真的读它。

// ─── 公共类型 ────────────────────────────────────────────────────────────────

export type FactsLintLevel = 'error' | 'warning';

export interface FactsIssue {
  level: FactsLintLevel;
  code: string;
  message: string;
  location?: string;
}

export interface FactsLintResult {
  errors: FactsIssue[];
  warnings: FactsIssue[];
  counts: Record<string, number>;
  /** 透明化备注：被约定显式忽略的项（如 floor_region 的 follow 声明），只在汇总里出现，不计 fail。 */
  notes?: string[];
}

/** 调用方注入的只读文件视图。引擎不 import fs，全部 IO 走这里。 */
export interface FactsWorkspace {
  read(rel: string): string | null;
  load(rel: string): unknown | null;
  grep(rel: string, re: RegExp): RegExpExecArray[];
  /** 入口预计算的派生数据（多边形、待扫描文件清单等）。 */
  datasets?: Record<string, unknown>;
}

// ─── 登记表类型 ──────────────────────────────────────────────────────────────

export interface ScanScalar { id: string; pattern: string }
export interface ScanExempt { path: string; scalars?: string[]; pattern: string; reason: string; /** 待决事项；填了它引擎会在 INFO 里列出该豁免 */ pending?: string }
export interface Scan {
  include?: string[];
  exclude?: string[];
  scalars?: ScanScalar[];
  /** 文件/目录级噪声登记：不属于任何 fact 的域（渲染产物、时间序档案、研究留档）。 */
  exempt_occurrences?: ScanExempt[];
}

export interface FactMirror {
  path: string;
  extract: string;
  severity?: FactsLintLevel;
  expect_matches?: number;
  /** 取第几个捕获组，默认 1（无捕获组时退化为整个匹配）。 */
  group?: number;
  /** 数值缩放，例如 `ceiling 190k` 写 190、scale 1000。 */
  scale?: number;
  tolerance?: number;
}

export interface FactExempt { path: string; pattern: string; reason: string; /** 待决事项：写「等谁裁决什么」。填了它，引擎会在 INFO 里列出该豁免，而不是让它在报告里静默消失。 */ pending?: string }

export type Exemption =
  | { kind: 'fact'; id: string; entry: FactExempt }
  | { kind: 'scan'; entry: ScanExempt };

export interface Fact {
  id: string;
  kind: 'derived' | 'narrative';
  /** `@<path>:<点分路径|字面定位串>`；derived 支持 `#length`/`#shoelace`/`#bbox_area`/`#field_sum:f`/`#find:k=v`。 */
  value: string;
  unit?: string;
  as_of?: string;
  tolerance?: number;
  mirrors?: FactMirror[];
  exempt?: FactExempt[];
  enabled?: boolean;
}

export type ContractKind =
  | 'unique'
  | 'fk'
  | 'requires'
  | 'requires_when'
  | 'non_empty'
  | 'mutex'
  | 'sum'
  | 'parity'
  | 'overlap'
  | 'count'
  | 'pointer'
  | 'type_ref'
  | 'supersede'
  | 'ceiling_clearance'
  | 'covered_or_marked';
export interface Contract {
  id: string;
  kind: ContractKind;
  severity?: FactsLintLevel;
  /** 待决事项：契约已登记但当前 0 命中（词汇表尚未启用）时，在报告 INFO 里单列露面。 */
  pending?: string;
  [field: string]: unknown;
}

export interface Coverage {
  file: string;
  /** 单字段登记 */
  field?: string;
  /** 多字段简写：等价于把 field 列表逐条展开。 */
  fields?: string[];
  /** 声称读取该字段的源码文件；本层会真的去 grep，抓「矩阵说谎」。 */
  readers?: string[];
  [field: string]: unknown;
}

export interface FactsRegistry {
  scan?: Scan;
  facts?: Fact[];
  contracts?: Contract[];
  coverage?: Coverage[];
  /** 决策日志的文件清单（DEC 条目正文所在）。`repair_channel.decision_ref` 的存在性校验以它为准；
   *  不登记则跳过该校验（并在 INFO 露面，不静默）。 */
  decision_log_files?: string[];
}

// ─── 小工具 ──────────────────────────────────────────────────────────────────

type Pt = { x: number; z: number };

function issue(level: FactsLintLevel, code: string, message: string, location?: string): FactsIssue {
  return { level, code, message, ...(location ? { location } : {}) };
}

function add(result: FactsLintResult, item: FactsIssue): void {
  result[item.level === 'error' ? 'errors' : 'warnings'].push(item);
}

function tally(result: FactsLintResult, code: string): void {
  result.counts[code] = (result.counts[code] ?? 0) + 1;
}

function emptyResult(): FactsLintResult {
  return { errors: [], warnings: [], counts: { errors: 0, warnings: 0 }, notes: [] };
}

function note(result: FactsLintResult, message: string): void {
  (result.notes ??= []).push(message);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, fallback = ''): string { return typeof v === 'string' ? v : fallback; }
function num(v: unknown, fallback: number): number { return typeof v === 'number' && Number.isFinite(v) ? v : fallback; }

function firstArray(v: unknown): unknown[] | undefined {
  if (Array.isArray(v)) return v;
  if (isRecord(v)) {
    for (const value of Object.values(v)) if (Array.isArray(value)) return value;
  }
  return undefined;
}

/** 递归条目数：数组 → 长度；映射 → 各值递归条目数之和；标量 → 0。 */
function countAll(node: unknown): number {
  if (Array.isArray(node)) return node.length;
  if (isRecord(node)) return Object.values(node).reduce((sum: number, v) => sum + countAll(v), 0);
  return 0;
}

/** 数值归一化：去逗号/货币符/空白/单位，取首个数字。 */
function toNumber(raw: string): number {
  const cleaned = raw.replace(/[,，\s¥￥$元路条㎡mkWw]/g, '');
  const m = /-?\d+(?:\.\d+)?/.exec(cleaned);
  return m ? Number(m[0]) : Number.NaN;
}

/** 几何/求和结果统一收敛到 4 位小数，消灭 1.6000000000000005 这类浮点尾巴。 */
function round4(value: number): number { return Math.round(value * 1e4) / 1e4; }

function shoelace(pts: Pt[]): number {
  if (pts.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].z - pts[j].x * pts[i].z;
  }
  return Math.abs(area / 2);
}

function bboxArea(pts: Pt[]): number {
  if (!pts.length) return 0;
  const xs = pts.map((p) => p.x);
  const zs = pts.map((p) => p.z);
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs));
}

/** 顶点 id → 坐标。形如 `[{id:'v_a', x:.., z:..}]` 的表。 */
function vertexTable(doc: unknown): Map<string, Pt> {
  const table = new Map<string, Pt>();
  const vertices = isRecord(doc) ? doc.vertices : undefined;
  if (Array.isArray(vertices)) {
    for (const v of vertices) {
      if (isRecord(v) && typeof v.id === 'string' && typeof v.x === 'number' && typeof v.z === 'number') {
        table.set(v.id, { x: v.x, z: v.z });
      }
    }
  }
  return table;
}

function polygonOf(raw: unknown, table: Map<string, Pt>): Pt[] {
  if (!Array.isArray(raw)) return [];
  const pts: Pt[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      const p = table.get(entry);
      if (p) pts.push(p);
      continue;
    }
    if (isRecord(entry) && typeof entry.x === 'number' && typeof entry.z === 'number') pts.push({ x: entry.x, z: entry.z });
  }
  return pts;
}

// ─── 文件访问辅助 ────────────────────────────────────────────────────────────

function execAll(text: string, pattern: string): RegExpExecArray[] {
  let re: RegExp;
  try {
    re = new RegExp(pattern, 'gm');
  } catch {
    return [];
  }
  const out: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m);
    if (m[0].length === 0) re.lastIndex += 1;
  }
  return out;
}

/** 编译失败不抛异常，返回 undefined（调用方转成 issue）。 */
function tryRegex(pattern: string, flags = ''): RegExp | undefined {
  try { return new RegExp(pattern, flags); } catch { return undefined; }
}

/** 全文多匹配；统一带 g+m，命中项保留 index 以便反推行号。 */
function grep(ws: FactsWorkspace, rel: string, pattern: string): RegExpExecArray[] {
  if (typeof ws.grep === 'function') {
    try {
      const hits = ws.grep(rel, new RegExp(pattern, 'gm'));
      if (Array.isArray(hits)) return hits.filter((h) => h && typeof h.index === 'number');
    } catch { /* fall through to read */ }
  }
  const text = ws.read(rel);
  return text === null ? [] : execAll(text, pattern);
}

class LineIndex {
  private cache = new Map<string, number[]>();

  constructor(private readonly ws: FactsWorkspace) {}

  at(rel: string, index: number): number {
    let starts = this.cache.get(rel);
    if (!starts) {
      const text = this.ws.read(rel) ?? '';
      starts = [0];
      for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) starts.push(i + 1);
      this.cache.set(rel, starts);
    }
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  }
}

function loc(lines: LineIndex, rel: string, index: number | undefined): string {
  return `${rel}:${lines.at(rel, index ?? 0)}`;
}

function escapeLiteral(text: string): string { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** 在文件里定位一个字面串（如对象 id / json 键名）的首个位置。 */
function locate(ws: FactsWorkspace, path: string, needle: string): string | undefined {
  const hits = grep(ws, path, escapeLiteral(needle));
  return hits.length ? `${path}:${new LineIndex(ws).at(path, hits[0].index)}` : path;
}

function isPath(prefix: string, file: string): boolean {
  return file === prefix || file.startsWith(prefix);
}

function pathMatches(spec: string, file: string): boolean {
  return spec.endsWith('/') ? file.startsWith(spec) : isPath(spec, file);
}

/** 契约字段既接受单文件路径，也接受路径数组。
 *  为什么需要：DEC 日志 2026-10-09 按主题拆成 `docs/decisions/` 14 个文件后，
 *  `c.dec_unique.source`（查重）与 `c.dec_ref_resolvable.target`（外键解析）必须覆盖全部文件，
 *  否则跨文件重号查不到、DEC 短引反查会集体 dangling。
 *  向后兼容：字符串形式照旧；不存在/不可读的文件跳过（与单文件语义一致）。 */
function pathList(v: unknown): string[] {
  if (Array.isArray(v)) return stringList(v);
  const one = str(v);
  return one ? [one] : [];
}

function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function matchText(m: RegExpExecArray, group: number): string {
  const raw = m[group] ?? m[0];
  return typeof raw === 'string' ? raw : m[0];
}

// ─── T2 权威值解析 ───────────────────────────────────────────────────────────

interface Resolved { ok: boolean; value?: number; detail: string }

function applyOp(current: unknown, op: string, doc: unknown): unknown {
  if (op === 'length') return Array.isArray(current) ? current.length : undefined;
  if (op === 'keys') return Array.isArray(current) ? current.length : isRecord(current) ? Object.keys(current).length : undefined;
  if (op === 'bbox_area') return round4(bboxArea(polygonOf(current, vertexTable(doc))));
  if (op === 'shoelace') return round4(shoelace(polygonOf(current, vertexTable(doc))));
  // 递归条目数：数组 → 元素数；映射 → 各值递归条目数之和。
  // 用于 `furnishings: { room: [...] }` 这类「按房间分组的条目数组」（92 件家具）。
  if (op === 'count_all') return countAll(current);
  if (op.startsWith('field_sum:')) {
    const field = op.slice('field_sum:'.length);
    if (!Array.isArray(current)) return undefined;
    let sum = 0;
    for (const entry of current) {
      if (isRecord(entry) && typeof entry[field] === 'number') sum += entry[field];
      else if (typeof entry === 'number') sum += entry;
    }
    return round4(sum);
  }
  if (op.startsWith('find:')) {
    const body = op.slice('find:'.length);
    const eq = body.indexOf('=');
    if (eq < 0 || !Array.isArray(current)) return undefined;
    const key = body.slice(0, eq);
    const want = body.slice(eq + 1);
    return current.find((entry) => isRecord(entry) && String(entry[key]) === want);
  }
  return undefined;
}

/** 解析 `@<path>:<点分路径>`，路径段支持内联 `#op` 派生算子。 */
function resolveDerived(doc: unknown, spec: string): Resolved {
  let current: unknown = doc;
  for (const rawSeg of spec.split('.')) {
    if (rawSeg.length === 0) continue;
    // 一段可以是 `key`、`key#op` 或 `#op`（后者对当前值直接施加算子）。
    const hash = rawSeg.indexOf('#');
    const key = hash < 0 ? rawSeg : rawSeg.slice(0, hash);
    const op = hash < 0 ? '' : rawSeg.slice(hash + 1);
    let seg = rawSeg;
    if (key.length > 0) {
      if (Array.isArray(current) && key === 'length') current = current.length;
      else if (Array.isArray(current) && /^\d+$/.test(key)) current = current[Number(key)];
      else if (isRecord(current)) current = current[key];
      else return { ok: false, detail: `路径段 ${seg} 无法在 ${typeof current} 上解析` };
      if (current === undefined || current === null) return { ok: false, detail: `路径段 ${seg} 解析为空` };
    }
    if (op.length > 0) {
      current = applyOp(current, op, doc);
      if (current === undefined || current === null) return { ok: false, detail: `算子 #${op} 在 ${seg} 上解析为空` };
    }
  }
  if (typeof current !== 'number' || !Number.isFinite(current)) {
    return { ok: false, detail: `解析结果不是有限数值（${String(current)}）` };
  }
  return { ok: true, value: current, detail: String(current) };
}

/** `narrative` 用后半段做字面定位，取其中第一个数字作为权威值。 */
function resolveNarrative(text: string, anchor: string): Resolved {
  const at = text.indexOf(anchor);
  if (at < 0) return { ok: false, detail: `无法在文件中定位字面锚点「${anchor}」` };
  const value = toNumber(anchor);
  if (!Number.isFinite(value)) return { ok: false, detail: `锚点「${anchor}」中无数可抽` };
  return { ok: true, value, detail: anchor };
}

function resolveAuthority(spec: string, ws: FactsWorkspace): Resolved & { path: string; body: string } {
  const body = spec.startsWith('@') ? spec.slice(1) : spec;
  const colon = body.indexOf(':');
  const path = colon < 0 ? body : body.slice(0, colon);
  const rest = colon < 0 ? '' : body.slice(colon + 1);
  if (!path || !rest) return { ok: false, detail: 'value 必须写成 @<path>:<点分路径|字面定位串>', path, body: rest };
  if (rest.startsWith('@')) return { ok: false, detail: '不支持的 value 写法', path, body: rest };
  const doc = ws.load(path);
  const text = ws.read(path);
  if (doc === null && text === null) return { ok: false, detail: `文件不存在或不可读：${path}`, path, body: rest };
  // 叙述锚点优先：file 文本里能逐字找到即按 narrative 解释，否则按点分路径解释。
  if (text !== null && rest.includes(' ') && text.includes(rest)) {
    const r = resolveNarrative(text, rest);
    return { ...r, path, body: rest };
  }
  const r = resolveDerived(doc, rest);
  return { ...r, path, body: rest };
}

// ─── T1 发现层 ───────────────────────────────────────────────────────────────

function registeredLines(
  registry: FactsRegistry,
  rel: string,
  scalarId: string,
  line: string,
): boolean {
  const hit = (pattern: string): boolean => {
    const re = tryRegex(pattern);
    return re !== undefined && re.test(line);
  };
  for (const fact of registry.facts ?? []) {
    for (const mirror of fact.mirrors ?? []) {
      if (mirror.path === rel && hit(mirror.extract)) return true;
    }
    for (const exempt of fact.exempt ?? []) {
      if (exempt.path === rel && hit(exempt.pattern)) return true;
    }
  }
  for (const group of registry.scan?.exempt_occurrences ?? []) {
    if (!pathMatches(group.path, rel)) continue;
    if (group.scalars && !group.scalars.includes(scalarId)) continue;
    if (hit(group.pattern)) return true;
  }
  return false;
}

function runScan(registry: FactsRegistry, ws: FactsWorkspace, result: FactsLintResult, lines: LineIndex): void {
  const scan = registry.scan;
  if (!scan?.scalars?.length) return;
  const include = stringList(scan.include);
  const exclude = stringList(scan.exclude);
  const allFiles = Array.isArray(ws.datasets?.['scan.files']) ? stringList(ws.datasets?.['scan.files']) : [];
  const files = allFiles.filter((file) => include.some((p) => pathMatches(p, file)) && !exclude.some((p) => pathMatches(p, file)));

  for (const scalar of scan.scalars) {
    // 值 → [位置...]，一次性聚合，避免同一数值刷屏。
    const found = new Map<string, string[]>();
    for (const file of files) {
      const text = ws.read(file);
      if (text === null) continue;
      for (const m of execAll(text, scalar.pattern)) {
        const raw = matchText(m, 1);
        const value = toNumber(raw);
        if (!Number.isFinite(value)) continue;
        const lineNo = lines.at(file, m.index);
        const lineStart = text.lastIndexOf('\n', Math.max(0, m.index - 1)) + 1;
        const lineEnd = text.indexOf('\n', m.index);
        const lineText = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
        if (registeredLines(registry, file, scalar.id, lineText)) continue;
        const key = String(value);
        const bucket = found.get(key) ?? [];
        bucket.push(`${file}:${lineNo}（原样「${raw.trim()}」）`);
        found.set(key, bucket);
      }
    }
    for (const [value, sites] of [...found.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en'))) {
      const shown = sites.slice(0, 6).join('; ');
      const rest = sites.length > 6 ? `；…另 ${sites.length - 6} 处` : '';
      const item = issue(
        'warning',
        'unregistered_fact_occurrence',
        `标量 ${scalar.id} 的值 ${value} 出现 ${sites.length} 次但未登记到任何 fact 的 mirrors/exempt：${shown}${rest}`,
        sites[0],
      );
      add(result, item);
      tally(result, item.code);
    }
  }
}

// ─── T2 对账层 ───────────────────────────────────────────────────────────────

function runFacts(registry: FactsRegistry, ws: FactsWorkspace, result: FactsLintResult, lines: LineIndex): void {
  for (const fact of registry.facts ?? []) {
    if (fact.enabled === false) continue;
    const auth = resolveAuthority(fact.value, ws);
    if (!auth.ok || auth.value === undefined) {
      const item = issue('error', 'authoritative_unresolvable', `fact ${fact.id} 权威值无法解析：${auth.detail}（value=${fact.value}）`, auth.path || undefined);
      add(result, item);
      tally(result, item.code);
      continue;
    }
    const unit = fact.unit ? ` ${fact.unit}` : '';
    for (const mirror of fact.mirrors ?? []) {
      const hits = grep(ws, mirror.path, mirror.extract);
      const expect = mirror.expect_matches ?? 1;
      if (hits.length !== expect) {
        const item = issue(
          'error',
          'mirror_unresolvable',
          `fact ${fact.id} 镜像 ${mirror.path} 用 /${mirror.extract}/ 命中 ${hits.length} 次，期望 ${expect} 次——禁止静默跳过，请修正正则或显式声明 expect_matches`,
          mirror.path,
        );
        add(result, item);
        tally(result, item.code);
        if (!hits.length) continue;
      }
      const raw = matchText(hits[0], mirror.group ?? 1);
      const value = toNumber(raw) * (mirror.scale ?? 1);
      if (!Number.isFinite(value)) {
        const item = issue('error', 'mirror_unresolvable', `fact ${fact.id} 镜像 ${mirror.path} 抽出的「${raw}」不是数值`, loc(lines, mirror.path, hits[0].index));
        add(result, item);
        tally(result, item.code);
        continue;
      }
      const tol = mirror.tolerance ?? fact.tolerance ?? 0;
      if (Math.abs(value - auth.value) > tol) {
        const level = mirror.severity ?? 'error';
        const item = issue(
          level,
          'fact_mismatch',
          `fact ${fact.id} 对账失败：权威值 ${auth.value}${unit} ≠ 镜像值 ${value}（${loc(lines, mirror.path, hits[0].index)} 抽得「${raw.trim()}」，期望 ${auth.value}${unit}，容差 ${tol}）`,
          loc(lines, mirror.path, hits[0].index),
        );
        add(result, item);
        tally(result, item.code);
      }
    }
  }
}

// ─── T3 契约层 ───────────────────────────────────────────────────────────────

function contractLevel(contract: Contract, fallback: FactsLintLevel = 'error'): FactsLintLevel {
  return contract.severity === 'warning' ? 'warning' : fallback;
}

/** 契约层的文件全集；入口注入 `contract.files`，缺省时退回 `scan.files`。
 *  `spec` 是包含前缀列表；`contract.exclude` 是排除前缀列表（时间序档案、迭代留档）。 */
function contractPaths(ws: FactsWorkspace, spec: unknown, datasetsKey: string, excludeSpec?: unknown): string[] {
  const prefixes = stringList(spec);
  if (!prefixes.length) return [];
  const excludes = stringList(excludeSpec);
  const fromKey = ws.datasets?.[datasetsKey];
  const universe = Array.isArray(fromKey)
    ? stringList(fromKey)
    : Array.isArray(ws.datasets?.['scan.files']) ? stringList(ws.datasets?.['scan.files']) : [];
  return universe.filter((file) =>
    prefixes.some((p) => pathMatches(p, file)) && !excludes.some((p) => pathMatches(p, file)));
}

/** T3.1 unique：pattern 首捕为 id；allow_suffix 命中的视为补充条目，不与正牌判重。
 *  `source` 可以是单文件或文件数组（DEC 日志拆分后跨文件查重）。 */
function runUnique(ws: FactsWorkspace, result: FactsLintResult, lines: LineIndex, contract: Contract): void {
  const sources = pathList(contract.source);
  if (!sources.length) return;
  const suffixes = stringList(contract.allow_suffix);
  // supplement 判定依赖所在文件的正文（allow_suffix 的 CJK 后缀在标题里、不在捕获组里），
  // 所以每个文件的正文要各自缓存，不能只用第一个文件的 text。
  const texts = new Map<string, string>();
  for (const file of sources) {
    const text = ws.read(file);
    if (text !== null) texts.set(file, text);
  }
  const norm = (id: string, at: number, file: string): { base: string; supplement: boolean } => {
    for (const suffix of suffixes) {
      if (id.endsWith(suffix)) return { base: id.slice(0, -suffix.length), supplement: true };
    }
    // 捕获组不含 CJK 后缀（如 `-补`），但标题正文紧跟其后：看匹配之后是否接着后缀。
    const tail = (texts.get(file) ?? '').slice(at + id.length, at + id.length + 8);
    if (suffixes.some((suffix) => tail.startsWith(suffix))) return { base: id, supplement: true };
    return { base: id, supplement: false };
  };
  const groups = new Map<string, Array<{ id: string; at: number; file: string }>>();
  for (const file of texts.keys()) {
    for (const m of grep(ws, file, str(contract.pattern))) {
      const id = matchText(m, 1);
      const at = m.index + Math.max(0, m[0].indexOf(id)); // m.index 是整段匹配起点，id 可能不从 0 开始
      const { base } = norm(id, at, file);
      const bucket = groups.get(base) ?? [];
      bucket.push({ id, at, file });
      groups.set(base, bucket);
    }
  }
  for (const [base, entries] of groups) {
    const plain = entries.filter((e) => !norm(e.id, e.at, e.file).supplement);
    if (plain.length > 1) {
      // 一个重号报一条，但**列出全部位置**：DEC 日志拆成 14 个文件后，重号往往横跨两个
      // 主题文件，只报其中一个位置没法判断该改哪边。location 取最后一处（新来者），
      // 便于直接跳过去删。
      const where = plain.map((e) => loc(lines, e.file, e.at)).join(' / ');
      const item = issue(
        contractLevel(contract),
        'duplicate_id',
        `${contract.id}：id ${base} 重复 ${plain.length} 次（正牌 ${plain.length} 次），位置 ${where}`,
        loc(lines, plain[plain.length - 1].file, plain[plain.length - 1].at),
      );
      add(result, item);
      tally(result, item.code);
    }
  }
}

/**
 * T3.2 fk：ref_scope 里的引用 id 必须存在于 target 的 id 集合。
 *
 * 两级解析（本项目约定：config/prose 写短引 `DEC-045`，decision_log 只登记全引
 * `DEC-2026-08-26-045`）：
 *   1) 全引直接命中；
 *   2) 短引按序号在全引里反查，唯一命中 → 已解析（进 notes，不算 fail）；
 *      序号无对应 → `dangling_reference`；序号一对多 → `reference_ambiguous`。
 * 另有 `subject_assertions`：**解析成功 ≠ 引用正确**。DEC-045 的序号能反查到
 * DEC-2026-08-26-045，但那条是「主卧空调檐口」，而 64 处引用把它当「主卫四件套」用
 * —— 这类错配只有比对标题主题才能发现，报 `reference_subject_mismatch`。
 */
function runFk(ws: FactsWorkspace, result: FactsLintResult, lines: LineIndex, contract: Contract): void {
  const targets = pathList(contract.target);
  const fullText = new Map<string, string>();
  for (const file of targets) {
    for (const m of grep(ws, file, str(contract.target_pattern))) fullText.set(matchText(m, 1), m[0]);
  }
  const bySerial = new Map<string, string[]>();
  for (const id of fullText.keys()) {
    const s = id.match(/-(\d{1,3})$/);
    if (!s) continue;
    const bucket = bySerial.get(s[1]) ?? [];
    bucket.push(id);
    bySerial.set(s[1], bucket);
  }
  const serialOf = (id: string): string | null => id.match(/-(\d{1,3})$/)?.[1] ?? null;
  const resolve = (id: string): string | null => {
    if (fullText.has(id)) return id;
    const s = serialOf(id);
    const hits = s ? bySerial.get(s) ?? [] : [];
    return hits.length === 1 ? hits[0] : null;
  };

  const refs = new Map<string, string[]>();
  for (const file of contractPaths(ws, contract.ref_scope, 'contract.files', contract.exclude)) {
    for (const m of grep(ws, file, str(contract.ref_pattern))) {
      const id = matchText(m, 1);
      const bucket = refs.get(id) ?? [];
      bucket.push(loc(lines, file, m.index));
      refs.set(id, bucket);
    }
  }

  const dangling = new Map<string, string[]>();
  const ambiguous = new Map<string, string[]>();
  let shortResolved = 0;
  for (const [id, sites] of refs) {
    if (fullText.has(id)) continue;
    const s = serialOf(id);
    const hits = s ? bySerial.get(s) ?? [] : [];
    if (hits.length > 1) ambiguous.set(id, sites);
    else if (hits.length === 1) shortResolved += sites.length;
    else dangling.set(id, sites);
  }
  if (shortResolved > 0) {
    note(result, `${contract.id}：${shortResolved} 处短引按序号唯一反查到全引条目（项目约定 prose 用 DEC-nnn、decision_log 只登记全引，故不算 dangling）`);
  }

  const emit = (code: string, id: string, sites: string[], detail: string) => {
    const shown = sites.slice(0, 5).join('; ');
    const rest = sites.length > 5 ? `；…另 ${sites.length - 5} 处` : '';
    // 歧义不是「确定错」：短引在上下文里人类可解析，只是机器无法唯一裁决 → warning。
    // error 只留给 dangling（反查不到）与 subject_mismatch（解析到但主题不符）。
    const level = code === 'reference_ambiguous' ? 'warning' : contractLevel(contract, 'error');
    const item = issue(level, code, `${contract.id}：引用 ${id} ${detail}（${sites.length} 处：${shown}${rest}）`, sites[0]);
    add(result, item);
    tally(result, item.code);
  };
  for (const [id, sites] of [...dangling.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en'))) {
    emit('dangling_reference', id, sites, `在 ${targets.join(' / ')} 中无对应条目`);
  }
  for (const [id, sites] of [...ambiguous.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en'))) {
    const s = serialOf(id);
    emit('reference_ambiguous', id, sites, `序号 ${s} 对应多条：${(bySerial.get(s ?? '') ?? []).join('、')}`);
  }

  for (const raw of Array.isArray(contract.subject_assertions) ? contract.subject_assertions : []) {
    if (!isRecord(raw)) continue;
    const ref = str(raw.ref);
    const expect = str(raw.expect);
    if (!ref || !expect) continue;
    const resolved = resolve(ref);
    if (!resolved) continue; // 解析不了已由 dangling 覆盖
    const heading = (fullText.get(resolved) ?? '').replace(/^#+\s*/, '');
    if (new RegExp(expect).test(heading)) continue;
    const sites = refs.get(ref) ?? [];
    if (!sites.length) continue;
    const item = issue(
      contractLevel(contract, 'error'),
      'reference_subject_mismatch',
      `${contract.id}：引用 ${ref} 共 ${sites.length} 处，序号反查到「${resolved}」，但其标题是「${heading}」，与引用语境不符（期望匹配 /${expect}/）${raw.note ? `；${str(raw.note)}` : ''}`,
      sites[0],
    );
    add(result, item);
    tally(result, item.code);
  }
}

function collectMatches(
  node: unknown,
  field: string,
  equals: unknown,
  out: Array<Record<string, unknown>>,
  accept?: (node: Record<string, unknown>, key: string) => boolean,
): void {
  if (Array.isArray(node)) {
    for (const entry of node) collectMatches(entry, field, equals, out, accept);
    return;
  }
  if (!isRecord(node)) return;
  if (accept ? accept(node, field) : node[field] === equals) out.push(node);
  for (const value of Object.values(node)) collectMatches(value, field, equals, out, accept);
}

/** T3.3 requires / requires_when：path 里所有命中 when 条件的对象，同级必须带齐 then 字段。
 *
 * 泛化（相比最初的版本）：
 *   - `when.equals` 之外支持 `when.exists: true`：凡**声明了** `when.field` 的对象
 *     即纳入检查（不管取值）。用于「声明了 X 就必须同时声明 Y」这类契约，例如
 *     overrides.yaml 里声明了 `anchorY_offset` 就必须写 `basis`。
 *   - `when.pattern: '<regex>'`：按正则匹配字段值，覆盖同义状态词
 *     （`locked` / `budget_pool_locked` 都算锁定态），避免状态词一改契约就静默失效。
 *   - `max_abs: N`：额外要求 `when.field` 的数值绝对值 ≤ N，越界报
 *     `required_field_out_of_range`。语义是「这个偏移量有据且在合理区间」，
 *     比「两个绝对值碰巧相等」更接近真实意图。
 *   - `min_matches: N`：命中对象数不得少于 N。**默认 0（即不检查）**，但登记时若显式写了
 *     `min_matches: 1`，就表示「这条契约现在必须真的在管东西」——命中 0 条往往意味着
 *     状态词/字段名被改过，契约已静默空转（比没有检查更糟）。
 */
function runRequires(ws: FactsWorkspace, result: FactsLintResult, lines: LineIndex, contract: Contract): void {
  const path = str(contract.path);
  const doc = ws.load(path);
  if (doc === null) return;
  const when = isRecord(contract.when) ? contract.when : {};
  const field = str(when.field);
  const then = stringList(contract.then);
  if (!field || !then.length) return;
  const pattern = str(when.pattern);
  const patternRe = pattern ? tryRegex(pattern) : undefined;
  const existsMode = when.exists === true;
  const maxAbs = typeof contract.max_abs === 'number' && Number.isFinite(contract.max_abs) ? contract.max_abs : undefined;
  const hits: Array<Record<string, unknown>> = [];
  if (existsMode) collectMatches(doc, field, undefined, hits, (node, key) => node[key] !== undefined && node[key] !== null);
  else if (patternRe) collectMatches(doc, field, undefined, hits, (node, key) => patternRe.test(String(node[key] ?? '')));
  else collectMatches(doc, field, when.equals, hits);
  const minMatches = typeof contract.min_matches === 'number' ? contract.min_matches : undefined;
  if (minMatches !== undefined && hits.length < minMatches) {
    const condition = existsMode ? `声明了 ${field}` : pattern ? `${field} 匹配 /${pattern}/` : `${field}=${String(when.equals)}`;
    add(result, issue(
      contractLevel(contract),
      'required_condition_unmatched',
      `${contract.id}：${path} 中${condition}的对象只有 ${hits.length} 个，少于登记的 min_matches=${minMatches}——该契约当前没有管到任何条目（状态词/字段名是否被改过？）`,
      path,
    ));
    tally(result, 'required_condition_unmatched');
  }
  for (const hit of hits) {
    const missing = then.filter((key) => hit[key] === undefined || hit[key] === null);
    if (!missing.length && maxAbs === undefined) continue;
    const id = typeof hit.id === 'string' ? hit.id : '(无 id)';
    const condition = existsMode ? `声明了 ${field} 的` : pattern ? `${field} 匹配 /${pattern}/ 的` : `${field}=${String(when.equals)} 的`;
    if (missing.length) {
      const item = issue(
        contractLevel(contract),
        'required_field_missing',
        `${contract.id}：${path} 中${condition} ${id} 缺少 ${missing.join('、')}`,
        path,
      );
      add(result, item);
      tally(result, item.code);
    }
    if (maxAbs !== undefined) {
      // max_abs 默认约束 when.field 自身；`max_abs_field` 可改约束同级的另一个数值字段
      // （如 when 按 type 命中、却要约束 height：灯具安装高度不得超出室内净高）。
      const raw = hit[str(contract.max_abs_field, field)];
      const value = typeof raw === 'number' ? raw : toNumber(str(raw));
      if (Number.isFinite(value) && Math.abs(value) > maxAbs + 1e-9) {
        const item = issue(
          contractLevel(contract),
          'required_field_out_of_range',
          `${contract.id}：${path} 中 ${id} 的 ${str(contract.max_abs_field, field)}=${value} 超出允许区间 |${str(contract.max_abs_field, field)}|<=${maxAbs}`,
          path,
        );
        add(result, item);
        tally(result, item.code);
      }
    }
  }
}

/** 收集 target_path 下所有对象里 key_field 的取值。 */
function collectFieldValues(node: unknown, key: string, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const entry of node) collectFieldValues(entry, key, out);
    return;
  }
  if (!isRecord(node)) return;
  if (typeof node[key] === 'string') out.add(node[key]);
  for (const value of Object.values(node)) collectFieldValues(value, key, out);
}

function resolvePath(node: unknown, dotted: string): unknown {
  let current: unknown = node;
  for (const seg of dotted.split('.')) {
    if (seg.length === 0) continue;
    if (Array.isArray(current) && /^\d+$/.test(seg)) current = current[Number(seg)];
    else if (isRecord(current)) current = current[seg];
    else return undefined;
  }
  return current;
}

/** T3.4 non_empty：source 的 rule 引用值必须存在于 target 集合，否则规则空转。 */
function runNonEmpty(ws: FactsWorkspace, result: FactsLintResult, lines: LineIndex, contract: Contract): void {
  const source = str(contract.source);
  const doc = ws.load(source);
  if (doc === null) return;
  const target = str(contract.target);
  const targetDoc = ws.load(target);
  if (targetDoc === null) return;
  const keyField = str(contract.key_field, 'id');
  const targetPath = contract.target_path === undefined ? '' : str(contract.target_path);
  const universe = new Set<string>();
  collectFieldValues(targetPath ? resolvePath(targetDoc, targetPath) : targetDoc, keyField, universe);
  const ruleFields = stringList(contract.rule_fields).length ? stringList(contract.rule_fields) : [str(contract.rule_field)];
  const sections = stringList(contract.sections).length ? stringList(contract.sections) : Object.keys(isRecord(doc) ? doc : {});
  const ruleFileField = str(contract.rule_file_field);
  const fileMap = isRecord(contract.file_map) ? contract.file_map : {};
  const scopedUniverse = new Map<string, Set<string>>();
  const universeFor = (fileKey: string): Set<string> | undefined => {
    const mapped = typeof fileMap[fileKey] === 'string' ? (fileMap[fileKey] as string) : fileKey;
    if (!scopedUniverse.has(mapped)) {
      const scopedDoc = ws.load(mapped);
      if (scopedDoc === null) return undefined;
      const set = new Set<string>();
      collectFieldValues(scopedDoc, keyField, set);
      scopedUniverse.set(mapped, set);
    }
    return scopedUniverse.get(mapped);
  };
  for (const section of sections) {
    const node = resolvePath(doc, section);
    const rules: Array<{ key: string; body: Record<string, unknown> }> = [];
    if (Array.isArray(node)) {
      node.forEach((entry, i) => {
        if (isRecord(entry)) rules.push({ key: `${section}[${i}]${typeof entry.id === 'string' ? `(${entry.id})` : ''}`, body: entry });
      });
    } else if (isRecord(node)) {
      rules.push({ key: section, body: node });
    }
    for (const rule of rules) {
      const scoped = ruleFileField ? universeFor(str(resolvePath(rule.body, ruleFileField))) : undefined;
      const activeUniverse = scoped ?? universe;
      const ruleFileKey = str(resolvePath(rule.body, ruleFileField));
      const scopeLabel = scoped ? `${typeof fileMap[ruleFileKey] === 'string' ? fileMap[ruleFileKey] as string : ruleFileKey} 的 ${keyField}` : '';
      for (const ruleField of ruleFields) {
        const value = resolvePath(rule.body, ruleField);
        const values = Array.isArray(value) ? value : [value];
        for (const one of values) {
          if (typeof one !== 'string' || one.length === 0) continue;
          if (activeUniverse.has(one)) continue;
          const item = issue(
            contractLevel(contract, 'warning'),
            'rule_target_absent',
            `${contract.id}：${source} ${rule.key} 的 ${ruleField}=${one} 在 ${scoped ? `${scopeLabel}` : `${target} 的 ${keyField}`} 集合中不存在——该规则空转`,
            source,
          );
          add(result, item);
          tally(result, item.code);
        }
      }
    }
  }
}

/** T3.5 mutex：同一文件内两类 pattern 不得并存。 */
function runMutex(ws: FactsWorkspace, result: FactsLintResult, lines: LineIndex, contract: Contract): void {
  const patterns = stringList(contract.patterns);
  if (patterns.length < 2) return;
  const scope = contractPaths(ws, contract.scope, 'contract.files', contract.exclude);
  for (const file of scope) {
    const presence = patterns.map((pattern) => ({ pattern, hits: grep(ws, file, pattern) })).filter((x) => x.hits.length > 0);
    if (presence.length < 2) continue;
    const detail = presence.map((x) => `「${x.pattern}」${x.hits.length} 处（首见 ${loc(lines, file, x.hits[0].index)}）`).join(' 与 ');
    const item = issue(
      contractLevel(contract),
      'mutex_violation',
      `${contract.id}：${file} 中 ${detail} 同时出现，计价/口径边界自相矛盾`,
      loc(lines, file, presence[0].hits[0].index),
    );
    add(result, item);
    tally(result, item.code);
  }
}

/** T3.6 sum：items_path 的预算求和必须等于 total。 */
function runSum(ws: FactsWorkspace, result: FactsLintResult, contract: Contract): void {
  const source = str(contract.source);
  const doc = ws.load(source);
  if (doc === null) return;
  const itemsPath = str(contract.items_path);
  const items = resolvePath(doc, itemsPath);
  if (items === undefined) return;
  const totalPath = contract.total_path === undefined ? '' : str(contract.total_path);
  const field = str(contract.field, 'budget');
  // 递归累加一个「纯数值映射/数组」（如 allocation: {demolition: 5000, ...}）。
  const sumValues = (node: unknown): number => {
    if (typeof node === 'number') return Number.isFinite(node) ? node : 0;
    if (Array.isArray(node)) return node.reduce((acc: number, entry) => acc + sumValues(entry), 0);
    if (isRecord(node)) return Object.values(node).reduce((acc: number, entry) => acc + sumValues(entry), 0);
    return 0;
  };
  const fieldAt = (entry: unknown): number => (isRecord(entry) && typeof entry[field] === 'number' ? entry[field] : 0);
  const rows: Array<{ name: string; sum: number; total: number }> = [];
  if (totalPath) {
    const total = resolvePath(doc, totalPath);
    const sum = Array.isArray(items)
      ? items.reduce((acc: number, entry) => acc + fieldAt(entry), 0)
      : isRecord(items) ? Object.values(items).reduce((acc: number, entry) => acc + fieldAt(entry), 0) : sumValues(items);
    rows.push({ name: totalPath, sum, total: typeof total === 'number' ? total : Number.NaN });
  } else {
    const list = Array.isArray(items) ? items : [];
    for (const entry of list) {
      if (!isRecord(entry)) continue;
      rows.push({ name: `${itemsPath}.${str(entry.id, '?')}`, sum: sumValues(entry[field]), total: num(entry.total, Number.NaN) });
    }
  }
  for (const row of rows) {
    if (!Number.isFinite(row.total) || !Number.isFinite(row.sum)) continue;
    if (Math.abs(row.sum - row.total) < 0.005) continue;
    const where = locate(ws, source, row.name.startsWith(itemsPath) ? row.name.slice(itemsPath.length + 1) : row.name);
    const item = issue(
      contractLevel(contract),
      'sum_mismatch',
      `${contract.id}：${source} ${row.name} 合计 ${row.sum} ≠ 声明 ${row.total}（差 ${row.sum - row.total}）`,
      where,
    );
    add(result, item);
    tally(result, item.code);
  }
}

/** T3.7 parity：两文件按 key join 后比较 field。 */
function runParity(ws: FactsWorkspace, result: FactsLintResult, lines: LineIndex, contract: Contract): void {
  const sides = [contract.left, contract.right];
  const loaded = sides.map((side) => {
    const spec = isRecord(side) ? side : {};
    const path = str(spec.path);
    const doc = ws.load(path);
    const list = firstArray(doc) ?? [];
    const filterField = str(spec.filter_field);
    const filterValues = stringList(spec.filter_values);
    const kept = filterField && filterValues.length
      ? list.filter((entry) => isRecord(entry) && filterValues.includes(String(entry[filterField])))
      : list;
    return { path, key: str(spec.key, 'id'), field: str(spec.field), filterField, filterValues, list: kept };
  });
  const [left, right] = loaded;
  if (!left?.path || !right?.path) return;
  const rightMap = new Map<string, unknown>();
  for (const entry of right.list) {
    if (!isRecord(entry)) continue;
    const key = entry[left.key];
    if (typeof key === 'string') rightMap.set(key, entry[right.field]);
  }
  for (const entry of left.list) {
    if (!isRecord(entry)) continue;
    const id = String(entry[left.key]);
    const leftValue = entry[left.field];
    const where = locate(ws, left.path, id);
    if (!rightMap.has(id)) {
      const item = issue(
        contractLevel(contract),
        'parity_missing',
        `${contract.id}：${id} 在 ${right.path} 中无对应条目，无法与 ${left.path} 的 ${left.field}=${String(leftValue)} 对齐`,
        where,
      );
      add(result, item);
      tally(result, item.code);
      continue;
    }
    const rightValue = rightMap.get(id);
    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      if (Math.abs(leftValue - rightValue) > 0.005) {
        const item = issue(
          contractLevel(contract),
          'parity_mismatch',
          `${contract.id}：${id} ${left.path}.${left.field}=${leftValue} ≠ ${right.path}.${right.field}=${rightValue}`,
          where,
        );
        add(result, item);
        tally(result, item.code);
      }
    } else if (String(leftValue) !== String(rightValue)) {
      const item = issue(
        contractLevel(contract),
        'parity_mismatch',
        `${contract.id}：${id} ${left.path}.${left.field}=${String(leftValue)} ≠ ${right.path}.${right.field}=${String(rightValue)}`,
        left.path,
      );
      add(result, item);
      tally(result, item.code);
    }
  }
}

/** 分离轴 + Sutherland–Hodgman：多边形交叠面积。凸多边形必须作为裁剪多边形。 */
function polygonConvex(pts: Pt[]): boolean {
  if (pts.length < 3) return false;
  let sign = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const c = pts[(i + 2) % pts.length];
    const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
    const s = cross > 1e-12 ? 1 : cross < -1e-12 ? -1 : 0;
    if (s !== 0) {
      if (sign !== 0 && s !== sign) return false;
      sign = s;
    }
  }
  return true;
}

function clipPolygon(subject: Pt[], clip: Pt[]): Pt[] {
  let output = subject.slice();
  for (let i = 0; i < clip.length; i += 1) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const input = output;
    output = [];
    if (!input.length) break;
    const side = (p: Pt) => (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
    for (let j = 0; j < input.length; j += 1) {
      const current = input[j];
      const previous = input[(j + input.length - 1) % input.length];
      const sc = side(current);
      const sp = side(previous);
      if (sc >= 0) {
        if (sp < 0) {
          const t = sp / (sp - sc);
          output.push({ x: previous.x + t * (current.x - previous.x), z: previous.z + t * (current.z - previous.z) });
        }
        output.push(current);
      } else if (sp >= 0) {
        const t = sp / (sp - sc);
        output.push({ x: previous.x + t * (current.x - previous.x), z: previous.z + t * (current.z - previous.z) });
      }
    }
  }
  return output;
}

function overlapArea(a: Pt[], b: Pt[]): { area: number; exact: boolean } {
  if (polygonConvex(b)) return { area: shoelace(clipPolygon(a, b)), exact: true };
  if (polygonConvex(a)) return { area: shoelace(clipPolygon(b, a)), exact: true };
  const inside = (p: Pt, poly: Pt[]) => {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      const xi = poly[i].x, zi = poly[i].z, xj = poly[j].x, zj = poly[j].z;
      if ((zi > p.z) !== (zj > p.z) && p.x < ((xj - xi) * (p.z - zi)) / (zj - zi) + xi) hit = !hit;
    }
    return hit;
  };
  const touches = a.some((p) => inside(p, b)) || b.some((p) => inside(p, a));
  return { area: touches ? Number.NaN : 0, exact: false };
}

/**
 * T3.8 overlap：两个 dataset 的多边形两两求交。
 *
 * `ignore_follow`（默认 true）：overlay 的 floor_region 若声明了 `follow: <room>`，
 * 说明它是有意的子区域（跟随某房间地材、过渡地面、设备平台），与房间重叠是设计而非
 * 缺陷。只抓「没有 follow 声明却整块落在别人房间里」的那类——corridor_floor 即此。
 * 被忽略的项进 notes，不静默。
 */
function runOverlap(ws: FactsWorkspace, result: FactsLintResult, contract: Contract): void {
  const names = stringList(contract.datasets);
  if (names.length < 2) return;
  const ignoreFollow = contract.ignore_follow !== false;
  let ignored = 0;
  const groups = names.map((name) => {
    const raw = ws.datasets?.[name];
    const items = Array.isArray(raw) ? raw : [];
    const kept: Array<{ id: string; pts: Pt[] }> = [];
    for (const entry of items.filter(isRecord)) {
      if (ignoreFollow && typeof entry.follow === 'string' && entry.follow.length > 0) {
        ignored += 1;
        continue;
      }
      kept.push({ id: str(entry.id, '?'), pts: polygonOf(entry.polygon ?? entry.points, new Map()) });
    }
    return { name, polys: kept };
  });
  if (ignored > 0) {
    note(result, `${contract.id}：${ignored} 个 floor_region 声明了 follow（有意的子区域/过渡地面），按约定不计交叠`);
  }
  for (let i = 0; i < groups.length; i += 1) {
    for (let j = i + 1; j < groups.length; j += 1) {
      for (const a of groups[i].polys) {
        for (const b of groups[j].polys) {
          if (a.pts.length < 3 || b.pts.length < 3) continue;
          const { area, exact } = overlapArea(a.pts, b.pts);
          const hit = exact ? area > 1e-6 : Number.isNaN(area);
          if (!hit) continue;
          const areaText = exact ? `${area.toFixed(2)}㎡` : '面积不可精确计算（非凸多边形，仅检出接触）';
          const item = issue(
            contractLevel(contract),
            'polygon_overlap',
            `${contract.id}：${groups[i].name}/${a.id} 与 ${groups[j].name}/${b.id} 多边形交叠，交叠面积 ${areaText}`,
            `datasets:${groups[i].name}+${groups[j].name}`,
          );
          add(result, item);
          tally(result, item.code);
        }
      }
    }
  }
}

// ─── T3.9 count：机器条目数 vs prose 声明计数 ─────────────────────────────────
//
// 治「条目增删不同步」：数组加了一条、删了一条，头注里的「本表 routes 共 N 条」却没人改。
// 左侧永远是机器数（source 的 items_path 长度），右侧是 prose 里手写的声明值。
//
//   { id: c.x, kind: count,
//     source: config/materials.yaml, items_path: materials,
//     prose: [{ path: README.md, extract: '材料清单共\s*(\d+)\s*条', expect_matches: 1 }] }
//
// prose 命中数不符 → `count_mirror_unresolvable`（error，禁止静默跳过）；
// 数值不等 → `count_mismatch`（默认 error，可用 severity 降级）。

function countOf(node: unknown, itemsPath: string): number | undefined {
  const target = resolvePath(node, itemsPath);
  if (Array.isArray(target)) return target.length;
  if (isRecord(target)) return Object.keys(target).length;
  return undefined;
}

/** count 契约的实际条目数：可再按 `count_field` 汇总（如 phases → items 数组长度之和）。 */
function countEntries(doc: unknown, contract: Contract): { actual: number | undefined; label: string } {
  const itemsPath = str(contract.items_path);
  const countField = str(contract.count_field);
  const target = resolvePath(doc, itemsPath);
  if (!countField) return { actual: countOf(doc, itemsPath), label: itemsPath || '(文档根)' };
  if (Array.isArray(target)) {
    let sum = 0;
    for (const entry of target) {
      if (!isRecord(entry)) continue;
      const nested = entry[countField];
      if (Array.isArray(nested)) sum += nested.length;
      else if (isRecord(nested)) sum += Object.keys(nested).length;
      else if (typeof nested === 'number') sum += 1;
    }
    return { actual: sum, label: `${itemsPath}[].${countField}` };
  }
  return { actual: countOf(doc, itemsPath), label: itemsPath || '(文档根)' };
}

function runCount(ws: FactsWorkspace, result: FactsLintResult, lines: LineIndex, contract: Contract): void {
  const source = str(contract.source);
  const doc = ws.load(source);
  if (doc === null) return;
  const { actual, label } = countEntries(doc, contract);
  if (actual === undefined) {
    add(result, issue('error', 'count_unresolvable', `${contract.id}：${source} 的 items_path ${str(contract.items_path)} 不是数组或映射`, source));
    tally(result, 'count_unresolvable');
    return;
  }
  const prose = (Array.isArray(contract.prose) ? contract.prose : []).filter(isRecord);
  let checked = 0;
  for (const one of prose) {
    const path = str(one.path);
    const extract = str(one.extract);
    if (!path || !extract) continue;
    const expect = typeof one.expect_matches === 'number' ? one.expect_matches : 1;
    const distinct = one.distinct === true;
    const hits = grep(ws, path, extract);
    // distinct 模式：expect_matches 指的是**去重后的条目数**（同一验收项会被多个工作包
    // 引用，直接数行数会把 39 条验收项数成 46 行）。
    if (distinct) {
      const values = new Set(hits.map((m) => matchText(m, typeof one.group === 'number' ? one.group : 1)));
      if (values.size !== expect) {
        add(result, issue(
          contractLevel(contract),
          'count_mirror_unresolvable',
          `${contract.id}：${path} 用 /${extract}/ 去重后命中 ${values.size} 个条目，期望 ${expect} 个——禁止静默跳过`,
          path,
        ));
        tally(result, 'count_mirror_unresolvable');
        continue;
      }
      checked += 1;
      if (values.size !== actual) {
        add(result, issue(
          contractLevel(contract),
          'count_mismatch',
          `${contract.id}：${source} 的 ${label} 实际 ${actual} 条，但 ${path} 去重后只有 ${values.size} 个条目（${loc(lines, path, hits[0].index)}）`,
          loc(lines, path, hits[0].index),
        ));
        tally(result, 'count_mismatch');
      }
      continue;
    }
    if (hits.length !== expect) {
      add(result, issue(
        contractLevel(contract),
        'count_mirror_unresolvable',
        `${contract.id}：${path} 用 /${extract}/ 命中 ${hits.length} 次，期望 ${expect} 次——禁止静默跳过`,
        path,
      ));
      tally(result, 'count_mirror_unresolvable');
      if (!hits.length) continue;
    }
    const raw = matchText(hits[0], typeof one.group === 'number' ? one.group : 1);
    const declared = toNumber(raw);
    if (!Number.isFinite(declared)) {
      add(result, issue('error', 'count_mirror_unresolvable', `${contract.id}：${path} 抽出的「${raw}」不是数值`, loc(lines, path, hits[0].index)));
      tally(result, 'count_mirror_unresolvable');
      continue;
    }
    checked += 1;
    if (declared !== actual) {
      add(result, issue(
        contractLevel(contract),
        'count_mismatch',
        `${contract.id}：${source} 的 ${label} 实际 ${actual} 条，但 ${path} 声明 ${declared} 条（${loc(lines, path, hits[0].index)}）`,
        loc(lines, path, hits[0].index),
      ));
      tally(result, 'count_mismatch');
    }
  }
  if (prose.length > 0 && checked === 0) {
    add(result, issue(
      contractLevel(contract),
      'count_unregistered',
      `${contract.id}：${source} 的 ${label} 共 ${actual} 条，但登记的所有 prose 计数声明都无法解析——条目增删没人同步`,
      source,
    ));
    tally(result, 'count_unregistered');
  }
}

// ─── T3.10 pointer：prose 引用的文件路径必须真实存在 ──────────────────────────
//
// 治「prose 引用不存在的东西」：README / 决策记录里写 config 下的 yaml、docs 下的 md、
// schedule 下的 md，文件被改名/删除/从没存在过，链接静默腐烂。
//
//   { id: c.x, kind: pointer, ref_scope: [README.md],
//     path_pattern: '((?:config|docs|schedule|shared|server)/[A-Za-z0-9_\-./]+\.(?:yaml|json|md|ts))' }
// 注意：本文件的示例一律用 `<dir>/<file>.<ext>` 这类不含真实文件名的占位写法，
// 否则 pointer 契约会把自己的文档注释当成腐烂引用报出来。
//
// 命中的路径逐条做存在性检查；`allow` 列出有意指向外部/留档的例外（须写 reason）。
// 注意：只扫仓库内相对路径，`http(s)://` 与绝对路径天然不匹配该 pattern。

function runPointer(ws: FactsWorkspace, result: FactsLintResult, lines: LineIndex, contract: Contract): void {
  const pattern = tryRegex(str(contract.path_pattern));
  if (!pattern) return;
  const allow = (Array.isArray(contract.allow) ? contract.allow : []).filter(isRecord);
  const allowed = new Set<string>();
  for (const one of allow) {
    const p = str(one.path);
    if (p) allowed.add(p);
  }
  const seen = new Set<string>();
  for (const file of contractPaths(ws, contract.ref_scope, 'contract.files', contract.exclude)) {
    for (const m of grep(ws, file, str(contract.path_pattern))) {
      const rel = matchText(m, 1).replace(/[),.'";]+$/, '');
      if (!rel || allowed.has(rel)) continue;
      const key = `${file}:${rel}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (ws.read(rel) !== null) continue;
      add(result, issue(
        contractLevel(contract),
        'pointer_dangling',
        `${contract.id}：${file} 引用了不存在的路径 ${rel}（${loc(lines, file, m.index)}）——prose 引用腐烂`,
        loc(lines, file, m.index),
      ));
      tally(result, 'pointer_dangling');
    }
  }
  for (const one of allow) {
    const p = str(one.path);
    const reason = str(one.reason);
    if (p && !reason) {
      add(result, issue('error', 'pointer_allow_without_reason', `${contract.id}：pointer allow 列表中的 ${p} 没有写 reason——豁免不许无理由`, str(contract.ref_scope)));
      tally(result, 'pointer_allow_without_reason');
    }
  }
}

// ─── T3.11 type_ref：规则里引用的家具 type 必须存在于 house.yaml furnishings ───
//
// 治「口径被旧值取代」：verify-rules / design-rules 改了家具命名（tv_stand /
// wardrobe_240 / master_freestanding_wardrobe_062），house.yaml 的 furnishings 没跟上，
// 规则就静默空转——下一次复核时没人会发现这条校验从未生效。
//
//   { id: c.x, kind: type_ref,
//     sources: [config/verify-rules.yaml, config/design-rules.yaml],
//     under: [match, furniture, furniture_types],
//     target: config/house.yaml, target_path: furnishings, key_field: type,
//     allow: [{ type: ac_indoor, reason: '空调内机不是家具，由 c.rule_targets_exist 的 b.file 映射对账' }] }
//
// `allow[]` 里的每一项都必须写 reason；没有 reason 的放行视为谎言（报
// type_ref_allow_without_reason）。这与 pointer 的 allow 是同一套纪律。

function collectTypeRefs(node: unknown, under: string[], out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const entry of node) collectTypeRefs(entry, under, out);
    return;
  }
  if (!isRecord(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (!under.includes(key)) {
      collectTypeRefs(value, under, out);
      continue;
    }
    // `under` 命中键有两种形状：
    //   数组  `furniture_types: [tv_stand, wardrobe_240]` → 逐项收字符串；
    //   对象  `match: { type: tv_stand }`               → 收 value.type。
    // ⚠️ 必须显式加花括号：`if (a) for (..) if (b) s1; else s2;` 的 else 会绑到内层 if，
    //    导致对象形状永远不进 else 分支（本引擎首版的真实 bug，已由单测兜住）。
    if (Array.isArray(value)) {
      for (const one of value) if (typeof one === 'string') out.add(one);
    } else if (isRecord(value) && typeof value.type === 'string') {
      out.add(value.type);
    }
  }
}

function runTypeRef(ws: FactsWorkspace, result: FactsLintResult, lines: LineIndex, contract: Contract): void {
  const sources = stringList(contract.sources).length ? stringList(contract.sources) : [str(contract.source)];
  const under = stringList(contract.under);
  const target = str(contract.target);
  const targetDoc = ws.load(target);
  if (targetDoc === null || !under.length) return;
  const universe = new Set<string>();
  const targetPath = contract.target_path === undefined ? '' : str(contract.target_path);
  collectFieldValues(targetPath ? resolvePath(targetDoc, targetPath) : targetDoc, str(contract.key_field, 'type'), universe);
  const allowEntries = (Array.isArray(contract.allow) ? contract.allow : []).filter(isRecord);
  const allow = new Set<string>();
  for (const one of allowEntries) {
    const type = str(one.type);
    if (!type) continue;
    allow.add(type);
    if (!str(one.reason)) {
      add(result, issue('error', 'type_ref_allow_without_reason', `${contract.id}：type_ref allow 列表中的 ${type} 没有写 reason——豁免不许无理由`, sources[0]));
      tally(result, 'type_ref_allow_without_reason');
    }
  }
  for (const source of sources) {
    const doc = ws.load(source);
    if (doc === null) continue;
    const refs = new Set<string>();
    collectTypeRefs(doc, under, refs);
    for (const ref of [...refs].sort((a, b) => a.localeCompare(b, 'en'))) {
      if (universe.has(ref) || allow.has(ref)) continue;
      add(result, issue(
        contractLevel(contract),
        'type_ref_absent',
        `${contract.id}：${source} 引用了家具 type ${ref}，但 ${target} 的 ${targetPath || ''}.${str(contract.key_field, 'type')} 集合里没有它——该规则空转`,
        source,
      ));
      tally(result, 'type_ref_absent');
    }
  }
}

// ─── T3.12 supersede：作废字段必须显式标注退场 ────────────────────────────────
//
// 治「口径被旧值取代但没人宣告」：`config/budget/base.json` 的 total_budget /
// project_ceiling 早已不是现行口径，却没有任何字段这么说，于是 server 继续把它当活值读。
// 本契约要求作废文件**自己声明**退场（status / superseded_by / note），并且被指名的
// 新权威文件必须存在、确实带着活字段。
//
//   { id: c.x, kind: supersede, source: config/budget/base.json,
//     fields: [total_budget, project_ceiling],
//     superseded_by: schedule/phase-1/control.yaml, live_field: control.phase_ceiling_cny,
//     must_declare: [status, superseded_by, note] }

function runSupersede(ws: FactsWorkspace, result: FactsLintResult, contract: Contract): void {
  const source = str(contract.source);
  const doc = ws.load(source);
  if (doc === null) return;
  const fields = stringList(contract.fields);
  const mustDeclare = stringList(contract.must_declare);
  const supersededBy = str(contract.superseded_by);
  const level = contractLevel(contract);
  const record = isRecord(doc) ? doc : {};
  for (const field of fields) {
    if (record[field] === undefined) {
      add(result, issue(level, 'superseded_field_undeclared', `${contract.id}：作废字段 ${source}:${field} 不存在——退场标注与字段必须同在，否则档案不可审计`, source));
      tally(result, 'superseded_field_undeclared');
    }
  }
  for (const field of mustDeclare) {
    if (record[field] === undefined || record[field] === null || record[field] === '') {
      add(result, issue(level, 'supersede_undeclared', `${contract.id}：${source} 缺少退场声明字段 ${field}——作废口径必须自证 superseded`, source));
      tally(result, 'supersede_undeclared');
    }
  }
  if (supersededBy && str(record.superseded_by) !== supersededBy) {
    add(result, issue(level, 'supersede_authority_mismatch', `${contract.id}：${source}.superseded_by=${String(record.superseded_by)} 与本契约登记的 ${supersededBy} 不一致`, source));
    tally(result, 'supersede_authority_mismatch');
  }
  if (supersededBy) {
    const liveDoc = ws.load(supersededBy);
    if (liveDoc === null) {
      add(result, issue(level, 'supersede_authority_missing', `${contract.id}：被指名的现行权威 ${supersededBy} 不存在`, supersededBy));
      tally(result, 'supersede_authority_missing');
      return;
    }
    const liveField = str(contract.live_field);
    if (liveField && countOf(liveDoc, liveField) === undefined && resolvePath(liveDoc, liveField) === undefined) {
      add(result, issue(level, 'supersede_live_field_missing', `${contract.id}：现行权威 ${supersededBy} 没有活字段 ${liveField}`, supersededBy));
      tally(result, 'supersede_live_field_missing');
    }
  }
}

// ─── T4 覆盖层 ───────────────────────────────────────────────────────────────

function runCoverage(registry: FactsRegistry, ws: FactsWorkspace, result: FactsLintResult, lines: LineIndex): void {
  const entries = registry.coverage ?? [];
  const files = Array.isArray(ws.datasets?.['coverage.files']) ? stringList(ws.datasets?.['coverage.files']) : [];
  const registered = new Set<string>();
  for (const entry of entries) {
    for (const field of [...(entry.field ? [entry.field] : []), ...stringList(entry.fields)]) {
      registered.add(`${entry.file}::${field}`);
    }
  }
  for (const file of files) {
    const doc = ws.load(file);
    if (doc === null) continue;
    const topFields = Array.isArray(doc) ? ['*'] : Object.keys(isRecord(doc) ? doc : {});
    for (const field of topFields) {
      if (registered.has(`${file}::${field}`)) continue;
      const item = issue('warning', 'field_uncovered', `${file} 顶层字段 ${field} 未登记在 coverage 矩阵中`, `${file}:${field}`);
      add(result, item);
      tally(result, item.code);
    }
  }
  for (const entry of entries) {
    const fields = [...(entry.field ? [entry.field] : []), ...stringList(entry.fields)];
    for (const reader of stringList(entry.readers)) {
      const text = ws.read(reader);
      if (text === null) {
        const item = issue('error', 'declared_reader_does_not_read', `${entry.file} 登记的 reader ${reader} 不存在`, entry.file);
        add(result, item);
        tally(result, item.code);
        continue;
      }
      for (const field of fields) {
        if (field === '*') continue;
        const wordRe = tryRegex(`\\b${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
        if (wordRe !== undefined && wordRe.test(text)) continue;
        const item = issue(
          'error',
          'declared_reader_does_not_read',
          `${entry.file} 字段 ${field} 登记了 reader ${reader}，但该源文件从未出现这个字段名——覆盖矩阵说谎`,
          entry.file,
        );
        add(result, item);
        tally(result, item.code);
      }
    }
  }
}

/** 汇总所有登记在案的豁免；带 `pending` 的会在报告里以 INFO 单列，而不是静默消失。 */
function collectExemptions(registry: FactsRegistry): Exemption[] {
  const out: Exemption[] = [];
  for (const fact of registry.facts ?? []) {
    for (const entry of fact.exempt ?? []) out.push({ kind: 'fact', id: fact.id, entry });
  }
  for (const entry of registry.scan?.exempt_occurrences ?? []) out.push({ kind: 'scan', entry });
  return out;
}

// ─── T3.11 ceiling_clearance：MEP 路线标高不得低于所经吊顶完成面 ─────────────
//
// 治一个「静默缺失」：config/mep-hvac-coordination.yaml 的分层标高（强电 2.45 / 弱电 2.50 /
// 冷媒 2.55 / 冷凝水 2.35 …）与 config/ceiling.yaml 的降板完成面（2.80 − thickness）是两套
// 从未对齐的口径。修之前没有任何门禁看这件事——73 条路线照跑，谁也不说它穿出了吊顶。
//
// 完成面口径必须与 shared/render/CeilingZoneBuilder.ts 一致：
//   `topY = ceilingHeight − zone.thickness + SLAB_EPS`，板下表面即完成面；
//   ceilingHeight 取 `rooms.find(r => r.id === zone.room)?.height ?? 2.8`。
// 这里不读 config/ceiling.yaml 的 `height` 字段（本项目 drop/aluminum 条目没有该字段，
// 读了就永远 0 命中），一律按 thickness 反算。
//
// 处置原则（2026-10-04 A1）：
//   - severity: error —— 新增的、未登记的冲突一律是 error，不许静默过关；
//   - 既有冲突是**系统性口径未对齐**，根因是设计侧决策（分层标高升入降板空腔 or 调整降板），
//     不是逐条算错。因此登记一个 `registered_conflicts` 基数，并强制它与机器实算值相等：
//       实算 ≠ 登记  → error（两个方向都报：变多说明有人乱加路线，变少说明有人改数据消音）；
//       实算 ≠ prose → error（防止只改登记不改文档）。
//     冲突清单由引擎以 INFO 逐条列出，配 contract.pending 在报告里露面——
//     「0 命中」和「有冲突」都不可能悄悄腐烂。

const SOLID_CEILING_TYPES_FACTS = new Set(['drop', 'integrated', 'aluminum_buckle']);

// 2026-10-06 DEC-2026-10-06-R5：比较范围收窄为「吊顶承载层」。走地给排水分层
// （water_supply 0.18 / drainage 0.10）退出本比较——地面管与吊顶完成面无可比性，
// 原口径把 20 处地面管计入冲突、稀释真信号。授权来源与豁免量见
// config/facts.yaml c.mep_layer_below_drop_bottom.check_scope；其坡度/正交/禁直插
// 仍由 verify:mep 的 gravity_slope_geometry_mismatch / route_not_orthogonal 独立负责。
const CEILING_CARRIED_LAYERS_FACTS = new Set([
  'strong_power', 'weak_power', 'refrigerant', 'condensate', 'supply_air', 'return_air',
]);

interface CeilingClearanceZone { id: string; area: [number, number, number, number]; surface: number }
interface ClearancePoint { x: number; z: number; y?: number }

function inFootprintFacts(p: ClearancePoint, area: [number, number, number, number]): boolean {
  const [x1, z1, x2, z2] = area;
  return p.x >= Math.min(x1, x2) && p.x <= Math.max(x1, x2) && p.z >= Math.min(z1, z2) && p.z <= Math.max(z1, z2);
}

/** 复刻 shared/mep-hvac-coordination-schema.ts 的 mepRoutePoints：from + via + to，y 取 *route 的高度字段。 */
function clearanceRoutePoints(route: Record<string, unknown>, endpoints: Record<string, { x: number; z: number; y?: number }>): ClearancePoint[] {
  const pointOf = (endpoint: unknown): ClearancePoint | undefined => {
    if (typeof endpoint === 'string') return endpoints[endpoint];
    if (isRecord(endpoint) && typeof endpoint.x === 'number' && typeof endpoint.z === 'number') {
      return { x: endpoint.x, z: endpoint.z, y: typeof endpoint.y === 'number' ? endpoint.y : undefined };
    }
    return undefined;
  };
  const heights = (route as { from_height?: unknown; to_height?: unknown });
  const from = pointOf(route.from);
  const to = pointOf(route.to);
  const via = Array.isArray(route.via) ? route.via.filter(isRecord).map((v) => ({
    x: v.x as number,
    z: v.z as number,
    y: typeof v.y === 'number' ? (v.y as number) : undefined,
  })) : [];
  return [
    ...(from ? [{ ...from, y: typeof heights.from_height === 'number' ? heights.from_height : from.y }] : []),
    ...via,
    ...(to ? [{ ...to, y: typeof heights.to_height === 'number' ? heights.to_height : to.y }] : []),
  ];
}

function runCeilingClearance(ws: FactsWorkspace, result: FactsLintResult, lines: LineIndex, contract: Contract): void {
  const source = str(contract.source);
  const doc = ws.load(source);
  if (doc === null) {
    add(result, issue('error', 'ceiling_clearance_unresolvable', `${contract.id}：${source} 不可读`, source));
    tally(result, 'ceiling_clearance_unresolvable');
    return;
  }
  // items_path 为空串表示文档根就是数组（如 config/plumbing.yaml）。
  const routes = resolvePath(doc, str(contract.items_path));
  if (!Array.isArray(routes)) {
    add(result, issue('error', 'ceiling_clearance_unresolvable', `${contract.id}：${source} 的 items_path ${str(contract.items_path) || '(根)'} 不是数组`, source));
    tally(result, 'ceiling_clearance_unresolvable');
    return;
  }
  const ceiling = ws.load(str(contract.ceiling_source));
  if (!Array.isArray(ceiling)) {
    add(result, issue('error', 'ceiling_clearance_unresolvable', `${contract.id}：${str(contract.ceiling_source)} 不是数组`, str(contract.ceiling_source)));
    tally(result, 'ceiling_clearance_unresolvable');
    return;
  }
  const endpoints = (ws.datasets?.[str(contract.endpoints_key)] ?? {}) as Record<string, { x: number; z: number; y?: number }>;
  const roomHeights = (ws.datasets?.[str(contract.room_heights_key)] ?? {}) as Record<string, number>;
  const defaultRoomHeight = num(contract.default_room_height, 2.8);
  const tol = num(contract.tolerance, 0);

  // 路线自身没写 y 时，退回该分层的 layer.height——与 shared/mep-hvac-lint.ts 的
  // `p.y ?? layer?.height ?? 0` 同口径，否则 facts 契约与 verify:mep 会对同一条路线给出
  // 不同的冲突结论（未写 y 的点位在这里会被当成 0，平白多出一批假冲突）。
  const layerHeights = new Map<string, number>();
  const layersDoc = isRecord(doc) ? doc.layers : undefined;
  if (isRecord(layersDoc)) {
    for (const [name, spec] of Object.entries(layersDoc)) {
      if (isRecord(spec) && typeof spec.height === 'number') layerHeights.set(name, spec.height);
    }
  }

  const zones: CeilingClearanceZone[] = [];
  for (const raw of ceiling) {
    if (!isRecord(raw)) continue;
    const type = str(raw.type);
    if (!SOLID_CEILING_TYPES_FACTS.has(type)) continue;
    const thickness = raw.thickness;
    const area = raw.area;
    if (typeof thickness !== 'number' || thickness <= 0 || !Array.isArray(area) || area.length !== 4) continue;
    const roomHeight = roomHeights[str(raw.room)] ?? defaultRoomHeight;
    zones.push({ id: str(raw.id), area: area as [number, number, number, number], surface: roomHeight - thickness });
  }

  const conflicts: string[] = [];
  for (const route of routes) {
    if (!isRecord(route)) continue;
    if (typeof route.layer === 'string' && !CEILING_CARRIED_LAYERS_FACTS.has(route.layer)) continue;
    const points = clearanceRoutePoints(route, endpoints);
    if (!points.length) continue;
    const layerHeight = typeof route.layer === 'string' ? layerHeights.get(route.layer) : undefined;
    const yOf = (p: ClearancePoint): number => p.y ?? layerHeight ?? 0;
    for (const zone of zones) {
      if (!points.some((p) => inFootprintFacts(p, zone.area))) continue;
      // 同一个点必须**同时**满足「在 footprint 内」和「低于完成面」。
      // 曾经的写法把两条 some 分开扫，于是路线末端沿墙下引到 0.3m 插座的那一段
      // （坐标不在任何吊顶分区里）也被算成吊顶冲突——凭空多出 27 处假冲突。
      if (points.some((p) => inFootprintFacts(p, zone.area) && yOf(p) < zone.surface - tol)) conflicts.push(`${str(route.id)}@${zone.id}`);
    }
  }
  const actual = conflicts.length;
  note(result, `${contract.id}：实算 ${actual} 处「路线点位低于所经吊顶完成面」，涉及 ${new Set(conflicts.map((c) => c.split('@')[0])).size} 条路线 / ${new Set(conflicts.map((c) => c.split('@')[1])).size} 个吊顶分区（${[...new Set(conflicts.map((c) => c.split('@')[1]))].join('、')}）`);

  const prose = (Array.isArray(contract.prose) ? contract.prose : []).filter(isRecord);
  let checked = 0;
  for (const one of prose) {
    const path = str(one.path);
    const extract = str(one.extract);
    if (!path || !extract) continue;
    const hits = grep(ws, path, extract);
    const expect = typeof one.expect_matches === 'number' ? one.expect_matches : 1;
    if (hits.length !== expect) {
      add(result, issue('error', 'count_mirror_unresolvable', `${contract.id}：${path} 用 /${extract}/ 命中 ${hits.length} 次，期望 ${expect} 次——禁止静默跳过`, path));
      tally(result, 'count_mirror_unresolvable');
      continue;
    }
    const declared = toNumber(matchText(hits[0], typeof one.group === 'number' ? one.group : 1));
    checked += 1;
    if (!Number.isFinite(declared) || declared !== actual) {
      add(result, issue(
        contractLevel(contract),
        'count_mismatch',
        `${contract.id}：prose 声明 ${declared} 处，机器实算 ${actual} 处（${loc(lines, path, hits[0].index)}）——登记数与实算不符，禁止静默跳过`,
        loc(lines, path, hits[0].index),
      ));
      tally(result, 'count_mismatch');
    }
  }
  if (prose.length > 0 && checked === 0) {
    add(result, issue(contractLevel(contract), 'count_unregistered', `${contract.id}：实算 ${actual} 处冲突，但登记的 prose 计数声明无一可解析`, source));
    tally(result, 'count_unregistered');
  }

  const registered = typeof contract.registered_conflicts === 'number' ? contract.registered_conflicts : undefined;
  if (registered !== undefined && registered !== actual) {
    // 修正出口写进 error 正文：让人在失败现场就看到「正当修正长什么样」，
    // 而不是只收到一句禁令后自己猜能不能改。error 语义不变（仍 error）。
    const hint = repairChannelHint(contract);
    add(result, issue(
      contractLevel(contract),
      'ceiling_clearance_baseline_drift',
      `${contract.id}：登记的既有冲突基数 ${registered} ≠ 机器实算 ${actual}。只有两种合法解释：①设计侧真的裁定了（分层标高升入降板空腔 or 调整降板厚度，需同步更新 prose 与 registered_conflicts 并关闭 docs/pending-site-data.md #41）；②有人改数据消音。二者都必须是有意识的改动，git diff 里看得见${hint ? `。${hint}` : ''}`,
      source,
    ));
    tally(result, 'ceiling_clearance_baseline_drift');
  }
}

// ─── covered_or_marked：点位要么被引用，要么显式表态 ───────────────────────────
//
// 治「静默缺席」：一个点位躺在 config 里，没有任何 route 引用它，note 里也不说为什么——
// 水电交底时它就是「没人认领」的那一处。本项目给排水 22 个点位里曾有 11 个处在这个状态
// （既有正确先例是 drain_mbath_toilet：note 明写「本轮不画 MEP route，待 SKU + 量房」）。
//
// 本契约把「必须表态」变成门禁：每个点位要么出现在某条 route 的 from/to/via.id 里，
// 要么 note 里含显式 deferred 标记（`marker`，缺省即视为没表态）→ error。
// 新增一个既不画线也不登记的点位，立刻失败；把标记删掉，也立刻失败。

function collectReferencedIds(doc: unknown, itemsPath: string, refFields: string[]): Set<string> {
  const routes = resolvePath(doc, itemsPath);
  if (!Array.isArray(routes)) return new Set();
  const ids = new Set<string>();
  for (const route of routes) {
    if (!isRecord(route)) continue;
    for (const field of refFields) {
      const value = route[field];
      if (typeof value === 'string') { ids.add(value); continue; }
      if (Array.isArray(value)) {
        for (const entry of value) {
          if (typeof entry === 'string') { ids.add(entry); continue; }
          if (isRecord(entry) && typeof entry.id === 'string') ids.add(entry.id);
        }
      }
    }
  }
  return ids;
}

function runCoveredOrMarked(ws: FactsWorkspace, result: FactsLintResult, lines: LineIndex, contract: Contract): void {
  const source = str(contract.source);
  const doc = ws.load(source);
  if (doc === null) {
    add(result, issue('error', 'covered_or_marked_unresolvable', `${contract.id}：${source} 不可读`, source));
    tally(result, 'covered_or_marked_unresolvable');
    return;
  }
  const items = resolvePath(doc, str(contract.items_path));
  if (!Array.isArray(items)) {
    add(result, issue('error', 'covered_or_marked_unresolvable', `${contract.id}：${source} 的 items_path ${str(contract.items_path) || '(根)'} 不是数组`, source));
    tally(result, 'covered_or_marked_unresolvable');
    return;
  }
  const keyField = str(contract.key_field, 'id');
  const marker = str(contract.marker);
  const noteField = str(contract.note_field, 'note');
  const refSource = str(contract.ref_source);
  const refDoc = ws.load(refSource);
  if (refDoc === null) {
    add(result, issue('error', 'covered_or_marked_unresolvable', `${contract.id}：${refSource} 不可读`, refSource));
    tally(result, 'covered_or_marked_unresolvable');
    return;
  }
  const referenced = collectReferencedIds(refDoc, str(contract.ref_items_path), stringList(contract.ref_fields));
  let marked = 0;
  for (const item of items) {
    if (!isRecord(item)) continue;
    const id = str(item[keyField]);
    if (!id) continue;
    if (referenced.has(id)) continue;
    const note = str(item[noteField]);
    if (marker && note.includes(marker)) { marked += 1; continue; }
    add(result, issue(
      contractLevel(contract),
      'uncovered_and_unmarked',
      `${contract.id}：${source} 的 ${id} 既不是 ${refSource} 任何 route 的 from/to/via，note 里也没有显式 deferred 标记「${marker}」——静默缺席，必须表态`,
      locate(ws, source, id),
    ));
    tally(result, 'uncovered_and_unmarked');
  }
  note(result, `${contract.id}：${items.length} 个点位中 ${referenced.size > 0 ? '' : ''}${marked} 个以显式 deferred 标记登记（未画 route），其余由 ${refSource} 的 route 引用`);
}

// ─── repair_channel：契约的「正当修正出口」校验（T3 附加层）────────────────────
//
// 治一个「只有禁令、没有出路」的死角：像 c.mep_layer_below_drop_bottom 这类契约，根因是
// 设计侧口径未对齐，**只能**由设计侧裁定后修几何/降板才能消解。此前引擎对基线漂移只喊
// 「不许静默消音」，却从不说明「合规的修正长什么样」——于是每次有人动数据都像消音，
// 连带正当修正也不敢做（做了就被 error 挡住，只能偷偷改）。
//
// repair_channel 把出口显式登记成结构化字段：
//   decision_ref —— 修正必须附的 DEC 全引（编号族与 c.dec_ref_resolvable 一致：
//                   `DEC-YYYY-MM-DD-(nnn|Rnn)`）；裁定落地前允许 `pending:<待决入口>` 占位，
//                   与 exempt 的 pending 同纪律——在 INFO 里露面，不假装已有 DEC 背书。
//   sync_files   —— 该修正必须同步的文件清单（改一处必须连带同步其余，prose/登记表同改）。
//
// 引擎只做三件事：
//   ① 校验通道自身齐全：decision_ref 空 / 既非 DEC 全引又非 pending 占位 / sync_files 空 /
//      文件不存在 → repair_channel_invalid（error）。通道腐烂比没有通道更糟——
//      它会让人以为有出路可走，走出去才发现是墙。
//   ② 校验 DEC 全引**真的存在于决策日志**（登记表顶层 `decision_log_files` 列出的文件里
//      有同名 `### DEC-` 标题）→ repair_channel_ref_unresolvable（error）。只验格式等于
//      允许「指引人去查一条不存在的 DEC」；未登记 decision_log_files 时跳过并在 INFO 露面。
//   ③ 契约报出偏差时（目前接在 ceiling_clearance 的基线漂移上），把该出口写进 issue 正文，
//      并在 INFO 里登记。**不改变任何契约的 error 语义**：registered_conflicts ≠ 实算
//      仍是 error；通道回答「要改的话必须怎么改」，不提供免检。

export interface RepairChannel {
  /** DEC 全引，或 `pending:<指向待决入口的自由文本>` 占位。 */
  decision_ref: string;
  /** 修正必须同步的文件（仓库相对路径）。 */
  sync_files: string[];
}

const DEC_FULL_REF_RE = /^DEC-\d{4}-\d{2}-\d{2}-(?:\d{3}|R\d{1,3})$/;

/** decision_ref 指向的 DEC 是否真的作为条目存在于决策日志里。
 *  只认标题形态（`### DEC-…`），不认 prose 里的提及——否则「正文引用了一个已删编号」
 *  也会被判成存在。边界用 `(?![\w.\-])`：`DEC-…-R01` 不匹配 `R01.1`，`DEC-…-051` 不匹配
 *  `051-补`（基号不存在就是不存在，补号救不了它）。 */
function decisionRefResolves(ws: FactsWorkspace, files: string[], ref: string): boolean {
  const pattern = `^#{2,6}\\s*${escapeLiteral(ref)}(?![0-9A-Za-z.\\-_])`;
  return files.some((file) => grep(ws, file, pattern).length > 0);
}

function repairChannelOf(contract: Contract): RepairChannel | undefined {
  const raw = contract.repair_channel;
  if (!isRecord(raw)) return undefined;
  return { decision_ref: str(raw.decision_ref), sync_files: stringList(raw.sync_files) };
}

/** 报错时附在 issue 正文末尾的「正当修正出口」；通道未登记时返回空串（行为与从前一致）。 */
function repairChannelHint(contract: Contract): string {
  const channel = repairChannelOf(contract);
  if (!channel) return '';
  const files = channel.sync_files.length ? channel.sync_files.join('、') : '(未登记)';
  const ref = DEC_FULL_REF_RE.test(channel.decision_ref)
    ? channel.decision_ref
    : `DEC 全引（当前登记：${channel.decision_ref || '空'}）`;
  return `正当修正通道：附 ${ref} 修改设计侧几何/口径，并同步 ${files}；未附 DEC 的改动一律视为消音`;
}

function validateRepairChannel(ws: FactsWorkspace, result: FactsLintResult, contract: Contract, registry: FactsRegistry): void {
  const channel = repairChannelOf(contract);
  if (!channel) return;
  const { decision_ref, sync_files } = channel;
  const where = str(contract.source) || contract.id;
  if (!decision_ref) {
    add(result, issue('error', 'repair_channel_invalid', `${contract.id}：repair_channel.decision_ref 为空——正当修正必须挂 DEC 编号，无出处即无修正`, where));
    tally(result, 'repair_channel_invalid');
  } else if (!DEC_FULL_REF_RE.test(decision_ref) && !decision_ref.startsWith('pending:')) {
    add(result, issue(
      'error',
      'repair_channel_invalid',
      `${contract.id}：repair_channel.decision_ref「${decision_ref}」既不是 DEC 全引（DEC-YYYY-MM-DD-(nnn|Rnn)），也不是 pending: 占位——修正出处必须可解析`,
      where,
    ));
    tally(result, 'repair_channel_invalid');
  }
  if (!sync_files.length) {
    add(result, issue('error', 'repair_channel_invalid', `${contract.id}：repair_channel.sync_files 为空——修正必须登记要同步的文件，否则改完几何没人同步 prose 与登记表`, where));
    tally(result, 'repair_channel_invalid');
  }
  for (const file of sync_files) {
    if (ws.read(file) !== null) continue;
    add(result, issue('error', 'repair_channel_invalid', `${contract.id}：repair_channel.sync_files 中的 ${file} 不存在——登记出口腐烂`, where));
    tally(result, 'repair_channel_invalid');
  }
  // ③ DEC 全引必须真的存在于决策日志：只验格式等于允许「指引人去查一条不存在的 DEC」，
  //    而 error 正文会拿它当合规出路，腐烂的出路比没有出路更糟。
  //    决策日志文件清单来自登记表顶层 `decision_log_files`；未登记则跳过并在 INFO 露面
  //    （引擎是通用的，别的仓可能没有决策日志——但不许静默跳过）。
  const logFiles = stringList(registry.decision_log_files);
  if (DEC_FULL_REF_RE.test(decision_ref)) {
    if (!logFiles.length) {
      note(result, `contract ${contract.id} 修正通道未校验 DEC 存在性 — 登记表未声明 decision_log_files，跳过 ${decision_ref} 的存在性校验`);
    } else if (!decisionRefResolves(ws, logFiles, decision_ref)) {
      add(result, issue(
        'error',
        'repair_channel_ref_unresolvable',
        `${contract.id}：repair_channel.decision_ref「${decision_ref}」在决策日志里没有对应条目（已搜 ${logFiles.length} 个文件）——出口腐烂：error 正文会指引人去改一条不存在的 DEC。请修正编号，或先在决策日志登记该 DEC`,
        where,
      ));
      tally(result, 'repair_channel_ref_unresolvable');
    }
  }
  // 通道自身没报错才露面：待决占位与 exempt.pending 同纪律（INFO 单列，不假装已有 DEC）。
  const intact = sync_files.length > 0 && sync_files.every((f) => ws.read(f) !== null);
  if (!intact) return;
  if (decision_ref.startsWith('pending:')) {
    note(result, `contract ${contract.id} 修正通道待决 — ${decision_ref.slice('pending:'.length)}｜DEC 落地后须替换 decision_ref 并同步：${sync_files.join('、')}`);
  } else if (DEC_FULL_REF_RE.test(decision_ref)) {
    note(result, `contract ${contract.id} 修正通道已登记 — ${decision_ref}｜改设计侧必须同步：${sync_files.join('、')}`);
  }}

// ─── 入口 ────────────────────────────────────────────────────────────────────

export function lintFacts(registry: FactsRegistry, ws: FactsWorkspace): FactsLintResult {
  const result = emptyResult();
  const lines = new LineIndex(ws);
  runScan(registry, ws, result, lines);
  runFacts(registry, ws, result, lines);
  for (const contract of registry.contracts ?? []) {
    switch (contract.kind) {
      case 'unique': runUnique(ws, result, lines, contract); break;
      case 'fk': runFk(ws, result, lines, contract); break;
      case 'requires':
      case 'requires_when': runRequires(ws, result, lines, contract); break;
      case 'non_empty': runNonEmpty(ws, result, lines, contract); break;
      case 'mutex': runMutex(ws, result, lines, contract); break;
      case 'sum': runSum(ws, result, contract); break;
      case 'parity': runParity(ws, result, lines, contract); break;
      case 'overlap': runOverlap(ws, result, contract); break;
      case 'count': runCount(ws, result, lines, contract); break;
      case 'pointer': runPointer(ws, result, lines, contract); break;
      case 'type_ref': runTypeRef(ws, result, lines, contract); break;
      case 'supersede': runSupersede(ws, result, contract); break;
      case 'ceiling_clearance': runCeilingClearance(ws, result, lines, contract); break;
      case 'covered_or_marked': runCoveredOrMarked(ws, result, lines, contract); break;
      default: break;
    }
  }
  runCoverage(registry, ws, result, lines);
  // 带待决事项的豁免：必须在报告里显式露面（INFO 级），否则「挂着豁免等裁决」会退化成
  // 「没人记得还有这事」。warning 只留给真的对账失败， exempt 的待决状态走 INFO。
  for (const exemption of collectExemptions(registry)) {
    const { entry } = exemption;
    if (!entry.pending) continue;
    const scope = exemption.kind === 'fact' ? `fact ${exemption.id}` : 'scan';
    note(result, `${scope} 豁免待决 — ${entry.path} /${entry.pattern}/：${entry.reason}｜待决：${entry.pending}`);
  }
  // 同理：登记了但当前 0 命中的契约（词汇表尚未启用）也要露面，否则契约层会悄悄腐烂。
  for (const contract of registry.contracts ?? []) {
    if (contract.pending) note(result, `contract ${contract.id} 待决 — ${contract.pending}`);
  }
  // repair_channel 自校验：通道是「正当修正的登记出口」，它自己腐烂（缺字段/文件被删/
  // DEC 形状非法）比没有出口更糟——会让人以为有路可走。与豁免必须写 reason 同一纪律。
  for (const contract of registry.contracts ?? []) validateRepairChannel(ws, result, contract, registry);
  result.counts.errors = result.errors.length;
  result.counts.warnings = result.warnings.length;
  return result;
}

export function factsLintLevel(result: FactsLintResult): 'error' | 'warning' | 'ok' {
  return result.errors.length ? 'error' : result.warnings.length ? 'warning' : 'ok';
}
