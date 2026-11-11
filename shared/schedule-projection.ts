/**
 * 施工排程投影（issue #202 切片 B；设计依据 docs/schedule-coordination-design.md §2.1 / §4 / §6.1 / §10）。
 *
 * 纯函数模块，与 shared/flow-layout.ts 同宗：不碰 fs、不碰 DOM、同输入必得同输出。
 * 输入是 schedule/phase-1/control.yaml 的声明值（包/依赖/工期/约束/工作日历）加
 * loader 从 audit_log 派生的实际窗口，输出是纯计算出的投影；本模块不读文件、不写状态。
 * UI 不 import 本模块做计算（设计 §4：UI 只消费快照里的结果，第二套排程实现即第二权威源）。
 *
 * 时间模型（设计 §3）：所有位置以「自排程零点起第 N 个工作日」（1-based，下文记作 ord）。
 * - ord 1 = 锚点当天或之后第一个工作日；锚点之前的工作日依次为 ord 0、-1、-2…（设计 §14/B3）。
 * - baseline：声明依赖 + 声明工期区间，min/max 各做一遍前向传播（乐观/保守），不存。
 * - forecast：同样两遍，但已有实际窗口的包钉死在实际窗口，其后继从实际末端起算。
 * - scenario（what-if）：在 forecast 基础上给点名的包加工期，只重算拓扑下游。
 * - 实际窗口由 loader 以真实日期给入（{start_date, end_date}，YYYY-MM-DD）：本模块用同一张
 *   工作日历把它映射成 ord，ordinals 覆盖 [minOrd, maxOrd]——向后到最早的实际日期（可为负
 *   ord），向前到基线/预测/实际的最晚末端，任何真实日期都不因「地平线外」被丢弃。
 *
 * 日期映射规则（约束与实际窗口同一条）：落在非工作日的日期取「当天或之后第一个工作日」；
 * 工作日判定顺序见 createCalendarCursor（rest_dates 优先，其次 extra_workdates，再看 workdays）。
 *
 * 单 start_ord 的口径（ProjectedWindow 只有三个字段）：start_ord 取 min 口径（乐观）
 * 那一遍的起点，end_ord_min 取 min 口径的末端，end_ord_max 取 max 口径的末端。
 * 因此区间 [start_ord, end_ord_max] 是「最早可能开工 → 最晚可能完工」的全不确定区间，
 * 甘特的区间条与冲突检测都用这个区间（设计 §7「min/max 画区间条不是单值条」）。
 *
 * 约束（设计 §2.1(b)）：只有 type === 'not_before'、status === 'resolved'、date 非空
 * 且 calendar.anchor_date 非 null 的约束参与计算，把该包 start_ord 抬到不早于该 date
 * 对应的 ord（date 落在休息日时取当天或之后第一个工作日）。not_after / time_window 在
 * MVP 只登记不生效。
 *
 * 锚点为 null 的执行口径（设计 §14/B5）：没有锚点就没有真实日期坐标系，本模块不做任何
 * 名义纪元（1970-01-01）映射——resolved 的 not_before 直接跳过抬升（loader 报
 * constraint_resolved_without_anchor）；带真实日期的 actual_windows 直接判
 * invalid_actual_window，不把 1970 序数交付给消费者。
 *
 * 侧车道：sequence >= 900 的包（PKG-900）由调用方过滤（设计 §4）；本模块不特判，
 * 传进来按普通包计算，不会崩，也不会被静默丢弃。PKG-900 的真实声明是
 * duration_workdays {min: 0, max: 0}（硬装预备金，不进行任何施工），零工期一律按
 * 「零工作日里程碑」处理：start_ord = end_ord，不占 ord，也不推后任何后继包。
 *
 * 错误（fail-closed，全部抛 ProjectionError，code 供 loader 映射到 §2.1(d) 的错误码）：
 * unknown_dependency / self_dependency / dependency_cycle（DAG）、invalid_duration、
 * invalid_actual_window / unknown_actual_window_package、invalid_calendar /
 * calendar_date_conflict / work_calendar_empty / work_calendar_exhausted / invalid_date、
 * unknown_scenario_package / invalid_delay、unknown_coordination_package。
 * validateDag 按契约返回中文错误串而不抛错，projectSchedule 用第一条 issue 的 code 抛。
 */

const MS_PER_DAY = 86_400_000;

