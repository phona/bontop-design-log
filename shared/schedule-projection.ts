/**
 * 施工排程投影（issue #202 切片 B；设计依据 docs/schedule-coordination-design.md §4 / §14 / §15 / §16 / §17 / §18）。
 *
 * 纯函数模块，与 shared/flow-layout.ts 同宗：不碰 fs、不碰 DOM、同输入必得同输出。
 * 输入是 schedule/phase-1/control.yaml 的声明值（包/依赖/工期/约束/工作日历）加
 * loader 从 audit_log 派生的检查记录窗口，输出是纯计算出的投影；本模块不读文件、不写状态。
 * UI 不 import 本模块做计算（设计 §4：UI 只消费快照里的结果，第二套排程实现即第二权威源）。
 *
 * 时间模型（设计 §3 的四条线；§16 推翻「预测钉死检查记录窗口」）：
 * 所有位置以「自排程零点起第 N 个工作日」（1-based，下文记作 ord）。
 * - ord 1 = 锚点当天或之后第一个工作日；锚点之前的工作日依次为 ord 0、-1、-2…（设计 §14/B3）。
 * - baseline：声明依赖 + 声明工期区间，min/max 各做一遍前向传播（乐观/保守），不存。
 * - forecast：与 baseline 同一套前向传播（声明工期 / 依赖 / resolved 约束）。
 *   无 scenario 时与 baseline 相同；有 scenario 时差异只来自 scenario.delay（§16，业主裁定 A）。
 *   检查记录窗口不参与 forecast，也不顺延后继。
 * - scenario（what-if）：给点名的包加工期，只重算拓扑下游。
 * - 检查记录窗口由 loader 以真实日期给入（{start_date, end_date}，YYYY-MM-DD）。它不是施工起止。
 *   锚点就绪时，本模块用同一张工作日历把它映射成 ord，作为证据字段返回，并参与 ordinals
 *   地平线扩展——向后到最早的检查日期（可为负 ord），向前到基线/预测/检查窗口的最晚末端。
 *   任何真实日期都不因「地平线外」被丢弃（B3 保留）。
 *   锚点为空时（§17）：日期原样保留，序数为 null（待定）。不抛错、不调用 ordForDate、
 *   不造序数，也不扩展 ordinals 地平线、不进 baseline / forecast。
 *   同一情况下 ordinals 的 date 也是 null（§18）：那是排程轴上的未知，不是纪元日期。
 *   检查窗口的日期是另一件事（checked_at 事实），无锚点也保留，不抄进 ordinals。
 *
 * 日期映射规则（约束与检查记录窗口同一条）：落在非工作日的日期取「当天或之后第一个工作日」；
 * 工作日判定顺序见 createCalendarCursor（rest_dates 优先，其次 extra_workdates，再看 workdays）。
 * 日期→ord 是**查询顺序无关**的纯查询（§15/F1）：ord 只由日历与目标日期决定，按日期 memo；
 * 任何调用顺序、任何查询次数结果一致。正向/反向的工作日展开只做单调缓存，不在查询路径上
 * 共享可变游标。
 *
 * 单 start_ord 的口径（ProjectedWindow 只有三个字段）：start_ord 取 min 口径（乐观）
 * 那一遍的起点，end_ord_min 取 min 口径的末端，end_ord_max 取 max 口径的末端。
 * 因此区间 [start_ord, end_ord_max] 是「最早可能开工 → 最晚可能完工」的全不确定区间，
 * 甘特的区间条用这个区间（设计 §7「min/max 画区间条不是单值条」）。
 * 协调检测不再把这个整段区间当成已确认的现场占用（§16 minor）：没有 confirmed 日期的条目
 * 只有潜在窗口；真实占用是 confirmed_at 当天。status === 'cancelled' 的条目在分组前排除
 * （§17 minor）：取消即解除占用，不进 conflicts，也不进 potential。
 *
 * 约束（设计 §2.1(b)）：只有 type === 'not_before'、status === 'resolved'、date 非空
 * 且 calendar.anchor_date 非 null 的约束参与计算，把该包 start_ord 抬到不早于该 date
 * 对应的 ord（date 落在休息日时取当天或之后第一个工作日）。not_after / time_window 在
 * MVP 只登记不生效。约束抬升同时进入 baseline 与 forecast（它是计划的一部分，不是检查日期）。
 *
 * 锚点为 null 的执行口径（三件事，不要并成一句）：
 * - not_before（设计 §14/B5，本意只到这里）：没有锚点就没有真实日期坐标系，resolved 的
 *   not_before 不调用 ordForDate、不抬升（loader 报 constraint_resolved_without_anchor）。
 * - 检查记录窗口（设计 §17）：一审修复曾把 B5 扩成「无锚点即抛 invalid_check_window」。
 *   那是过度防御。无锚点时日期是事实、序数是 null；不抛错、不造序数、不参与计划计算。
 *   锚点就绪后同一窗口照常映射（§14/B3）。invalid_check_window 只留给日期串非法与起止颠倒。
 * - ordinals 的 date（设计 §18）：排程轴产物。无锚点时每项为 null，不调用 dateOf，
 *   不设名义纪元。序号仍由前向传播确定（minOrd..maxOrd 连续）。锚点就绪后才是真实日期。
 *   与检查窗口的日期不是一回事：后者是 checked_at 事实，无锚点也保留。
 *
 * 侧车道：sequence >= 900 的包（PKG-900）由调用方过滤（设计 §4）；本模块不特判，
 * 传进来按普通包计算，不会崩，也不会被静默丢弃。PKG-900 的真实声明是
 * duration_workdays {min: 0, max: 0}（硬装预备金，不进行任何施工），零工期一律按
 * 「零工作日里程碑」处理：start_ord = end_ord，不占 ord，后继从该包的 start_ord 起算
 * （§15/m1：前向传播对零工期依赖不再 +1）。零工期只看声明工期，检查记录窗口不改这个判定。
 *
 * 错误（fail-closed，全部抛 ProjectionError，code 供 loader 映射到 §2.1(d) 的错误码）：
 * unknown_dependency / self_dependency / dependency_cycle（DAG）、invalid_duration、
 * invalid_check_window / unknown_check_window_package、invalid_calendar /
 * calendar_date_conflict / work_calendar_empty / work_calendar_exhausted / invalid_date、
 * unknown_scenario_package / invalid_delay、unknown_coordination_package。
 * validateDag 按契约返回中文错误串而不抛错，projectSchedule 用第一条 issue 的 code 抛。
 * §16 起不再使用 invalid_actual_window / unknown_actual_window_package（旧名是第四种叫法）。
 */

