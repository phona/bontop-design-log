/**
 * `docs/pending-site-data.md` 待决台账的结构化解析器。
 *
 * 设计约束：**markdown 表格仍是唯一人工编辑处**。本模块只读不改，产出结构化视图供
 * 状态派生与 agent 查询使用——不产生第二份真相（与 `config/facts.yaml` 的 mirror
 * 机制同思路）。台账里新增/关闭条目，结构化视图自动跟随，不需要人同步两处。
 *
 * 表格列：`| # | 数据项 | 填入文件 | 格式 | 当前值 | 精度 | 影响 |`，按主题分多张表。
 */

export interface PendingLedgerTarget {
  /** 台账指向的文件，如 `config/electrical.yaml`。 */
  file: string;
  /** 该文件里的具体条目 id（反引号内第一个 token），如 `sock_child_ac`。 */
  id?: string;
}

export interface PendingLedgerEntry {
  /** 台账编号，如 `42`；子项为 `3a`。 */
  ref: string;
  /** 数据项摘要（人读）。 */
  summary: string;
  /** 本条指向的文件/条目。 */
  targets: PendingLedgerTarget[];
  /** 精度列原值：inferred / pending / measured … */
  precision: string;
  /** 「卡在谁那」——从影响列提取；提不出时给整列截断。 */
  blockedBy: string;
  /** 所属小节标题（表格上方的 `##` 标题）。 */
  section: string;
}

export interface PendingLedger {
  entries: PendingLedgerEntry[];
  /** 指向「承载场景构件的文件」的 target 数——用于核对台账腐烂。 */
  elementBearingTargets: number;
}

/**
 * 承载场景构件的配置文件 → 3D userData.objectId 前缀。台账指向这些文件时要做存在性核对。
 * 与 `config/state-model.yaml` 的 `element_bearing_files` 是同一张表：那里是配置入口，
 * 这里是代码默认值；CLI 以配置为准读入后交由 `classifyTarget` 使用。
 */
export const ELEMENT_BEARING_FILES: Record<string, string> = {
  'config/electrical.yaml': 'electrical',
  'config/plumbing.yaml': 'plumbing',
  'config/ceiling.yaml': 'ceiling',
};

const ROW_RE = /^\|\s*(\d+[a-z]?)\s*\|/;
const HEADER_RE = /^\|\s*#\s*\|/;
const SECTION_RE = /^##\s+(.+)$/;
const FILE_RE = /((?:config|docs|schedule|shared|server|scripts)\/[\w./-]+\.(?:yaml|json|md|ts)|[\w-]+\.yaml)/g;