/**
 * 无锚点时的名义纪元（1970-01-01，周四）。
 * 只用于「没有锚点时的 ord→date 占位表」，让 ordinals 的形状保持确定性；**不得**用它把
 * 任何真实日期（约束日期 / 实际窗口）映射成 ord（设计 §14/B5：1970 序数不是可交付坐标）。
 * UI 不得把名义纪元的日期显示给用户——anchor_date 为空时只显示「第 N 工作日」，
 * ordinals 的 date 置 null 由 loader 负责（设计 §3「未知保持未知，不造年月日」）。
 */
const NOMINAL_EPOCH = '1970-01-01';

export interface ProjectionPackage {
  id: string;
  sequence: number;
  dependencies: string[];
  duration_workdays: { min: number; max: number };
}
export interface ProjectionConstraint {
  id: string; type: "not_before" | "not_after" | "time_window"; status: string; date: string | null; detail?: string;
}
export interface ProjectionCalendar {
  workdays: number[];        // 0=周日 … 6=周六
  rest_dates: string[];      // YYYY-MM-DD
  extra_workdates: string[]; // YYYY-MM-DD
  anchor_date: string | null;
}
/** 投影输出里的实际窗口（ord 坐标；锚点前的工作日为 0 / 负值，设计 §14/B3）。 */
export interface ProjectionActualWindow { start_ord: number; end_ord: number; }
/** 实际窗口的模块输入：真实日期（本模块经工作日历映射成 ord）。 */
export interface ProjectionActualDates { start_date: string; end_date: string; }
export interface ProjectionInput {
  packages: ProjectionPackage[];
  calendar: ProjectionCalendar;
  constraints?: Record<string, ProjectionConstraint[]>;  // key = PKG id
  actual_windows?: Record<string, ProjectionActualDates>; // key = PKG id；日期须为 YYYY-MM-DD
  scenario?: { delay: Array<{ pkg: string; workdays: number }> };
}
export interface ProjectedWindow { start_ord: number; end_ord_min: number; end_ord_max: number; }
export interface ProjectedPackage {
  baseline: ProjectedWindow;
  forecast: ProjectedWindow;
  actual: ProjectionActualWindow | null;
}
export interface ScheduleProjection {
  ordinals: Array<{ ord: number; date: string | null }>;
  packages: Record<string, ProjectedPackage>;
  scenario: { overrides: Array<{ pkg: string; workdays: number }>; affected: Array<{ pkg: string; delta: number }> } | null;
}

export class ProjectionError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ProjectionError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// 日期算术：一律走 UTC 天序号，避开本地时区与夏令时
// ---------------------------------------------------------------------------

/** YYYY-MM-DD → 自 1970-01-01 起的天序号。严格校验格式与真实存在（拒绝 2026-02-30）。 */
function parseIsoDate(text: string, label: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    throw new ProjectionError('invalid_date', `${label} 的日期非法：${JSON.stringify(text)}（须为 YYYY-MM-DD）`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const dayOfMonth = Number(match[3]);
  const stamp = Date.UTC(year, month - 1, dayOfMonth);
  const probe = new Date(stamp);
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== dayOfMonth) {
    throw new ProjectionError('invalid_date', `${label} 的日期不存在：${text}`);
  }
  return stamp / MS_PER_DAY;
}