const MS_PER_DAY = 86_400_000;

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
/**
 * 投影输出里的检查记录窗口。不是施工起止。
 * 日期是输入事实，原样保留。序数只在锚点就绪时才有（锚点前可为 0 / 负值，设计 §14/B3）；
 * 锚点为空时序数为 null（待定，设计 §17）——不删 start_ord / end_ord，只把它们改成可空。
 */
export interface ProjectionCheckWindow {
  start_date: string;
  end_date: string;
  start_ord: number | null;
  end_ord: number | null;
}
/** 检查记录窗口的模块输入：真实日期（本模块经工作日历映射成 ord，只作证据，不进 forecast）。 */
export interface ProjectionCheckDates { start_date: string; end_date: string; }
export interface ProjectionInput {
  packages: ProjectionPackage[];
  calendar: ProjectionCalendar;
  constraints?: Record<string, ProjectionConstraint[]>;  // key = PKG id
  check_windows?: Record<string, ProjectionCheckDates>; // key = PKG id；日期须为 YYYY-MM-DD
  scenario?: { delay: Array<{ pkg: string; workdays: number }> };
}
export interface ProjectedWindow { start_ord: number; end_ord_min: number; end_ord_max: number; }
export interface ProjectedPackage {
  baseline: ProjectedWindow;
  forecast: ProjectedWindow;
  /** 检查记录窗口的证据 ord。不参与 baseline / forecast（设计 §16）。 */
  check_window: ProjectionCheckWindow | null;
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

/**
 * 检查记录窗口的日期校验。格式非法或日期不存在时抛 invalid_check_window，
 * 不沿用日历路径的 invalid_date（设计 §17：这个码只留给窗口自己的坏数据，
 * 并且不再因「无锚点」触发）。日历的 rest_dates / extra_workdates / anchor_date
 * 仍走 parseIsoDate 的 invalid_date。
 */
function assertCheckWindowDate(text: string, label: string): void {
  try {
    parseIsoDate(text, label);
  } catch (error) {
    if (error instanceof ProjectionError && error.code === 'invalid_date') {
      throw new ProjectionError('invalid_check_window', error.message);
    }
    throw error;
  }
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
  /** 某日期当天或之后第一个工作日的 ord（约束日期与检查记录日期落在休息日时向后取）。 */
  ordForDate(text: string, label?: string): number;
}

/**
 * 从 anchor_date 起逐日推进，只数工作日，ord 从 1 连续编号。
 * anchor_date 为空时不设纪元（设计 §18：名义纪元已退场）：上面的结构校验照常做完，
 * 日期映射入口直接失败，调用方不得把序数换成日期。
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

  // §18：没有锚点就没有日期轴。结构校验（非法星期、日期冲突、空历）已经做完；
  // 这里不设 1970 名义纪元。dateOf / ordForDate 若被调用直接失败，避免任何路径把编造日期带出模块。
  if (calendar.anchor_date === null || calendar.anchor_date === undefined) {
    const refuse = (action: string): never => {
      throw new ProjectionError(
        'internal_order_error',
        `无锚点时不得${action}（名义纪元已退场，日期未知；设计 §18）`,
      );
    };
    return {
      ensure() {},
      dateOf() {
        return refuse('把序数映射成日期');
      },
      ordForDate() {
        return refuse('把日期映射成序数');
      },
    };
  }

  const epochDay = parseIsoDate(calendar.anchor_date, 'anchor_date');

  // 扫描上限至少覆盖日历自己声明过的日期（§16 major）。
  // 旧上限按「目标工作日数 × 7」估算：workdays 为空、extra_workdates 相隔约两个月时，
  // 第二个已声明的工作日在上限之外，误报 work_calendar_exhausted（01-05 与 03-05、工期 2，
  // 正向扫 29 天只得到 1 个工作日；锚点改到后一个声明日时反向同样在 22 天处断开）。
  // 声明日不够凑工期时仍然报 exhausted——上限变长，保险丝还在。7× 保留为密日历的下限，
  // 避免休息日把工作日吃光时扫得比原来更短。
  const DECLARED_DATE_BUFFER = 7;
  let latestDeclared = epochDay;
  let earliestDeclared = epochDay;
  for (const day of extraWorkdates) {
    if (day > latestDeclared) latestDeclared = day;
    if (day < earliestDeclared) earliestDeclared = day;
  }
  for (const day of restDates) {
    if (day > latestDeclared) latestDeclared = day;
    if (day < earliestDeclared) earliestDeclared = day;
  }
  const declaredForwardSpan = latestDeclared - epochDay;
  const declaredBackwardSpan = epochDay - earliestDeclared;

  const isWorkday = (day: number): boolean => {
    if (restDates.has(day)) return false;
    return extraWorkdates.has(day) || workdays.has(weekdayOfDay(day));
  };

  // days[ord - 1] = 该 ord 对应的天序号（ord ≥ 1）；随 ensure() 单调增长
  const days: number[] = [];
  let cursorDay = epochDay;

  // 负序数展开（设计 §14/B3）：backwardDays[0] = ord 0（ord 1 之前最后一个工作日），
  // backwardDays[k] = ord -k；严格递减，天序号与正向 days 不重叠。
  // 只由 ensureBackward(count) 顺序追加（§15/F1）：查询路径不得直接推进这里的游标，
  // 游标每次从最后一个已缓存工作日重新开始，缓存因此始终连续、无跳号。
  const backwardDays: number[] = [];

  // 天序号 → ord 的查询缓存（§15/F1）：ordForDate 是纯查询，同一日期永不重复计算，
  // 也不因查询顺序改变结果。
  const ordByDate = new Map<number, number>();

  const scanLimitFor = (targetCount: number, declaredSpan: number): number =>
    Math.max(7 * (targetCount + restDates.size + 1) + 7, declaredSpan + DECLARED_DATE_BUFFER);

  const ensure = (targetOrd: number): void => {
    if (!Number.isInteger(targetOrd) || targetOrd < 0) {
      throw new ProjectionError('invalid_ordinal', `工作日序数必须是非负整数（收到 ${targetOrd}）`);
    }
    const scanLimit = scanLimitFor(targetOrd, declaredForwardSpan);
    while (days.length < targetOrd) {
      if (isWorkday(cursorDay)) {
        days.push(cursorDay);
      }
      cursorDay += 1;
      if (days.length < targetOrd && cursorDay - epochDay > scanLimit) {
        throw new ProjectionError(
          'work_calendar_exhausted',
          `已扫描 ${cursorDay - epochDay} 天只得到 ${days.length} 个工作日，无法达到序数 ${targetOrd}（声明过的工作日已纳入扫描上限；若仍不够，是 rest_dates 吃掉了工作日，或 workdays / extra_workdates 不足以凑够序数）`,
        );
      }
    }
  };

  /**
   * 向后至少展开 count 个工作日（ord 0 起），供 ordinals 的负序数段与 dateOf(ord ≤ 0) 用。
   * 游标从「最后一个已缓存工作日的再前一日」开始，只做单调追加——不回退、不被查询路径
   * 交叉推进，因此任意调用顺序得到同一数组。ordForDate 的反向查询**不走**本函数：它的
   * 终止条件是越过目标日期，而这里的保险丝要求凑足 count 个工作日，二者语义不同（§15/F1 修正）。
   */
  const ensureBackward = (count: number): void => {
    if (!Number.isInteger(count) || count < 0) {
      throw new ProjectionError('invalid_ordinal', `向后展开的工作日个数必须是非负整数（收到 ${count}）`);
    }
    const scanLimit = scanLimitFor(count, declaredBackwardSpan);
    let cursorDay = backwardDays.length === 0 ? epochDay : backwardDays[backwardDays.length - 1];
    const startDay = cursorDay;
    while (backwardDays.length < count) {
      cursorDay -= 1;
      if (isWorkday(cursorDay)) backwardDays.push(cursorDay);
      if (backwardDays.length < count && startDay - cursorDay > scanLimit) {
        throw new ProjectionError(
          'work_calendar_exhausted',
          `锚点前已扫描 ${startDay - cursorDay} 天只得到 ${backwardDays.length} 个工作日，无法达到序数 ${1 - count}（声明过的工作日已纳入扫描上限；若仍不够，是 rest_dates 吃掉了工作日，或 workdays / extra_workdates 不足以凑够序数）`,
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
   * 锚点前日期（targetDay < ord 1）的纯查询：数 [targetDay, epochDay) 内的工作日个数 k，
   * 返回 1 - k（k = 0 即区间内没有工作日，第一个工作日就是 ord 1；k ≥ 1 时最后一个
   * ≥ targetDay 的工作日即 ord 1 - k，设计 §14/B3）。
   *
   * 不推进 backwardDays：查询的终止条件是「越过 targetDay」，不是「凑足 count 个工作日」，
   * 因此不能复用 ensureBackward 的保险丝——合法稀疏日历（workdays: [] 且只有少量
   * extra_workdates）里两个工作日可能相隔任意远，凑数式展开会把 ord 1 误判成
   * work_calendar_exhausted（§15/F1 复审回归）。已缓存的反向工作日是自 epoch 起的连续
   * 前缀，先数其中 ≥ targetDay 的部分，再从最后一个已缓存日之下继续扫，结果与缓存状态无关。
   */
  const backwardOrdForDate = (targetDay: number): number => {
    let found = 0;
    while (found < backwardDays.length && backwardDays[found] >= targetDay) found += 1;
    if (found < backwardDays.length) return 1 - found;
    let scanDay = backwardDays.length === 0 ? epochDay : backwardDays[backwardDays.length - 1];
    while (scanDay > targetDay) {
      scanDay -= 1;
      if (isWorkday(scanDay)) found += 1;
    }
    return 1 - found;
  };

  /**
   * 真实日期 → ord：取「当天或之后第一个工作日」。
   * - 不早于 ord 1 的日期：从正向展开表里二分第一个 ≥ targetDay 的工作日；
   * - 早于 ord 1 的日期：用 backwardOrdForDate 纯扫描（不写缓存；设计 §14/B3：锚点前的
   *   检查记录日期必须有负序数，供证据字段与 ordinals 使用，不进 forecast）。
   *
   * 无状态查询（§15/F1）：结果只由日历与 targetDay 决定，按天序号 memo。正向/反向展开表
   * 都是单调缓存，查询只读不推进游标——先查 01-01 再查 12-31 与反过来必须得到同一组 ord。
   */
  const ordForDate = (text: string, label = 'constraint.date'): number => {
    const targetDay = parseIsoDate(text, label);
    const cached = ordByDate.get(targetDay);
    if (cached !== undefined) return cached;

    ensure(1);
    const firstWorkday = days[0];
    if (firstWorkday === undefined) {
      // createCalendarCursor 已保证至少一个工作日，这里只防御内部错位
      throw new ProjectionError('work_calendar_empty', '工作日历未能展开出任何工作日');
    }

    let ord: number;
    if (targetDay >= firstWorkday) {
      // days 严格递增：展开到最晚一个 ≥ targetDay 的工作日即可二分
      while (days[days.length - 1] < targetDay) {
        ensure(days.length + 1);
      }
      let low = 0;
      let high = days.length - 1;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (days[mid] >= targetDay) high = mid;
        else low = mid + 1;
      }
      ord = low + 1;
    } else {
      ord = backwardOrdForDate(targetDay);
    }

    ordByDate.set(targetDay, ord);
    return ord;
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
  /** 包 id → 约束抬起后的最早 start_ord。 */
  constraintFloor: Map<string, number>;
  useMaxDuration: boolean;
}

function forwardPass(options: ForwardPassOptions): Map<string, PassWindow> {
  const windows = new Map<string, PassWindow>();
  // 本遍口径下的零工期包（§15/m1）：里程碑不占用工作日，后继从它的 start_ord 起算。
  // 只看声明工期。检查记录窗口不进本函数（§16：它不是工期，也不顺延后继）。
  const nonOccupying = new Set<string>();
  for (const pkg of options.order) {
    let start = 1;
    for (const dependency of pkg.dependencies ?? []) {
      const dependencyWindow = windows.get(dependency);
      if (!dependencyWindow) {
        throw new ProjectionError(
          'internal_order_error',
          `${pkg.id}: 依赖 ${dependency} 未在拓扑序中先行计算`,
        );
      }
      const successorStart = nonOccupying.has(dependency) ? dependencyWindow.end : dependencyWindow.end + 1;
      start = Math.max(start, successorStart);
    }
    start = Math.max(start, options.constraintFloor.get(pkg.id) ?? 1);

    const duration = options.durations.get(pkg.id);
    if (!duration) {
      throw new ProjectionError('internal_order_error', `${pkg.id}: 缺少工期声明`);
    }
    const length = options.useMaxDuration ? duration.max : duration.min;
    // 零工期 = 不占工作日的里程碑（PKG-900 硬装预备金是真实先例）：
    // 若照 end = start - 1 会造出 start > end 的非法窗口；后继也不能按 end + 1 顺延，
    // 否则里程碑会多占一个工作日（§15/m1）。
    const end = length === 0 ? start : start + length - 1;
    if (length === 0) nonOccupying.add(pkg.id);
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
  // 空锚点 = 没有真实日期坐标系（§14/B5、§17）。null 与缺字段同一件事。
  const anchorReady = calendar.anchor_date !== null && calendar.anchor_date !== undefined;

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

  // 检查记录窗口（设计 §14/B3 + §16）：loader 给真实日期，本模块经工作日历映射成 ord。
  // 只作证据，并扩展 ordinals 地平线；不进入 baseline / forecast。
  // 先做与日历无关的校验（未知包 / 日期格式 / 起止顺序）；日期→ord 的映射在 cursor 建好后进行。
  const declaredChecks = input.check_windows ?? {};
  for (const [pkgId, window] of Object.entries(declaredChecks)) {
    if (!durationLimits.has(pkgId)) {
      throw new ProjectionError('unknown_check_window_package', `检查记录窗口引用了未知包 ${pkgId}`);
    }
    // 日期串非法与锚点无关：无锚点时序数待定，但坏日期仍然不是证据（§17）。
    assertCheckWindowDate(window.start_date, `${pkgId}.start_date`);
    assertCheckWindowDate(window.end_date, `${pkgId}.end_date`);
    if (window.start_date > window.end_date) {
      throw new ProjectionError(
        'invalid_check_window',
        `${pkgId}: 检查记录窗口非法（${window.start_date} → ${window.end_date}），start_date 不得晚于 end_date`,
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

  // 3. 工作历：约束日期与检查记录日期都经同一张日历映射成 ord
  // （可能需要把展开推进到约束/检查日期之后，或向后扩到锚点之前）
  const cursor = createCalendarCursor(calendar);

  // 检查记录窗口（§17）：
  // - 锚点就绪：真实日期 → ord（休息日取之后第一个工作日，见 ordForDate docstring）。
  //   映射结果只写入证据字段与 ordinals 地平线，下面的前向传播不读它（§16）。
  // - 锚点为空：日期原样保留，序数 null。不调用 ordForDate（无锚点没有日期轴），
  //   也不把这份窗口交给地平线。它只是还没法标序数的证据。
  //   这不改变 ordinals：那些 date 另按 §18 置 null，不把检查日抄进去。
  const checkWindows: Record<string, ProjectionCheckWindow> = {};
  for (const [pkgId, window] of Object.entries(declaredChecks)) {
    if (!anchorReady) {
      checkWindows[pkgId] = {
        start_date: window.start_date,
        end_date: window.end_date,
        start_ord: null,
        end_ord: null,
      };
      continue;
    }
    const startOrd = cursor.ordForDate(window.start_date, `${pkgId}.start_date`);
    const endOrd = cursor.ordForDate(window.end_date, `${pkgId}.end_date`);
    if (endOrd < startOrd) {
      // 日期映射单调，理论上不可达；留作内部不变量检查而不是静默取反
      throw new ProjectionError(
        'invalid_check_window',
        `${pkgId}: 检查记录窗口映射后非法（${window.start_date} → ord ${startOrd}，${window.end_date} → ord ${endOrd}）`,
      );
    }
    checkWindows[pkgId] = {
      start_date: window.start_date,
      end_date: window.end_date,
      start_ord: startOrd,
      end_ord: endOrd,
    };
  }

  const constraintFloor = new Map<string, number>();
  for (const pkg of input.packages) {
    for (const constraint of input.constraints?.[pkg.id] ?? []) {
      // MVP：time_window / not_after 只登记不生效（设计 §2.1(b)）
      if (constraint.type !== 'not_before') continue;
      if (constraint.status !== 'resolved') continue;
      if (constraint.date === null || constraint.date === undefined) continue;
      // 设计 §14/B5 锚点守卫：无锚点 = 无真实日期坐标系，不调用 ordForDate，
      // 直接跳过该约束的抬升（loader 侧报 constraint_resolved_without_anchor）。
      // 这里不改成「序数 null」：约束是计划输入，没有坐标就还不生效（§17，与检查窗口分开）。
      if (!anchorReady) continue;
      const floor = cursor.ordForDate(constraint.date);
      constraintFloor.set(pkg.id, Math.max(constraintFloor.get(pkg.id) ?? 1, floor));
    }
  }

  // 4. baseline：声明依赖 + 声明工期 + resolved 约束，两遍前向。不读检查记录窗口。
  const baselineMin = forwardPass({
    order,
    durations: durationLimits,
    constraintFloor,
    useMaxDuration: false,
  });
  const baselineMax = forwardPass({
    order,
    durations: durationLimits,
    constraintFloor,
    useMaxDuration: true,
  });

  // 5. forecast：与 baseline 同一套传播，唯一差别是 scenario.delay 加在点名包的工期上（§16）。
  // 检查记录窗口不在这里。无 delay 时两遍与 baseline 逐值相同。
  const forecastDurations = new Map<string, { min: number; max: number }>();
  for (const [pkgId, duration] of durationLimits) {
    const delay = delayByPkg.get(pkgId) ?? 0;
    forecastDurations.set(pkgId, { min: duration.min + delay, max: duration.max + delay });
  }
  const forecastMin = forwardPass({
    order,
    durations: forecastDurations,
    constraintFloor,
    useMaxDuration: false,
  });
  const forecastMax = forwardPass({
    order,
    durations: forecastDurations,
    constraintFloor,
    useMaxDuration: true,
  });

  // 6. 组装每个包的基线/预测/检查记录窗口，顺带求 ordinals 的上下界。
  // 检查窗口只在序数已映射时扩展地平线（B3），不改 forecast。序数为 null（无锚点，§17）时
  // 不进上下界——null 不能交给 Math.min/Math.max（会被当成 0）。
  const packages: Record<string, ProjectedPackage> = {};
  let maxOrd = 0;
  // ordinals 默认从 ord 1 起；只有已映射的检查记录窗口能把下界拉到 0 或负值（锚点前的检查日期，设计 §14/B3）
  let minOrd = 1;
  for (const pkg of input.packages) {
    const baseMin = baselineMin.get(pkg.id);
    const baseMax = baselineMax.get(pkg.id);
    const castMin = forecastMin.get(pkg.id);
    const castMax = forecastMax.get(pkg.id);
    if (!baseMin || !baseMax || !castMin || !castMax) {
      throw new ProjectionError('internal_order_error', `${pkg.id}: 前向传播缺少结果`);
    }
    const checkWindow = checkWindows[pkg.id] ? { ...checkWindows[pkg.id] } : null;
    packages[pkg.id] = {
      baseline: { start_ord: baseMin.start, end_ord_min: baseMin.end, end_ord_max: baseMax.end },
      forecast: { start_ord: castMin.start, end_ord_min: castMin.end, end_ord_max: castMax.end },
      check_window: checkWindow,
    };
    minOrd = Math.min(minOrd, baseMin.start, castMin.start);
    maxOrd = Math.max(maxOrd, baseMax.end, castMax.end);
    // 序数为 null（无锚点，§17）时不参与地平线。0 与负值是合法序数，必须参与（§14/B3）。
    if (typeof checkWindow?.start_ord === 'number') minOrd = Math.min(minOrd, checkWindow.start_ord);
    if (typeof checkWindow?.end_ord === 'number') maxOrd = Math.max(maxOrd, checkWindow.end_ord);
  }

  const ordinals: Array<{ ord: number; date: string | null }> = [];
  if (!anchorReady) {
    // §18：序号由前向传播确定，日期无锚点即未知。不调用 dateOf（没有纪元可展）。
    for (let ord = minOrd; ord <= maxOrd; ord += 1) {
      ordinals.push({ ord, date: null });
    }
  } else {
    cursor.ensure(maxOrd);
    for (let ord = minOrd; ord <= maxOrd; ord += 1) {
      // ord ≤ 0 是锚点前的工作日（检查记录窗口可能落在那里），date 由向后展开给出。
      ordinals.push({ ord, date: cursor.dateOf(ord) });
    }
  }

  // 7. scenario：只列拓扑下游、且完整预测窗口相对 baseline 变了的包
  // （并行分支不动就不列）。§16 之后检查记录窗口不制造 forecast 位移，
  // 「未应用 scenario 的当前预测」就是 baseline，不再另跑一遍。
  // 比较完整窗口（start / end_min / end_max），捕获只有保守末端变化的下游（§15/M1 的比较口径保留）。
  // delta = 本次演算对该包窗口的最大位移（三处差值的最大值），
  // 仅保守末端变化时即该末端的位移，不再因 start 差为 0 而被丢弃。
  let scenario: ScheduleProjection['scenario'] = null;
  if (input.scenario !== undefined) {
    const overrides = [...delayByPkg].map(([pkg, workdays]) => ({ pkg, workdays }));
    const downstream = collectDownstream(order, [...delayByPkg.keys()]);
    const affected: Array<{ pkg: string; delta: number }> = [];
    for (const pkg of order) {
      if (!downstream.has(pkg.id)) continue;
      const projected = packages[pkg.id].forecast;
      const base = packages[pkg.id].baseline;
      const startDelta = projected.start_ord - base.start_ord;
      const endMinDelta = projected.end_ord_min - base.end_ord_min;
      const endMaxDelta = projected.end_ord_max - base.end_ord_max;
      if (startDelta === 0 && endMinDelta === 0 && endMaxDelta === 0) continue;
      affected.push({ pkg: pkg.id, delta: Math.max(startDelta, endMinDelta, endMaxDelta) });
    }
    scenario = { overrides, affected };
  }

  return { ordinals, packages, scenario };
}

// ---------------------------------------------------------------------------
// 协调冲突（角色工作台用；设计 §4 第 6 条）
// ---------------------------------------------------------------------------

/**
 * 协调项。`status === 'confirmed'` 且 `confirmed_at` 非空才是真实占用（当天）；
 * 其余 onsite 条目只有潜在窗口（所属包的预测区间），重叠只记提示，不记冲突（§16 minor）。
 */
export interface CoordinationScheduleItem {
  sch_id: string;
  pkg: string;
  role: string;
  mode: 'onsite' | 'remote' | 'notify';
  status?: string;
  confirmed_at?: string | null;
}

export interface CoordinationOverlap {
  role: string;
  sch_ids: string[];
  reason: string;
}

export interface CoordinationConflictReport {
  /** 两个已确认、同角色、onsite、同一天的真实占用。 */
  conflicts: CoordinationOverlap[];
  /** 没有确认日期的潜在窗口重叠。提示，不是确定冲突。 */
  potential: CoordinationOverlap[];
}

function isConfirmedOccupancy(
  item: CoordinationScheduleItem,
): item is CoordinationScheduleItem & { confirmed_at: string } {
  return item.status === 'confirmed' && typeof item.confirmed_at === 'string' && item.confirmed_at.length > 0;
}

/**
 * 区分潜在窗口重叠与已确认预约冲突（§16 minor）。
 *
 * - status === 'cancelled' 在分组前排除（§17 minor）：不进 conflicts，也不进 potential。
 *   取消即解除占用；一条 cancelled 不会和一条 pending 凑成潜在重叠。
 * - notify / remote 两边都不参与。
 * - 没有 confirmed 日期的 onsite：占用窗口 = 所属包 forecast [start_ord, end_ord_max]。
 *   两个这样的窗口重叠只进 potential。同包两条未预约的 onsite 因此不再被报成「同一天两处现场」。
 * - status === 'confirmed' 且带 confirmed_at：真实占用是该日期当天（YYYY-MM-DD 相同即重叠），
 *   不是包的整段预测区间。两个真实占用同角色 onsite 同一天才进 conflicts。
 *   一条 confirmed、一条 pending 不构成冲突，也不把 confirmed 算进潜在窗口。
 * - 潜在窗口的重叠仍按连通簇分组（A 叠 B、B 叠 C 算同一簇）。真实占用按日期相等分组，
 *   不把相邻两天并成一簇。
 */
export function detectCoordinationConflicts(
  items: CoordinationScheduleItem[],
  projection: ScheduleProjection,
): CoordinationConflictReport {
  interface PotentialWindow {
    sch_id: string;
    start: number;
    end: number;
  }

  const potentialByRole = new Map<string, PotentialWindow[]>();
  const confirmedByRole = new Map<string, Map<string, string[]>>();

  for (const item of items) {
    // §17 minor：分组前排除。取消即解除占用，后面的潜在窗口与已确认占用都看不到它。
    if (item.status === 'cancelled') continue;
    if (item.mode !== 'onsite') continue;
    const projected = projection.packages[item.pkg];
    if (!projected) {
      throw new ProjectionError(
        'unknown_coordination_package',
        `${item.sch_id}: 协调项引用了投影中不存在的包 ${item.pkg}`,
      );
    }
    if (isConfirmedOccupancy(item)) {
      // 校验日期真实存在，避免把非法字符串当成「当天」聚成冲突。
      parseIsoDate(item.confirmed_at, `${item.sch_id}.confirmed_at`);
      const byDate = confirmedByRole.get(item.role) ?? new Map<string, string[]>();
      const sameDay = byDate.get(item.confirmed_at) ?? [];
      sameDay.push(item.sch_id);
      byDate.set(item.confirmed_at, sameDay);
      confirmedByRole.set(item.role, byDate);
      continue;
    }
    const list = potentialByRole.get(item.role) ?? [];
    list.push({
      sch_id: item.sch_id,
      start: projected.forecast.start_ord,
      end: projected.forecast.end_ord_max,
    });
    potentialByRole.set(item.role, list);
  }

  const potential: CoordinationOverlap[] = [];
  for (const role of [...potentialByRole.keys()].sort((left, right) => left.localeCompare(right))) {
    const list = (potentialByRole.get(role) ?? []).sort(
      (left, right) => left.start - right.start || left.end - right.end || left.sch_id.localeCompare(right.sch_id),
    );
    let cluster: PotentialWindow[] = [];
    let clusterEnd = 0;

    const flush = (): void => {
      if (cluster.length < 2) return;
      const detail = cluster
        .map((entry) => `${entry.sch_id} 第 ${entry.start}–${entry.end} 工作日`)
        .join('、');
      potential.push({
        role,
        sch_ids: cluster.map((entry) => entry.sch_id),
        reason: `同角色潜在窗口重叠（尚未确认预约，不是确定冲突）：${detail}`,
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

  const conflicts: CoordinationOverlap[] = [];
  for (const role of [...confirmedByRole.keys()].sort((left, right) => left.localeCompare(right))) {
    const byDate = confirmedByRole.get(role) ?? new Map<string, string[]>();
    for (const date of [...byDate.keys()].sort((left, right) => left.localeCompare(right))) {
      const schIds = [...(byDate.get(date) ?? [])].sort((left, right) => left.localeCompare(right));
      if (schIds.length < 2) continue;
      const ord = projection.ordinals.find((entry) => entry.date === date)?.ord;
      const when = ord === undefined ? date : `${date}（第 ${ord} 工作日）`;
      conflicts.push({
        role,
        sch_ids: schIds,
        reason: `同角色已确认预约重叠（同一天两处现场）：${schIds.join('、')} 均在 ${when}`,
      });
    }
  }

  return { conflicts, potential };
}