function splitRow(line: string): string[] {
  return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

/** 从「填入文件」列提取 (file, id) 对：每个路径后第一个反引号 token 视为它的 id。 */
export function extractTargets(fileCell: string): PendingLedgerTarget[] {
  const targets: PendingLedgerTarget[] = [];
  const matches = [...fileCell.matchAll(FILE_RE)];
  for (const [index, match] of matches.entries()) {
    const file = match[1].startsWith('config/') || match[1].includes('/') ? match[1] : `config/${match[1]}`;
    const from = (match.index ?? 0) + match[0].length;
    const until = index + 1 < matches.length ? (matches[index + 1].index ?? fileCell.length) : fileCell.length;
    const rest = fileCell.slice(from, until);
    // 一个文件路径后可能列多个 id（台账写法：`a`/`b`/`c`）。全部取出，交由
    // classifyTarget 区分元素 id 与 `type: xxx` 这类字段描述——含 `:`/空格的自然被滤掉。
    const ids = [...rest.matchAll(/`([^`]+)`/g)].map((item) => item[1].replace(/:$/, '').trim()).filter(Boolean);
    if (ids.length === 0) targets.push({ file });
    else for (const id of ids) targets.push({ file, id });
  }
  return targets;
}

/** 从「影响」列提取「卡在谁那」。提不出就返回整列截断，不猜。 */
export function extractBlockedBy(impactCell: string): string {
  const cleaned = impactCell.replace(/\*\*/g, '').trim();
  const anchored = cleaned.match(/卡在[^。；|]{0,120}/);
  if (anchored) return anchored[0];
  const owner = cleaned.match(/(待业主[^。；|]{0,60}|需业主[^。；|]{0,60}|待设计[^。；|]{0,60}|待现场[^。；|]{0,60}|待量房[^。；|]{0,60})/);
  if (owner) return owner[0];
  return cleaned.length > 120 ? `${cleaned.slice(0, 120)}…` : cleaned;
}

export function parsePendingLedger(markdown: string): PendingLedger {
  const lines = markdown.split('\n');
  const entries: PendingLedgerEntry[] = [];
  let section = '';
  for (const line of lines) {
    const sectionMatch = line.match(SECTION_RE);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }
    if (HEADER_RE.test(line)) continue;
    const rowMatch = line.match(ROW_RE);
    if (!rowMatch) continue;
    const cells = splitRow(line);
    // 台账有 7 列与 6 列两种表（6 列那张把精度并进了「当前值」）。两种都要解析——
    // 早期只认 7 列，静默漏掉 5 条待决项（#25–#29）。
    let ref: string;
    let summary: string;
    let fileCell: string;
    let precision: string;
    let impact: string;
    if (cells.length >= 7) {
      [ref, summary, fileCell, , , precision, impact] = cells;
    } else if (cells.length === 6) {
      [ref, summary, fileCell, , precision, impact] = cells;
      const leading = (precision ?? '').match(/^(measured|likely|inferred|pending|confirmed)/);
      precision = leading ? leading[1] : 'unspecified';
    } else {
      continue;
    }
    entries.push({
      ref,
      summary,
      targets: extractTargets(fileCell),
      precision: precision || 'unspecified',
      blockedBy: extractBlockedBy(impact),
      section,
    });
  }
  return {
    entries,
    elementBearingTargets: entries.reduce((sum, entry) => sum + entry.targets.filter((target) => target.file in ELEMENT_BEARING_FILES).length, 0),
  };
}

export type TargetBinding = 'bound' | 'type_reference' | 'unresolved';

/**
 * 判断台账 target 绑定到什么。台账用反引号同时标 **元素 id** 和 **类型/字段名**
 * （如 `config/ceiling.yaml \`ac_indoor\`` 指「所有 ac_indoor 条目」，不是某个 id），
 * 不区分就会把类型引用误报成「构件已不存在」。
 *   bound          = 配置里真有这个元素 id
 *   type_reference = 是该配置里的 type 取值，或含 `:`/空格的字段描述 → 不参与存在性核对
 *   unresolved     = 既不是已知 id 也不是已知 type → 台账腐烂或构件已删（真信号）
 */
export function classifyTarget(
  target: PendingLedgerTarget,
  knownElementIds: ReadonlySet<string>,
  knownTypes: ReadonlySet<string>,
): TargetBinding {
  if (!target.id) return 'type_reference';
  if (/[\s:]/.test(target.id)) return 'type_reference';
  const prefix = ELEMENT_BEARING_FILES[target.file];
  if (!prefix) return 'type_reference';
  if (knownElementIds.has(`${prefix}:${target.id}`)) return 'bound';
  if (knownTypes.has(target.id)) return 'type_reference';
  return 'unresolved';
}

export interface LedgerSummary {
  total: number;
  byPrecision: Record<string, number>;
  bySection: Record<string, number>;
  /** 台账里出现、但配置中已不存在的构件引用（腐烂信号）。 */
  dangling: Array<{ ref: string; file: string; id: string }>;
}

/**
 * 核对台账指向的构件是否仍存在于配置。**只核对承载场景构件的文件**——指向
 * procurement/materials/schedule/budget 的条目本来就不绑定场景构件，不算腐烂。
 */
export function summarizeLedger(
  ledger: PendingLedger,
  knownElementIds: ReadonlySet<string>,
  knownTypes: ReadonlySet<string> = new Set(),
): LedgerSummary {
  const byPrecision: Record<string, number> = {};
  const bySection: Record<string, number> = {};
  const dangling: LedgerSummary['dangling'] = [];
  for (const entry of ledger.entries) {
    byPrecision[entry.precision] = (byPrecision[entry.precision] ?? 0) + 1;
    bySection[entry.section || '(未分节)'] = (bySection[entry.section || '(未分节)'] ?? 0) + 1;
    for (const target of entry.targets) {
      if (classifyTarget(target, knownElementIds, knownTypes) === 'unresolved') {
        dangling.push({ ref: entry.ref, file: target.file, id: target.id! });
      }
    }
  }
  return { total: ledger.entries.length, byPrecision, bySection, dangling };
}
