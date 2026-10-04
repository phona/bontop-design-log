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
export interface ScanExempt { path: string; scalars?: string[]; pattern: string; reason: string }
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

export interface FactExempt { path: string; pattern: string; reason: string }

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

export type ContractKind = 'unique' | 'fk' | 'requires' | 'non_empty' | 'mutex' | 'sum' | 'parity' | 'overlap';

export interface Contract {
  id: string;
  kind: ContractKind;
  severity?: FactsLintLevel;
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
  if (op === 'bbox_area') return round4(bboxArea(polygonOf(current, vertexTable(doc))));
  if (op === 'shoelace') return round4(shoelace(polygonOf(current, vertexTable(doc))));
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

/** 契约层的文件全集；入口注入 `contract.files`，缺省时退回 `scan.files`。 */
function contractPaths(ws: FactsWorkspace, spec: unknown, datasetsKey: string): string[] {
  const prefixes = stringList(spec);
  if (!prefixes.length) return [];
  const fromKey = ws.datasets?.[datasetsKey];
  const universe = Array.isArray(fromKey)
    ? stringList(fromKey)
    : Array.isArray(ws.datasets?.['scan.files']) ? stringList(ws.datasets?.['scan.files']) : [];
  return universe.filter((file) => prefixes.some((p) => pathMatches(p, file)));
}

/** T3.1 unique：pattern 首捕为 id；allow_suffix 命中的视为补充条目，不与正牌判重。 */
function runUnique(ws: FactsWorkspace, result: FactsLintResult, lines: LineIndex, contract: Contract): void {
  const source = str(contract.source);
  if (!source) return;
  const text = ws.read(source);
  if (text === null) return;
  const suffixes = stringList(contract.allow_suffix);
  const norm = (id: string, at: number): { base: string; supplement: boolean } => {
    for (const suffix of suffixes) {
      if (id.endsWith(suffix)) return { base: id.slice(0, -suffix.length), supplement: true };
    }
    // 捕获组不含 CJK 后缀（如 `-补`），但标题正文紧跟其后：看匹配之后是否接着后缀。
    const tail = text.slice(at + id.length, at + id.length + 8);
    if (suffixes.some((suffix) => tail.startsWith(suffix))) return { base: id, supplement: true };
    return { base: id, supplement: false };
  };
  const groups = new Map<string, Array<{ id: string; at: number }>>();
  for (const m of grep(ws, source, str(contract.pattern))) {
    const id = matchText(m, 1);
    const at = m.index + Math.max(0, m[0].indexOf(id)); // m.index 是整段匹配起点，id 可能不从 0 开始
    const { base } = norm(id, at);
    const bucket = groups.get(base) ?? [];
    bucket.push({ id, at });
    groups.set(base, bucket);
  }
  for (const [base, entries] of groups) {
    const plain = entries.filter((e) => !norm(e.id, e.at).supplement);
    if (plain.length > 1) {
      for (const dup of plain.slice(1)) {
        const item = issue(
          contractLevel(contract),
          'duplicate_id',
          `${contract.id}：${source} 中 id ${base} 重复 ${plain.length} 次（正牌 ${plain.length} 次），重号位置 ${loc(lines, source, dup.at)}`,
          loc(lines, source, dup.at),
        );
        add(result, item);
        tally(result, item.code);
      }
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
  const target = str(contract.target);
  const fullText = new Map<string, string>();
  for (const m of grep(ws, target, str(contract.target_pattern))) fullText.set(matchText(m, 1), m[0]);
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
  for (const file of contractPaths(ws, contract.ref_scope, 'contract.files')) {
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
    emit('dangling_reference', id, sites, `在 ${target} 中无对应条目`);
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

function collectMatches(node: unknown, field: string, equals: unknown, out: Array<Record<string, unknown>>): void {
  if (Array.isArray(node)) {
    for (const entry of node) collectMatches(entry, field, equals, out);
    return;
  }
  if (!isRecord(node)) return;
  if (node[field] === equals) out.push(node);
  for (const value of Object.values(node)) collectMatches(value, field, equals, out);
}

/** T3.3 requires：path 里所有 field==equals 的对象，同级必须带齐 then 字段。 */
function runRequires(ws: FactsWorkspace, result: FactsLintResult, lines: LineIndex, contract: Contract): void {
  const path = str(contract.path);
  const doc = ws.load(path);
  if (doc === null) return;
  const when = isRecord(contract.when) ? contract.when : {};
  const field = str(when.field);
  const equals = when.equals;
  const then = stringList(contract.then);
  if (!field || !then.length) return;
  const hits: Array<Record<string, unknown>> = [];
  collectMatches(doc, field, equals, hits);
  for (const hit of hits) {
    const missing = then.filter((key) => hit[key] === undefined || hit[key] === null);
    if (!missing.length) continue;
    const id = typeof hit.id === 'string' ? hit.id : '(无 id)';
    const item = issue(
      contractLevel(contract),
      'required_field_missing',
      `${contract.id}：${path} 中 ${field}=${String(equals)} 的 ${id} 缺少 ${missing.join('、')}`,
      path,
    );
    add(result, item);
    tally(result, item.code);
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
  const scope = contractPaths(ws, contract.scope, 'contract.files');
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
      case 'requires': runRequires(ws, result, lines, contract); break;
      case 'non_empty': runNonEmpty(ws, result, lines, contract); break;
      case 'mutex': runMutex(ws, result, lines, contract); break;
      case 'sum': runSum(ws, result, contract); break;
      case 'parity': runParity(ws, result, lines, contract); break;
      case 'overlap': runOverlap(ws, result, contract); break;
      default: break;
    }
  }
  runCoverage(registry, ws, result, lines);
  result.counts.errors = result.errors.length;
  result.counts.warnings = result.warnings.length;
  return result;
}

export function factsLintLevel(result: FactsLintResult): 'error' | 'warning' | 'ok' {
  return result.errors.length ? 'error' : result.warnings.length ? 'warning' : 'ok';
}