/** 天序号 → YYYY-MM-DD。 */
function formatIsoDay(dayIndex: number): string {
  const date = new Date(dayIndex * MS_PER_DAY);
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dayOfMonth = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${dayOfMonth}`;
}

/** 天序号 → 星期（0=周日 … 6=周六）。 */
function weekdayOfDay(dayIndex: number): number {
  return new Date(dayIndex * MS_PER_DAY).getUTCDay();
}

// ---------------------------------------------------------------------------
// 工作日历展开：ord ↔ date 双向映射
// ---------------------------------------------------------------------------

interface CalendarCursor {
  /** 至少展开到 targetOrd 个正向工作日（ord ≥ 1）。 */
  ensure(targetOrd: number): void;
  /** ord（任意整数，0 / 负值表示锚点前的工作日）→ YYYY-MM-DD。 */
  dateOf(ord: number): string;
  /** 某日期当天或之后第一个工作日的 ord（约束日期与实际窗口落在休息日时向后取）。 */
  ordForDate(text: string, label?: string): number;
}

/**
 * 从纪元（anchor_date，缺省名义纪元）起逐日推进，只数工作日，ord 从 1 连续编号。
 * 判定顺序：rest_dates 命中 → 非工作日（优先于 workdays）；extra_workdates 命中 → 工作日；
 * 否则看 weekday 是否在 workdays 内。rest_dates 与 extra_workdates 同一日期冲突时直接报错，
 * 不做静默取舍（两种声明都想说了算，任何一边赢都是丢事实）。
 */
function createCalendarCursor(calendar: ProjectionCalendar): CalendarCursor {
  const workdays = new Set<number>();
  for (const weekday of calendar.workdays) {
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new ProjectionError('invalid_calendar', `workdays 含非法星期值 ${weekday}（须为 0..6 的整数，0=周日）`);
    }
    workdays.add(weekday);
  }

  const restDates = new Set<number>();
  for (const text of calendar.rest_dates) {
    restDates.add(parseIsoDate(text, 'rest_dates'));
  }
  const extraWorkdates = new Set<number>();
  for (const text of calendar.extra_workdates) {
    const day = parseIsoDate(text, 'extra_workdates');
    if (restDates.has(day)) {
      throw new ProjectionError(
        'calendar_date_conflict',
        `日期 ${text} 同时出现在 rest_dates 与 extra_workdates 中，工作日历自相矛盾`,
      );
    }
    extraWorkdates.add(day);
  }

  if (workdays.size === 0 && extraWorkdates.size === 0) {
    throw new ProjectionError('work_calendar_empty', '工作日历没有任何工作日（workdays 与 extra_workdates 均为空），无法展开序数');
  }

  const epochDay = parseIsoDate(calendar.anchor_date ?? NOMINAL_EPOCH, 'anchor_date');

  const isWorkday = (day: number): boolean => {
    if (restDates.has(day)) return false;
    return extraWorkdates.has(day) || workdays.has(weekdayOfDay(day));
  };

  // days[ord - 1] = 该 ord 对应的天序号（ord ≥ 1）；随 ensure() 单调增长
  const days: number[] = [];
  let cursorDay = epochDay;

  // 负序数展开（设计 §14/B3）：backwardDays[0] = ord 0（ord 1 之前最后一个工作日），
  // backwardDays[k] = ord -k；严格递减，天序号与正向 days 不重叠。两个游标互相独立。
  const backwardDays: number[] = [];
  let backwardCursorDay = epochDay;

  const scanLimitFor = (targetOrd: number): number => 7 * (targetOrd + restDates.size + 1) + 7;

  const ensure = (targetOrd: number): void => {
    if (!Number.isInteger(targetOrd) || targetOrd < 0) {
      throw new ProjectionError('invalid_ordinal', `工作日序数必须是非负整数（收到 ${targetOrd}）`);
    }
    const scanLimit = scanLimitFor(targetOrd);
    while (days.length < targetOrd) {
      if (isWorkday(cursorDay)) {
        days.push(cursorDay);
      }
      cursorDay += 1;
      if (days.length < targetOrd && cursorDay - epochDay > scanLimit) {
        throw new ProjectionError(
          'work_calendar_exhausted',
          `已扫描 ${cursorDay - epochDay} 天只得到 ${days.length} 个工作日，无法达到序数 ${targetOrd}（检查 rest_dates 是否把工作日全部吃掉）`,
        );
      }
    }
  };

  /** 向后至少展开 count 个工作日（ord 0 起），供 ordinals 的负序数段与 dateOf(ord ≤ 0) 用。 */
  const ensureBackward = (count: number): void => {
    if (!Number.isInteger(count) || count < 0) {
      throw new ProjectionError('invalid_ordinal', `向后展开的工作日个数必须是非负整数（收到 ${count}）`);
    }
    const scanLimit = scanLimitFor(count);
    const startDay = backwardCursorDay;
    while (backwardDays.length < count) {
      backwardCursorDay -= 1;
      if (isWorkday(backwardCursorDay)) backwardDays.push(backwardCursorDay);
      if (backwardDays.length < count && startDay - backwardCursorDay > scanLimit) {
        throw new ProjectionError(
          'work_calendar_exhausted',
          `锚点前已扫描 ${startDay - backwardCursorDay} 天只得到 ${backwardDays.length} 个工作日，无法达到序数 ${1 - count}（检查 rest_dates 是否把工作日全部吃掉）`,
        );
      }
    }
  };

  const dateOf = (ord: number): string => {
    if (!Number.isInteger(ord)) {
      throw new ProjectionError('invalid_ordinal', `工作日序数必须是整数（收到 ${ord}）`);
    }
    if (ord >= 1) {
      ensure(ord);
      const day = days[ord - 1];
      if (day === undefined) {
        throw new ProjectionError('invalid_ordinal', `序数 ${ord} 超出工作日历展开范围`);
      }
      return formatIsoDay(day);
    }
    ensureBackward(1 - ord);
    const day = backwardDays[-ord];
    if (day === undefined) {
      throw new ProjectionError('invalid_ordinal', `序数 ${ord} 超出工作日历向后展开范围`);
    }
    return formatIsoDay(day);
  };

  /**
   * 真实日期 → ord：取「当天或之后第一个工作日」。
   * - 不早于 ord 1 的日期：自 ord 1 向前数（原口径不变）；
   * - 早于 ord 1 的日期：自 ord 1 向后数，得到 ord 0、-1、-2…（设计 §14/B3：锚点前的
   *   实际日期必须有负序数，不得因「地平线外」丢弃）。
   */
  const ordForDate = (text: string, label = 'constraint.date'): number => {
    const targetDay = parseIsoDate(text, label);
    ensure(1);
    const firstWorkday = days[0];
    if (firstWorkday === undefined) {
      // createCalendarCursor 已保证至少一个工作日，这里只防御内部错位
      throw new ProjectionError('work_calendar_empty', '工作日历未能展开出任何工作日');
    }
    if (targetDay >= firstWorkday) {
      for (let ord = 1; ; ord += 1) {
        ensure(ord);
        if (days[ord - 1] >= targetDay) return ord;
      }
    }
    // 目标日期早于 ord 1：向后扫描。backwardDays 严格递减，我们要「≥ targetDay 的最小
    // ord」，即向后看最后一个仍 ≥ targetDay 的工作日（索引 k 对应 ord -k）。
    let index = 0;
    while (true) {
      if (index >= backwardDays.length) {
        while (true) {
          backwardCursorDay -= 1;
          if (backwardCursorDay < targetDay) {
            // [targetDay, ord 1) 内没有工作日：第一个工作日就是 ord 1
            return index === 0 ? 1 : 1 - index;
          }
          if (isWorkday(backwardCursorDay)) break;
        }
        backwardDays.push(backwardCursorDay);
      }
      if (backwardDays[index] < targetDay) {
        return index === 0 ? 1 : 1 - index;
      }
      index += 1;
    }
  };

  return { ensure, dateOf, ordForDate };
}

// ---------------------------------------------------------------------------
// DAG：未知依赖 / 自依赖 / 跨包环
// ---------------------------------------------------------------------------

type DagIssueCode = 'unknown_dependency' | 'self_dependency' | 'dependency_cycle';

interface DagIssue {
  code: DagIssueCode;
  message: string;
}

/** 依赖按 id 排序，保证同一输入下环路径与报错顺序确定。 */
function sortedDependencies(pkg: ProjectionPackage): string[] {
  return [...(pkg.dependencies ?? [])].sort((left, right) => left.localeCompare(right));
}

/**
 * 把环旋转到最小 id 开头，避免同一个环因遍历起点不同产出多条报错。
 * 最后一个重复的闭合元素不参与旋转。
 */
function canonicalizeCycle(cycleWithTail: string[]): { key: string; path: string[] } {
  const nodes = cycleWithTail.slice(0, -1);
  let smallest = 0;
  for (let index = 1; index < nodes.length; index += 1) {
    if (nodes[index] < nodes[smallest]) smallest = index;
  }
  const rotated = [...nodes.slice(smallest), ...nodes.slice(0, smallest)];
  return { key: rotated.join('>'), path: [...rotated, rotated[0]] };
}

function analyzeDag(packages: ProjectionPackage[]): DagIssue[] {
  const byId = new Map(packages.map((pkg) => [pkg.id, pkg]));
  const issues: DagIssue[] = [];

  for (const pkg of packages) {
    for (const dependency of sortedDependencies(pkg)) {
      if (dependency === pkg.id) {
        issues.push({ code: 'self_dependency', message: `${pkg.id}: 自依赖` });
      } else if (!byId.has(dependency)) {
        issues.push({ code: 'unknown_dependency', message: `${pkg.id}: 未知依赖 ${dependency}` });
      }
    }
  }

  // 三色 DFS：visiting 命中 = 回边 = 环。环必须显形（设计 §2.1(d)），不指望调用方兜底。
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  const seenCycles = new Set<string>();

  const visit = (id: string): void => {
    state.set(id, 'visiting');
    stack.push(id);
    const pkg = byId.get(id);
    for (const dependency of pkg ? sortedDependencies(pkg) : []) {
      if (!byId.has(dependency) || dependency === id) continue; // 已在上面按未知/自依赖报过
      const mark = state.get(dependency);
      if (mark === 'visiting') {
        const start = stack.indexOf(dependency);
        const cycle = [...stack.slice(start), dependency];
        const { key, path } = canonicalizeCycle(cycle);
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          issues.push({ code: 'dependency_cycle', message: `依赖环: ${path.join(' → ')}` });
        }
      } else if (mark !== 'done') {
        visit(dependency);
      }
    }
    stack.pop();
    state.set(id, 'done');
  };

  for (const id of [...byId.keys()].sort((left, right) => left.localeCompare(right))) {
    if (!state.has(id)) visit(id);
  }

  return issues;
}

/**
 * DAG 校验（契约出口）：无错返回空数组。
 * 文案沿用 shared/schedule-state.ts 的既有形态：`包 id: 说明`；环以「依赖环: A → B → A」显形。
 */
export function validateDag(packages: ProjectionPackage[]): string[] {
  return analyzeDag(packages).map((issue) => issue.message);
}

/**
 * 拓扑序（依赖先行）。同层按 sequence、再按 id 排序，保证输出确定。
 * 调用方须先过 validateDag；这里仍做一次长度核对，环绝不许静默漏过。
 */
function topologicalOrder(packages: ProjectionPackage[]): ProjectionPackage[] {
  const byId = new Map(packages.map((pkg) => [pkg.id, pkg]));
  const pending = new Map<string, number>();
  const dependants = new Map<string, string[]>();
  for (const pkg of packages) {
    pending.set(pkg.id, 0);
    dependants.set(pkg.id, []);
  }
  for (const pkg of packages) {
    for (const dependency of pkg.dependencies ?? []) {
      if (!byId.has(dependency) || dependency === pkg.id) continue; // validateDag 已拦截
      pending.set(pkg.id, (pending.get(pkg.id) ?? 0) + 1);
      dependants.get(dependency)?.push(pkg.id);
    }
  }

  const compare = (left: ProjectionPackage, right: ProjectionPackage): number =>
    left.sequence - right.sequence || left.id.localeCompare(right.id);

  const ready = packages.filter((pkg) => pending.get(pkg.id) === 0).sort(compare);
  const order: ProjectionPackage[] = [];
  while (ready.length > 0) {
    const pkg = ready.shift();
    if (!pkg) break;
    order.push(pkg);
    for (const childId of dependants.get(pkg.id) ?? []) {
      const remaining = (pending.get(childId) ?? 0) - 1;
      pending.set(childId, remaining);
      if (remaining === 0) {
        const child = byId.get(childId);
        if (child) ready.push(child);
        ready.sort(compare);
      }
    }
  }

  if (order.length !== packages.length) {
    throw new ProjectionError('dependency_cycle', '依赖图仍含环，拓扑排序失败（validateDag 未拦截）');
  }
  return order;
}

// ---------------------------------------------------------------------------
// 前向传播（min / max 各一遍）
// ---------------------------------------------------------------------------

interface PassWindow {
  start: number;
  end: number;
}

interface ForwardPassOptions {
  order: ProjectionPackage[];
  durations: Map<string, { min: number; max: number }>;
  /** 实际窗口：命中即钉死，两个口径都取实际值；null = 基线口径。 */
  actualWindows: Record<string, ProjectionActualWindow> | null;
  /** 包 id → 约束抬起后的最早 start_ord。 */
  constraintFloor: Map<string, number>;
  useMaxDuration: boolean;
}

function forwardPass(options: ForwardPassOptions): Map<string, PassWindow> {
  const windows = new Map<string, PassWindow>();
  for (const pkg of options.order) {
    const actual = options.actualWindows?.[pkg.id];
    if (actual) {
      // 已完成包是事实：实际窗口压过依赖、约束与 scenario（forecast 口径才传 actualWindows）
      windows.set(pkg.id, { start: actual.start_ord, end: actual.end_ord });
      continue;
    }

    let start = 1;
    for (const dependency of pkg.dependencies ?? []) {
      const dependencyWindow = windows.get(dependency);
      if (!dependencyWindow) {
        throw new ProjectionError(
          'internal_order_error',
          `${pkg.id}: 依赖 ${dependency} 未在拓扑序中先行计算`,
        );
      }
      start = Math.max(start, dependencyWindow.end + 1);
    }
    start = Math.max(start, options.constraintFloor.get(pkg.id) ?? 1);

    const duration = options.durations.get(pkg.id);
    if (!duration) {
      throw new ProjectionError('internal_order_error', `${pkg.id}: 缺少工期声明`);
    }
    const length = options.useMaxDuration ? duration.max : duration.min;
    // 零工期 = 不占工作日的里程碑（PKG-900 硬装预备金是真实先例）：
    // 若照 end = start - 1 会造出 start > end 的非法窗口，也会把后继包错前移。
    const end = length === 0 ? start : start + length - 1;
    windows.set(pkg.id, { start, end });
  }
  return windows;
}

/** 拓扑下游（至少一条依赖边可达；被点名的包只有在上游也有 delay 时才作为下游出现）。 */
function collectDownstream(order: ProjectionPackage[], roots: string[]): Set<string> {
  const dependants = new Map<string, string[]>();
  for (const pkg of order) {
    for (const dependency of pkg.dependencies ?? []) {
      const list = dependants.get(dependency) ?? [];
      list.push(pkg.id);
      dependants.set(dependency, list);
    }
  }
  const downstream = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) break;
    for (const childId of dependants.get(id) ?? []) {
      if (downstream.has(childId)) continue;
      downstream.add(childId);
      queue.push(childId);
    }
  }
  return downstream;
}

// ---------------------------------------------------------------------------
// 投影主函数
// ---------------------------------------------------------------------------

export function projectSchedule(input: ProjectionInput): ScheduleProjection {
  const calendar = input.calendar;

  // 1. DAG 校验：任何 issue 直接抛，错误串全部带出（不吞后续问题）
  const dagIssues = analyzeDag(input.packages);
  if (dagIssues.length > 0) {
    throw new ProjectionError(dagIssues[0].code, dagIssues.map((issue) => issue.message).join('；'));
  }

  // 2. 拓扑序 + 工期校验
  const order = topologicalOrder(input.packages);
  const durationLimits = new Map<string, { min: number; max: number }>();
  for (const pkg of input.packages) {
    const { min, max } = pkg.duration_workdays;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min) {
      throw new ProjectionError(
        'invalid_duration',
        `${pkg.id}: duration_workdays 非法（${min}–${max}），须为 min ≥ 0 且 max ≥ min 的整数工作日（0 = 零工作日里程碑）`,
      );
    }
    durationLimits.set(pkg.id, { min, max });
  }

  // 实际窗口（设计 §14/B3）：loader 给真实日期，本模块经工作日历映射成 ord。
  // 先做与日历无关的校验（未知包 / 日期格式 / 起止顺序）；日期→ord 的映射在 cursor 建好后进行。
  const declaredActuals = input.actual_windows ?? {};
  for (const [pkgId, window] of Object.entries(declaredActuals)) {
    if (!durationLimits.has(pkgId)) {
      throw new ProjectionError('unknown_actual_window_package', `实际窗口引用了未知包 ${pkgId}`);
    }
    parseIsoDate(window.start_date, `${pkgId}.start_date`);
    parseIsoDate(window.end_date, `${pkgId}.end_date`);
    if (window.start_date > window.end_date) {
      throw new ProjectionError(
        'invalid_actual_window',
        `${pkgId}: 实际窗口非法（${window.start_date} → ${window.end_date}），start_date 不得晚于 end_date`,
      );
    }
  }
  // 设计 §14/B5 同一原则：锚点为 null 时没有真实日期坐标系，不按 1970 名义纪元造序数。
  // 实际窗口是真实日期，无法定位时不降级、不丢弃——直接判定非法。
  if (calendar.anchor_date === null || calendar.anchor_date === undefined) {
    const anchored = Object.keys(declaredActuals);
    if (anchored.length > 0) {
      throw new ProjectionError(
        'invalid_actual_window',
        `${anchored.join('、')}: anchor_date 为空时无法把实际窗口的真实日期映射成排程序数（不按 1970 名义纪元造序数）`,
      );
    }
  }

  // scenario 校验：只认已声明包；workdays 为非负整数（what-if API 的 400 校验在 loader/路由侧）
  const delayByPkg = new Map<string, number>();
  for (const entry of input.scenario?.delay ?? []) {
    if (!durationLimits.has(entry.pkg)) {
      throw new ProjectionError('unknown_scenario_package', `演算延迟引用了未知包 ${entry.pkg}`);
    }
    if (!Number.isInteger(entry.workdays) || entry.workdays < 0) {
      throw new ProjectionError(
        'invalid_delay',
        `${entry.pkg}: 演算延迟须为非负整数工作日（收到 ${entry.workdays}）`,
      );
    }
    delayByPkg.set(entry.pkg, (delayByPkg.get(entry.pkg) ?? 0) + entry.workdays);
  }

  // 3. 工作历：约束日期与实际窗口日期都经同一张日历映射成 ord
  // （可能需要把展开推进到约束/实际日期之后，或向后扩到锚点之前）
  const cursor = createCalendarCursor(calendar);

  // 实际窗口：真实日期 → ord（休息日取之后第一个工作日，见 ordForDate docstring）
  const actualWindows: Record<string, ProjectionActualWindow> = {};
  for (const [pkgId, window] of Object.entries(declaredActuals)) {
    const startOrd = cursor.ordForDate(window.start_date, `${pkgId}.start_date`);
    const endOrd = cursor.ordForDate(window.end_date, `${pkgId}.end_date`);
    if (endOrd < startOrd) {
      // 日期映射单调，理论上不可达；留作内部不变量检查而不是静默取反
      throw new ProjectionError(
        'invalid_actual_window',
        `${pkgId}: 实际窗口映射后非法（${window.start_date} → ord ${startOrd}，${window.end_date} → ord ${endOrd}）`,
      );
    }
    actualWindows[pkgId] = { start_ord: startOrd, end_ord: endOrd };
  }

  const constraintFloor = new Map<string, number>();
  for (const pkg of input.packages) {
    for (const constraint of input.constraints?.[pkg.id] ?? []) {
      // MVP：time_window / not_after 只登记不生效（设计 §2.1(b)）
      if (constraint.type !== 'not_before') continue;
      if (constraint.status !== 'resolved') continue;
      if (constraint.date === null || constraint.date === undefined) continue;
      // 设计 §14/B5 锚点守卫：无锚点 = 无真实日期坐标系，不调用 ordForDate 做名义纪元映射，
      // 直接跳过该约束的抬升（loader 侧报 constraint_resolved_without_anchor）。
      if (calendar.anchor_date === null || calendar.anchor_date === undefined) continue;
      const floor = cursor.ordForDate(constraint.date);
      constraintFloor.set(pkg.id, Math.max(constraintFloor.get(pkg.id) ?? 1, floor));
    }
  }

  // 4. baseline：声明依赖 + 声明工期，两遍前向（不含实际窗口、不含 scenario）
  const baselineMin = forwardPass({
    order,
    durations: durationLimits,
    actualWindows: null,
    constraintFloor,
    useMaxDuration: false,
  });
  const baselineMax = forwardPass({
    order,
    durations: durationLimits,
    actualWindows: null,
    constraintFloor,
    useMaxDuration: true,
  });

  // 5. forecast：实际窗口钉死 + scenario 加工期（已完工包不吃 delay）
  const forecastDurations = new Map<string, { min: number; max: number }>();
  for (const [pkgId, duration] of durationLimits) {
    const delay = delayByPkg.get(pkgId) ?? 0;
    forecastDurations.set(pkgId, { min: duration.min + delay, max: duration.max + delay });
  }
  const forecastMin = forwardPass({
    order,
    durations: forecastDurations,
    actualWindows,
    constraintFloor,
    useMaxDuration: false,
  });
  const forecastMax = forwardPass({
    order,
    durations: forecastDurations,
    actualWindows,
    constraintFloor,
    useMaxDuration: true,
  });

  // 6. 组装每个包的基线/预测/实际，顺带求 ordinals 的上下界
  const packages: Record<string, ProjectedPackage> = {};
  let maxOrd = 0;
  // ordinals 默认从 ord 1 起；只有实际窗口能把下界拉到 0 或负值（锚点前的实际日期，设计 §14/B3）
  let minOrd = 1;
  for (const pkg of input.packages) {
    const baseMin = baselineMin.get(pkg.id);
    const baseMax = baselineMax.get(pkg.id);
    const castMin = forecastMin.get(pkg.id);
    const castMax = forecastMax.get(pkg.id);
    if (!baseMin || !baseMax || !castMin || !castMax) {
      throw new ProjectionError('internal_order_error', `${pkg.id}: 前向传播缺少结果`);
    }
    const actual = actualWindows[pkg.id] ? { ...actualWindows[pkg.id] } : null;
    packages[pkg.id] = {
      baseline: { start_ord: baseMin.start, end_ord_min: baseMin.end, end_ord_max: baseMax.end },
      forecast: { start_ord: castMin.start, end_ord_min: castMin.end, end_ord_max: castMax.end },
      actual,
    };
    minOrd = Math.min(minOrd, baseMin.start, castMin.start, actual?.start_ord ?? 1);
    maxOrd = Math.max(maxOrd, baseMax.end, castMax.end, actual?.end_ord ?? 0);
  }

  cursor.ensure(maxOrd);
  const ordinals: Array<{ ord: number; date: string | null }> = [];
  for (let ord = minOrd; ord <= maxOrd; ord += 1) {
    // anchor_date 为空时也照样算出 date（名义纪元占位），置 null 由 loader 负责；
    // ord ≤ 0 是锚点前的工作日（实际窗口可能落在那里），date 由向后展开给出。
    ordinals.push({ ord, date: cursor.dateOf(ord) });
  }

  // 7. scenario：只列拓扑下游且 start 真的变了的包（并行分支不动就不列）
  // delta 按契约取 forecast.start_ord − baseline.start_ord；baseline 不含实际窗口，
  // 因此若某下游包同时被实际窗口推移，其 delta 里也含实际窗口的效应（不作为「delay 造成」解读）。
  let scenario: ScheduleProjection['scenario'] = null;
  if (input.scenario !== undefined) {
    const overrides = [...delayByPkg].map(([pkg, workdays]) => ({ pkg, workdays }));
    const downstream = collectDownstream(order, [...delayByPkg.keys()]);
    const affected: Array<{ pkg: string; delta: number }> = [];
    for (const pkg of order) {
      if (!downstream.has(pkg.id)) continue;
      const projected = packages[pkg.id];
      const delta = projected.forecast.start_ord - projected.baseline.start_ord;
      if (delta === 0) continue;
      affected.push({ pkg: pkg.id, delta });
    }
    scenario = { overrides, affected };
  }

  return { ordinals, packages, scenario };
}

// ---------------------------------------------------------------------------
// 协调冲突（角色工作台用；设计 §4 第 6 条）
// ---------------------------------------------------------------------------

/**
 * 同一 role 的多个 mode === 'onsite' 项，若 forecast 窗口 [start_ord, end_ord_max] 相互重叠
 * → 冲突（同一天两处现场）。notify 与 remote 不产生冲突。
 * 重叠按连通簇分组：A 叠 B、B 叠 C 即使 A 不叠 C 也算同一个连续占用簇（两处现场连成一片）。
 * 同角色内不相连的两段重叠各报一条。
 */
export function detectCoordinationConflicts(
  items: Array<{ sch_id: string; pkg: string; role: string; mode: "onsite" | "remote" | "notify" }>,
  projection: ScheduleProjection,
): Array<{ role: string; sch_ids: string[]; reason: string }> {
  interface OnsiteWindow {
    sch_id: string;
    start: number;
    end: number;
  }

  const onsiteByRole = new Map<string, OnsiteWindow[]>();
  for (const item of items) {
    if (item.mode !== 'onsite') continue;
    const projected = projection.packages[item.pkg];
    if (!projected) {
      throw new ProjectionError(
        'unknown_coordination_package',
        `${item.sch_id}: 协调项引用了投影中不存在的包 ${item.pkg}`,
      );
    }
    const list = onsiteByRole.get(item.role) ?? [];
    list.push({
      sch_id: item.sch_id,
      start: projected.forecast.start_ord,
      end: projected.forecast.end_ord_max,
    });
    onsiteByRole.set(item.role, list);
  }

  const conflicts: Array<{ role: string; sch_ids: string[]; reason: string }> = [];
  for (const role of [...onsiteByRole.keys()].sort((left, right) => left.localeCompare(right))) {
    const list = (onsiteByRole.get(role) ?? []).sort(
      (left, right) => left.start - right.start || left.end - right.end || left.sch_id.localeCompare(right.sch_id),
    );
    let cluster: OnsiteWindow[] = [];
    let clusterEnd = 0;

    const flush = (): void => {
      if (cluster.length < 2) return;
      const detail = cluster
        .map((entry) => `${entry.sch_id} 第 ${entry.start}–${entry.end} 工作日`)
        .join('、');
      conflicts.push({
        role,
        sch_ids: cluster.map((entry) => entry.sch_id),
        reason: `同角色现场窗口重叠（同一天两处现场）：${detail}`,
      });
    };

    for (const entry of list) {
      if (cluster.length === 0) {
        cluster = [entry];
        clusterEnd = entry.end;
        continue;
      }
      if (entry.start <= clusterEnd) {
        cluster.push(entry);
        clusterEnd = Math.max(clusterEnd, entry.end);
      } else {
        flush();
        cluster = [entry];
        clusterEnd = entry.end;
      }
    }
    flush();
  }
  return conflicts;
}
