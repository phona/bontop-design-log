/**
 * 按对象算账（issue #98 PR-8）：对象 → 工作包 → 成本项 → 金额 → 验收项 → pending 的查询视图。
 *
 * 为什么需要本脚本：成本此前只到「工作包 / COST 组件」两级（budget.md / checklist.md），
 * 对象级归属只活在 control.yaml 描述散文里；条带柜组的归属悬案（决策门禁 D19，
 * config/decision-gates.yaml）没有任何机器显形口。本 PR 给成本项加了可选
 * `targets: [对象稳定 id]`（schema 校验在 shared/schedule-state.ts 的 loadScheduleState，
 * verify:schedule 同一 loader 出同一错误），本脚本是该字段的消费视图。
 *
 * 复用而非另立（每个借用的机制替代了什么）：
 * - 对象 → 工作包：直接调用 shared/package-scope.ts 的 resolvePackageScope（PR-4 建的
 *   OBJECT_ID_SOURCES 通道，3D 高亮与反查同源）。空项目输入下 objectIds 恰好只收
 *   furnishings 的 select.ids——不另写第二套来源表、不重走选择器遍历；projectScope
 *   链接不占反查，与 buildObjectPackageIndex 语义一致。
 * - 对象 id / 摆位方式：shared/furniture-object-id.ts 的 collectDeclaredFurnitureIds
 *   （id 与摆位判定的唯一实现），不重新解析 house.yaml 摆位字段。
 * - control / acceptance / decisionGates / targets 校验：shared/schedule-state.ts 的
 *   loadScheduleState；控制源非法（含 targets 校验失败）时本脚本拒绝出账（exit 1），
 *   不在有错的台账上继续算钱。
 *
 * 本脚本是**查询**不是生成物：每次运行从当前 config/ 与 schedule/ 现算，打印 stdout、
 * 不落盘、无指纹、无 render/check 双口径——「后续切片的工作清单」靠查询保证不过期，
 * 不新增需要防漂移的镜像文件（对比 schedule:render 的视图族）。
 *
 * **targets 只收对象 id，不收面层配方 id**（2026-11-07 issue #98 第三阶段 S6，迁移设计
 * §5.7）：S4 起墙贴砖带/涂装带、防水台与飘窗的贴砖/涂装面是宿主对象身上的派生量，S5 起
 * 踢脚带由漆面带派生——它们与对象 id 同为稳定字符串、任何 schema 都区分不了。若允许配方
 * id 进 targets，按对象算账视图会被 100+ 个配方稀释（一间房摊出几十条成本行，业主读不出
 * 「这个对象花了多少钱」）。拦截在 shared/schedule-state.ts 的 targets 校验第一道
 * （配方 id 全集由 shared/finish/input.ts 的 collectFinishRecipeIds 从声明住处枚举），
 * 本脚本不另立一套判据；配方量写进 control.yaml 的 quantity_basis，是派生量不是归属。
 *
 * 引用通道（--inventory 枚举被机器绑定引用的对象）：
 *   anti_penetration_pair   config/anti-penetration.yaml waivers[].pair（结构化）
 *   electrical_mount_anchor config/electrical.yaml mount.furniture_id（结构化；S2 起挂载声明由 mount_anchor 改 mount）
 *   render_override         config/render/overrides.yaml 文本点名（basis/reason 散文，按行定位）
 *   cost_target             control.yaml 成本项 targets（结构化）
 *   acceptance_text         config/acceptance.yaml 验收项 item/standard/method 点名
 *   house_mount_host        config/house.yaml 子件 mount.furniture_id 对宿主的绑定
 *   model_package_link      MODEL-PKG-* 的 furnishings select.ids（业务链接本身也是机器绑定）
 *   （前五通道为 PR-8 ask 点名；后两通道是同类机器绑定，一并显形。）
 *
 * 文本通道匹配规则（pending 台账、render/overrides、acceptance、开放决策四处共用
 * 同一个匹配器 mentionsObject/textMentions，任何通道不得各写一套——评审
 * 2026-11-07 blocking：pending/决策通道曾用裸 includes 子串，把 `vanity` 吃进
 * `mb.vanity_base_cabinet`，给 gbath.vanity 误挂 D19 与 6 条不相关台账行）：对每个
 * 对象匹配三种**全等**拼写，均取自 collectDeclaredFurnitureIds 的声明条目，一律
 * 词边界匹配（两侧排除类 `[A-Za-z0-9_.]` 含点号）——
 *   ① 稳定 id（gbath.vanity）；
 *   ② 「房间.类型」别名（guest_bath.vanity，台账/验收散文的在册写法）；
 *   ③ 裸类型名（mb_washbasin_cabinet），**仅当该类型全屋唯一**时（多房同型
 *      不匹配，避免把别房同型对象的提及错挂）。
 * 台账/验收散文里既无 id 也无别名也无唯一类型名的提及不关联——由本清单显形，不靠猜补齐。
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import * as yaml from 'js-yaml';
import {
  collectDeclaredFurnitureIds,
  type DeclaredFurnitureIdEntry,
  type FurniturePlacementKind,
} from '../../shared/furniture-object-id.js';
import { resolvePackageScope, type PackageScopeLink, type ProjectScopeInput } from '../../shared/package-scope.js';
import { loadScheduleState, type ScheduleState } from '../../shared/schedule-state.js';
import type { FurnishingsYaml } from '../../shared/types.js';
import { loadModelPackageLinks, MODEL_PACKAGE_LINKS_PATH } from '../../server/model-package-links.js';

type AnyRecord = Record<string, any>;

/** 引用通道（前五为 ask 点名；house_mount_host / model_package_link 是同类机器绑定）。 */
export type ObjectRefChannel =
  | 'anti_penetration_pair'
  | 'electrical_mount_anchor'
  | 'render_override'
  | 'cost_target'
  | 'acceptance_text'
  | 'house_mount_host'
  | 'model_package_link';

export interface ObjectReference {
  channel: ObjectRefChannel;
  /** 引用发生的具体位置：waiver id / 点位 id / 成本项 id / 验收项 id / 链接 id / 挂载子件 id / 文件行号。 */
  where: string;
  /** 引用串原样（稳定 id 或 legacy `furniture:*` 形式）。 */
  ref: string;
}

export interface ObjectCostRow {
  costId: string;
  name: string;
  pkgId: string;
  plannedCny: number | null;
  targets: string[];
  /** 工作包口径的实际侧（control.yaml budget 登记）：contracted_cny / paid_cny。null = 未登记。 */
  pkgContractedCny: number | null;
  pkgPaidCny: number | null;
}

export interface ObjectPackageLink {
  linkId: string;
  pkgId: string;
  mappingStatus: string;
}

export interface ObjectAcceptanceRef {
  checkId: string;
  item: string;
  via: string;
}

export interface ObjectPendingRef {
  id: string;
  title: string;
}

export interface ObjectDecisionRef {
  id: string;
  topic: string;
  note: string;
}

/** 单个被引用对象的完整迁移状态与业务链接（inventory 与单对象视图共用）。 */
export interface ObjectLedger {
  /** 引用串原样。 */
  ref: string;
  /** true = 稳定 id；false = legacy `furniture:*` 引用（迁移待办）。 */
  stable: boolean;
  roomId: string | null;
  type: string | null;
  placement: FurniturePlacementKind | 'unknown';
  mountHost: string | null;
  /** mount 挂载到本对象的子件（house.yaml 声明）。 */
  mountedChildren: string[];
  /** 别名（房间.类型），文本通道用它做全等匹配。 */
  aliases: string[];
  references: ObjectReference[];
  packageLinks: ObjectPackageLink[];
  costItems: ObjectCostRow[];
  acceptanceChecks: ObjectAcceptanceRef[];
  pendingEntries: ObjectPendingRef[];
  openDecisions: ObjectDecisionRef[];
}

export interface DanglingRef {
  ref: string;
  channel: ObjectRefChannel;
  where: string;
  /** house.yaml 中匹配到的同房同型条目数（legacy 引用专用；悬挂引用为 0）。 */
  candidateCount: number;
}

export interface ObjectLedgerReport {
  /** 稳定 id 对象（含仅被引用、未挂业务链接的——它们是工作清单主体）。 */
  objects: ObjectLedger[];
  /**
   * 成本归属未定的对象：被开放决策点名（topic/question/options/tracking_note）且
   * 无业务链接。独立于 objects 计算——D19 点名的条带 7 件里有 4 件没有任何机器
   * 绑定引用，只在这里显形；inventory 的引用通道表不收它们（决策点名不是绑定）。
   */
  undecided: ObjectLedger[];
  /** legacy `furniture:*` 引用（迁移待办）。 */
  legacyRefs: ObjectLedger[];
  /** 结构化/文本引用既不是稳定 id 也不是 legacy 形式的（悬挂引用）。 */
  danglingRefs: DanglingRef[];
  /** 全屋声明稳定 id 的 placed 条目数。 */
  declaredPlacedCount: number;
  /** 声明了 id 的 count-only 条目数（无 runtime 对象，即使被引用也不可归属）。 */
  declaredCountOnlyCount: number;
}

/** cost:by-object 一次查询的完整输入（loader 产出，纯函数消费）。 */
export interface CostByObjectContext {
  state: ScheduleState;
  furnishings: FurnishingsYaml;
  declared: DeclaredFurnitureIdEntry[];
  antiPenetration: AnyRecord;
  electricalPoints: AnyRecord[];
  overridesText: string;
  pendingText: string;
}

const LEGACY_REF_PATTERN = /^furniture:([A-Za-z0-9_]+):([A-Za-z0-9_]+):(\d+)$/;

const PLACEMENT_LABELS: Record<FurniturePlacementKind, string> = {
  mount: '挂载',
  wall: '挂墙（wall/along）',
  anchor: '锚点派生（anchor，见 shared/condensate-chain.ts）',
  absolute: '绝对坐标（x/z）',
  count_only: 'count-only（无 runtime 对象）',
};

export function placementLabel(placement: FurniturePlacementKind | 'unknown'): string {
  return placement === 'unknown' ? '未知（引用无法解析到唯一条目）' : PLACEMENT_LABELS[placement];
}

export function yuan(value: number | null | undefined): string {
  return value == null ? '待报价/待算量' : `¥${value.toLocaleString('zh-CN')}`;
}

/**
 * resolvePackageScope 的空项目输入：只取 objectIds（furnishings select.ids 通道）。
 * 房间/场景元素/点位清单为空时，room_ids/types/collections/点位通道解析为空集，
 * 不影响 objectIds——与 buildObjectPackageIndex 反查同一条实现。
 */
const EMPTY_PROJECT: ProjectScopeInput = {house: {rooms: [], sceneElements: [], electrical: [], plumbing: []}};

export function loadCostByObjectContext(root: string): CostByObjectContext {
  const state = loadScheduleState(root, {modelPackageLinks: loadModelPackageLinks(path.join(root, MODEL_PACKAGE_LINKS_PATH))});
  const house = yaml.load(fs.readFileSync(path.join(root, 'config/house.yaml'), 'utf8')) as {furnishings?: FurnishingsYaml};
  return {
    state,
    furnishings: house.furnishings ?? {},
    declared: collectDeclaredFurnitureIds(house.furnishings ?? {}),
    antiPenetration: yaml.load(fs.readFileSync(path.join(root, 'config/anti-penetration.yaml'), 'utf8')) as AnyRecord,
    electricalPoints: yaml.load(fs.readFileSync(path.join(root, 'config/electrical.yaml'), 'utf8')) as AnyRecord[],
    overridesText: fs.readFileSync(path.join(root, 'config/render/overrides.yaml'), 'utf8'),
    pendingText: fs.readFileSync(path.join(root, 'docs/pending-site-data.md'), 'utf8'),
  };
}

function newLedger(ref: string, entry: DeclaredFurnitureIdEntry | null, uniqueBareTypes: ReadonlySet<string> = new Set()): ObjectLedger {
  const aliases: string[] = entry ? [entry.id, `${entry.roomId}.${entry.type}`] : [];
  // 全屋唯一类型的裸类型名也是同一对象的全等拼写（如 mb_washbasin_cabinet 只在
  // master_bedroom 出现一次）；多房同型（curtain_set/wardrobe_180 等）不加。
  if (entry && uniqueBareTypes.has(entry.type)) aliases.push(entry.type);
  return {
    ref,
    stable: entry != null,
    roomId: entry?.roomId ?? null,
    type: entry?.type ?? null,
    placement: entry?.placement ?? 'unknown',
    mountHost: entry?.mountHost ?? null,
    mountedChildren: [],
    aliases,
    references: [],
    packageLinks: [],
    costItems: [],
    acceptanceChecks: [],
    pendingEntries: [],
    openDecisions: [],
  };
}

/** 是否挂了业务链接（工作包链接或成本项 targets）。 */
export function hasBusinessLink(ledger: ObjectLedger): boolean {
  return ledger.packageLinks.length > 0 || ledger.costItems.length > 0;
}

/** 摆位方式判定与 collectDeclaredFurnitureIds 同口径（mount > wall > anchor > 绝对 x/z > count-only）。 */
function placementOf(item: AnyRecord): FurniturePlacementKind {
  if (item.mount) return 'mount';
  if (item.wall) return 'wall';
  if (item.anchor) return 'anchor';
  if (item.x !== undefined || item.z !== undefined) return 'absolute';
  return 'count_only';
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 全等词边界（三种别名形态共用一个匹配器；评审 2026-11-07 blocking 修正）：
 * 两侧不得紧邻字母/数字/下划线/**点号/连字符/无空格斜杠**。点号必须在排除类里——否则
 * 裸类型名 `vanity` 会吃进 `mb.vanity_base_cabinet`（点号前缀的带点 id 片段）；`_` 挡住
 * `mb_vanity_base_cabinet` / `vanity_layout` / `faucet_gbath_vanity` 等下划线片段；
 * `-` 挡住 `strong-ded-fridge` 这类连字符点位 id 片段；`/` 挡住
 * `strong-ded-fridge/dishwasher/…` 这类省略式点位 id 列表里的片段（本仓点位 id 用
 * 连字符/下划线/点号分节，类型名只会以整词出现在散文里；排除类实测对现存全部
 * 真命中零损失——真命中的相邻字符均为汉字、空格、反引号或全角标点）。
 */
function aliasPattern(alias: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9_./-])${escapeRegExp(alias)}(?![A-Za-z0-9_./-])`);
}

/** 文本是否按全等词边界点名了任一别名。 */
function textMentions(text: string, aliases: readonly string[]): boolean {
  return aliases.some((alias) => aliasPattern(alias).test(text));
}

/**
 * 散文是否点名了该对象：三种全等拼写——稳定 id / 房间.类型 / 全屋唯一裸类型名
 * （多房同型的裸类型名不匹配），全部走同一词边界匹配。
 */
function mentionsObject(text: string, entry: DeclaredFurnitureIdEntry, uniqueBareTypes: ReadonlySet<string>): boolean {
  const aliases = [entry.id, `${entry.roomId}.${entry.type}`, ...(uniqueBareTypes.has(entry.type) ? [entry.type] : [])];
  return textMentions(text, aliases);
}

/**
 * 全量引用扫描（inventory 与单对象/汇总视图共用）。
 * 纯函数：不读 fs，全部输入来自 CostByObjectContext。
 */
export function buildObjectLedgerReport(ctx: CostByObjectContext): ObjectLedgerReport {
  const {state, furnishings, declared, antiPenetration, electricalPoints, overridesText, pendingText} = ctx;
  const placedById = new Map<string, DeclaredFurnitureIdEntry>();
  let countOnly = 0;
  for (const entry of declared) {
    if (entry.placement === 'count_only') {
      countOnly += 1;
      continue; // count-only 无 runtime 对象，即使被引用也不可归属（schedule-state 对 targets 同口径拦截）
    }
    placedById.set(entry.id, entry);
  }
  const typeCounts = new Map<string, number>();
  for (const entry of placedById.values()) typeCounts.set(entry.type, (typeCounts.get(entry.type) ?? 0) + 1);
  const uniqueBareTypes = new Set([...typeCounts.entries()].filter(([, count]) => count === 1).map(([type]) => type));
  const ledgerById = new Map<string, ObjectLedger>();
  const legacyByRef = new Map<string, ObjectLedger>();
  const danglingRefs: DanglingRef[] = [];

  const ledgerForStable = (ref: string): ObjectLedger | null => {
    const entry = placedById.get(ref);
    if (!entry) return null;
    let ledger = ledgerById.get(ref);
    if (!ledger) {
      ledger = newLedger(ref, entry, uniqueBareTypes);
      ledgerById.set(ref, ledger);
    }
    return ledger;
  };

  const recordRef = (channel: ObjectRefChannel, where: string, rawRef: string): void => {
    const ref = String(rawRef);
    const stableLedger = ledgerForStable(ref);
    if (stableLedger) {
      stableLedger.references.push({channel, where, ref});
      return;
    }
    const legacyMatch = LEGACY_REF_PATTERN.exec(ref);
    if (legacyMatch) {
      const [, room, type] = legacyMatch;
      let ledger = legacyByRef.get(ref);
      if (!ledger) {
        ledger = newLedger(ref, null);
        ledger.roomId = room;
        ledger.type = type;
        // 唯一同型条目：可以带出摆位方式，迁移时直接给它补 id；多条则留给人工按下标定位
        const candidates = (furnishings[room] ?? []).filter((item: AnyRecord) => item.type === type);
        if (candidates.length === 1) {
          ledger.placement = placementOf(candidates[0]);
          ledger.mountHost = candidates[0].mount?.furniture_id ?? null;
        }
        legacyByRef.set(ref, ledger);
      }
      ledger.references.push({channel, where, ref});
      return;
    }
    danglingRefs.push({ref, channel, where, candidateCount: 0});
  };

  // ① anti-penetration waivers pair（结构化）
  for (const waiver of antiPenetration.waivers ?? []) {
    for (const pairRef of waiver.pair ?? []) recordRef('anti_penetration_pair', `anti-penetration.yaml#${waiver.id}`, pairRef);
  }
  // ② electrical mount.furniture_id（结构化；issue #98 S2 起挂载声明由 mount_anchor 改 mount，
  // 定位来源升级后宿主绑定字段名同步——通道名 electrical_mount_anchor 保持稳定）
  for (const point of electricalPoints) {
    const furnitureId = point?.mount?.furniture_id;
    if (furnitureId) recordRef('electrical_mount_anchor', `electrical.yaml#${point.id}`, furnitureId);
  }
  // ③ render/overrides.yaml 文本点名（basis/reason 散文，按行定位）
  overridesText.split('\n').forEach((line, index) => {
    for (const entry of placedById.values()) {
      if (mentionsObject(line, entry, uniqueBareTypes)) {
        recordRef('render_override', `render/overrides.yaml:L${index + 1}`, entry.id);
      }
    }
  });
  // ④ 成本项 targets（结构化；schedule-state 已校验非空/已声明/placed）
  for (const pkg of state.control.work_packages ?? []) {
    for (const component of pkg.budget?.components ?? []) {
      for (const target of component.targets ?? []) recordRef('cost_target', `control.yaml#${component.id}`, target);
    }
  }
  // ⑤ acceptance.yaml 验收项 item/standard/method 点名（结构化字段内的文本）
  for (const phase of state.acceptance.phases ?? []) {
    for (const item of phase.items ?? []) {
      for (const field of ['item', 'standard', 'method'] as const) {
        const text = String(item[field] ?? '');
        for (const entry of placedById.values()) {
          if (mentionsObject(text, entry, uniqueBareTypes)) {
            recordRef('acceptance_text', `acceptance.yaml#${item.id}:${field}`, entry.id);
          }
        }
      }
    }
  }
  // ⑥ house.yaml 子件 mount.furniture_id 对宿主的绑定（同类机器绑定）
  for (const entry of declared) {
    if (entry.placement === 'mount' && entry.mountHost) {
      recordRef('house_mount_host', `house.yaml#${entry.id}:mount`, entry.mountHost);
    }
  }
  // ⑦ 工作包链接（OBJECT_ID_SOURCES 通道反查，与 3D 同一条实现）
  // 本通道只跟踪**家具对象**的机器绑定（MODEL-PKG-* 的 furnishings select.ids）。
  // 2026-11-07 issue #98 第三阶段 S4：overlay / model_geometry 的 select.ids 也进了
  // OBJECT_ID_SOURCES（3D 高亮要按宿主对象 id 选墙与围护构件，面层配方下沉后
  // types:[wall_region/sill_region/paint_region] 选择器无处可选），但那些 id 不是家具——
  // 不过滤就会在这里变成上百条「悬挂引用」。故按来源过滤，只收 furnishings。
  for (const link of state.modelPackageLinks.links) {
    const {objectIds, projectScope} = resolvePackageScope({scope: (link.scope ?? []).filter((ref) => ref.source === 'furnishings'), mapping_status: link.mapping_status} as unknown as PackageScopeLink, EMPTY_PROJECT);
    if (projectScope) continue; // 显式/派生全项目范围包不占反查（与 buildObjectPackageIndex 同口径）
    for (const ref of objectIds) {
      const ledger = ledgerForStable(ref);
      if (ledger) {
        ledger.references.push({channel: 'model_package_link', where: link.id ?? '(未命名链接)', ref});
        ledger.packageLinks.push({linkId: link.id ?? '(未命名链接)', pkgId: link.budget_ref?.id ?? '—', mappingStatus: link.mapping_status ?? '—'});
      } else {
        // assertSelector 已保证链接引用真实存在；此处再拦一次，拦到即视为悬挂引用显形
        danglingRefs.push({ref, channel: 'model_package_link', where: link.id ?? '(未命名链接)', candidateCount: 0});
      }
    }
  }

  // 宿主的挂载子件
  for (const entry of declared) {
    if (entry.placement === 'mount' && entry.mountHost) {
      ledgerForStable(entry.mountHost)?.mountedChildren.push(entry.id);
    }
  }

  // 成本项（targets）挂到对象；「实际」侧取工作包 budget 的合同/已付登记，不做任何推导
  for (const pkg of state.control.work_packages ?? []) {
    for (const component of pkg.budget?.components ?? []) {
      for (const target of component.targets ?? []) {
        ledgerForStable(String(target))?.costItems.push({
          costId: component.id,
          name: component.name,
          pkgId: pkg.id,
          plannedCny: component.planned_cny ?? null,
          targets: (component.targets ?? []).map(String),
          pkgContractedCny: pkg.budget?.contracted_cny ?? null,
          pkgPaidCny: pkg.budget?.paid_cny ?? null,
        });
      }
    }
  }

  // 开放决策点名（ledger 视图与「成本归属未定」全屋扫描共用同一 helper 与同一匹配器，
  // 两处不得各写一套——评审 2026-11-07 blocking 的根因之一就是两处各写）。
  const openDecisionsMentioning = (ledger: ObjectLedger): ObjectDecisionRef[] => {
    const hits: ObjectDecisionRef[] = [];
    for (const decision of state.decisionGates.decisions) {
      if (decision.status !== 'open') continue;
      const haystacks = [decision.topic, decision.question, ...(decision.options ?? []), decision.tracking_note ?? ''];
      if (!haystacks.some((text) => textMentions(String(text), ledger.aliases))) continue;
      hits.push({
        id: decision.id,
        topic: decision.topic,
        note: decision.scope === 'tracked'
          ? String(decision.tracking_note ?? '')
          : `scope=acceptance，阻塞 ${(decision.blocks ?? []).join('、') || '（未登记）'}`,
      });
    }
    return hits;
  };

  // 包级验收项（acceptance_refs + 内置 checks）+ 直接点名 → 结构化验收项视图
  const pkgById = new Map<string, AnyRecord>((state.control.work_packages ?? []).map((pkg: AnyRecord) => [pkg.id, pkg]));
  for (const ledger of ledgerById.values()) {
    for (const link of ledger.packageLinks) {
      const pkg = pkgById.get(link.pkgId);
      if (!pkg) continue;
      for (const refId of pkg.acceptance_refs ?? []) {
        const item = state.acceptanceById.get(String(refId));
        if (item) ledger.acceptanceChecks.push({checkId: String(refId), item: String(item.item ?? ''), via: `${pkg.id} acceptance_refs`});
      }
      for (const check of pkg.checks ?? []) {
        ledger.acceptanceChecks.push({checkId: String(check.id), item: String(check.item ?? ''), via: `${pkg.id} checks`});
      }
    }
    for (const ref of ledger.references) {
      if (ref.channel !== 'acceptance_text') continue;
      const checkId = /^acceptance\.yaml#([^:]+):/.exec(ref.where)?.[1];
      if (checkId && !ledger.acceptanceChecks.some((existing) => existing.checkId === checkId)) {
        const item = state.acceptanceById.get(checkId);
        ledger.acceptanceChecks.push({checkId, item: String(item?.item ?? ''), via: 'acceptance.yaml 点名'});
      }
    }
    // 关联 pending（台账按对象 id / 别名点名的表格行；同一词边界匹配器）
    for (const line of pendingText.split('\n')) {
      const rowMatch = /^\|\s*(\d+)\s*\|/.exec(line);
      if (!rowMatch) continue;
      if (!textMentions(line, ledger.aliases)) continue;
      const cells = line.split('|');
      ledger.pendingEntries.push({id: `#${rowMatch[1]}`, title: (cells[2] ?? '').trim()});
    }
    // 关联开放决策（topic/question/options/tracking_note 点名；同一词边界匹配器）
    for (const hit of openDecisionsMentioning(ledger)) ledger.openDecisions.push(hit);
  }

  // 成本归属未定：对全屋 placed 对象（含未进 ledger 的无引用对象）扫开放决策点名。
  // D19 在 tracking_note 里自带 owner/触发条件，这里原样透传、不拼接不缩写。
  const undecided: ObjectLedger[] = [];
  for (const entry of placedById.values()) {
    const ledger = ledgerById.get(entry.id) ?? newLedger(entry.id, entry, uniqueBareTypes);
    if (ledger.openDecisions.length === 0) {
      for (const hit of openDecisionsMentioning(ledger)) ledger.openDecisions.push(hit);
    }
    if (!hasBusinessLink(ledger) && ledger.openDecisions.length) undecided.push(ledger);
  }

  return {
    objects: [...ledgerById.values()].sort((left, right) => (Number(hasBusinessLink(right)) - Number(hasBusinessLink(left))) || left.ref.localeCompare(right.ref)),
    undecided: undecided.sort((left, right) => left.ref.localeCompare(right.ref)),
    legacyRefs: [...legacyByRef.values()],
    danglingRefs,
    declaredPlacedCount: placedById.size,
    declaredCountOnlyCount: countOnly,
  };
}

export function renderInventoryReport(report: ObjectLedgerReport): string {
  const lines: string[] = [];
  lines.push('# 对象绑定引用清单（cost:by-object --inventory）');
  lines.push('');
  lines.push('> 查询生成：每次运行从 config/ 与 schedule/ 现算，不是手写清单。通道：anti_penetration_pair（anti-penetration.yaml waivers.pair）、electrical_mount_anchor（electrical.yaml mount.furniture_id，issue #98 S2 起由 mount_anchor 改 mount）、render_override（render/overrides.yaml 文本点名）、cost_target（control.yaml 成本项 targets）、acceptance_text（acceptance.yaml 验收项点名）、house_mount_host（house.yaml mount.furniture_id 绑定宿主）、model_package_link（MODEL-PKG-* furnishings select.ids）。文本通道按「稳定 id / 房间.类型 / 全屋唯一裸类型名」全等匹配（多房同型的裸类型名不匹配）。');
  lines.push('');
  lines.push(`- 全屋声明稳定 id 的 placed 对象：**${report.declaredPlacedCount}** 件（另有声明 id 的 count-only 条目 ${report.declaredCountOnlyCount} 件——无 runtime 对象，不可归属）`);
  lines.push(`- 被机器绑定引用的对象：**${report.objects.length}** 件；其中已挂业务链接（工作包/成本项）：**${report.objects.filter(hasBusinessLink).length}** 件`);
  lines.push(`- legacy \`furniture:*\` 引用：**${report.legacyRefs.length}** 条；悬挂引用（对象匹配不到）：**${report.danglingRefs.length}** 条`);
  lines.push('');
  lines.push('| 对象 | 迁移状态 | 摆位 | 引用通道 | 业务链接 |');
  lines.push('|---|---|---|---|---|');
  for (const ledger of report.objects) {
    const channels = [...new Set(ledger.references.map((ref) => ref.channel))].join('、') || '—';
    const links = [
      ...ledger.packageLinks.map((link) => link.pkgId),
      ...ledger.costItems.map((item) => item.costId),
    ];
    lines.push(`| ${ledger.ref} | 稳定 id ✓（${ledger.roomId}/${ledger.type}） | ${placementLabel(ledger.placement)} | ${channels} | ${links.length ? links.join('、') : '—'} |`);
  }
  lines.push('');
  lines.push('## legacy 引用（`furniture:room:type:index` 形式，迁移待办）');
  lines.push('');
  if (report.legacyRefs.length) {
    for (const ledger of report.legacyRefs) {
      const channels = [...new Set(ledger.references.map((ref) => `${ref.channel}@${ref.where}`))].join('、');
      lines.push(`- \`${ledger.ref}\`（解析：${ledger.roomId}/${ledger.type}，摆位=${placementLabel(ledger.placement)}）← ${channels}`);
    }
  } else {
    lines.push('（无——全仓机器引用已全部走稳定 id）');
  }
  lines.push('');
  lines.push('## 悬挂引用（对象在 house.yaml 匹配不到）');
  lines.push('');
  if (report.danglingRefs.length) {
    for (const ref of report.danglingRefs) {
      lines.push(`- \`${ref.ref}\`（${ref.channel} @ ${ref.where}；同房同型条目 ${ref.candidateCount} 条）`);
    }
  } else {
    lines.push('（无）');
  }
  lines.push('');
  return lines.join('\n');
}

export function renderObjectLedger(ledger: ObjectLedger): string {
  const lines: string[] = [];
  lines.push(`# 按对象算账 · ${ledger.ref}`);
  lines.push('');
  if (!ledger.stable) {
    lines.push(`- 引用形式：legacy \`${ledger.ref}\`（解析 ${ledger.roomId}/${ledger.type}）——**未迁移到稳定 id**，成本归属无从登记`);
    return lines.join('\n');
  }
  lines.push(`- 声明：config/house.yaml ${ledger.roomId} / ${ledger.type}；别名 \`${ledger.roomId}.${ledger.type}\`；稳定 id ✓；摆位=${placementLabel(ledger.placement)}`);
  if (ledger.mountHost) lines.push(`- 挂载宿主：${ledger.mountHost}`);
  if (ledger.mountedChildren.length) lines.push(`- 挂载子件：${ledger.mountedChildren.join('、')}`);
  lines.push('');
  lines.push('## 工作包（select.ids 通道，与 3D 高亮/反查同源）');
  lines.push('');
  if (ledger.packageLinks.length) {
    for (const link of ledger.packageLinks) lines.push(`- ${link.linkId} → ${link.pkgId}（mapping_status=${link.mappingStatus}）`);
  } else {
    lines.push('- （无——未被任何 MODEL-PKG-* 的 furnishings select.ids 点名）');
  }
  lines.push('');
  lines.push('## 成本项（targets 声明）');
  lines.push('');
  if (ledger.costItems.length) {
    for (const item of ledger.costItems) {
      const shared = item.targets.length > 1 ? `（${item.targets.length} 对象共担：${item.targets.join('、')}；金额为成本项整体，不得按对象拆分加总）` : '';
      const actual = `实际侧（工作包 ${item.pkgId} 登记）：合同 ${item.pkgContractedCny == null ? '—' : yuan(item.pkgContractedCny)} · 已付 ${yuan(item.pkgPaidCny)}`;
      lines.push(`- ${item.costId}「${item.name}」｜planned ${yuan(item.plannedCny)}${shared}｜${actual}`);
    }
  } else if (ledger.openDecisions.length) {
    lines.push('- （无成本项 targets——归属未定，见下方开放决策）');
  } else {
    lines.push('- （无——没有任何成本项 targets 指向本对象）');
  }
  lines.push('');
  lines.push('## 验收项');
  lines.push('');
  if (ledger.acceptanceChecks.length) {
    const seen = new Set<string>();
    for (const check of ledger.acceptanceChecks) {
      if (seen.has(check.checkId)) continue;
      seen.add(check.checkId);
      lines.push(`- ${check.checkId}「${check.item}」｜via ${check.via}`);
    }
  } else {
    lines.push('- （无）');
  }
  lines.push('');
  lines.push('## 关联 pending（台账按对象 id / 别名点名的行）');
  lines.push('');
  if (ledger.pendingEntries.length) {
    for (const entry of ledger.pendingEntries) lines.push(`- ${entry.id} ${entry.title}`);
  } else {
    lines.push('- （无——台账未按本对象的 id、「房间.类型」别名或全屋唯一裸类型名词边界点名；台账以多房同型裸类型名/点位 id 引用的不在此列）');
  }
  lines.push('');
  lines.push('## 关联决策门禁（open）');
  lines.push('');
  if (ledger.openDecisions.length) {
    for (const decision of ledger.openDecisions) lines.push(`- ${decision.id} ${decision.topic}｜${decision.note.replaceAll('|', '\\|')}`);
  } else {
    lines.push('- （无）');
  }
  return lines.join('\n');
}

export function renderOwnershipSummary(report: ObjectLedgerReport): string {
  const lines: string[] = [];
  lines.push('# 按对象算账 · 有归属对象汇总');
  lines.push('');
  lines.push('> 归属 = 工作包链接（MODEL-PKG-* 的 furnishings select.ids，OBJECT_ID_SOURCES 通道）或成本项 `targets`（schedule/phase-1/control.yaml）。共担成本项的金额是**成本项整体**，不得跨对象加总；单对象完整链用 `npm run cost:by-object <object_id>`，全量引用工作清单用 `npm run cost:by-object -- --inventory`。');
  lines.push('');
  const owned = report.objects.filter(hasBusinessLink);
  lines.push(`有归属对象 ${owned.length} 件（全屋声明稳定 id 的 placed 对象 ${report.declaredPlacedCount} 件；被机器引用 ${report.objects.length} 件）。`);
  lines.push('');
  lines.push('| 对象 | 房间/类型 | 摆位 | 工作包 | 成本项 | 成本项 planned | 工作包已付 |');
  lines.push('|---|---|---|---|---|---:|---:|');
  for (const ledger of owned) {
    const pkgIds = [...new Set(ledger.packageLinks.map((link) => link.pkgId))];
    if (ledger.costItems.length) {
      for (const item of ledger.costItems) {
        const shared = item.targets.length > 1 ? `（${item.targets.length} 对象共担）` : '';
        lines.push(`| ${ledger.ref} | ${ledger.roomId}/${ledger.type} | ${placementLabel(ledger.placement)} | ${pkgIds.join('、') || '—'} | ${item.costId} | ${yuan(item.plannedCny)}${shared} | ${yuan(item.pkgPaidCny)} |`);
      }
    } else {
      lines.push(`| ${ledger.ref} | ${ledger.roomId}/${ledger.type} | ${placementLabel(ledger.placement)} | ${pkgIds.join('、') || '—'} | — | — | — |`);
    }
  }
  // 成本项口径合计：按成本项 id 去重（共担项只计一次），未定价项显形不编数
  const uniqueCosts = new Map<string, ObjectCostRow>();
  for (const ledger of owned) {
    for (const item of ledger.costItems) uniqueCosts.set(item.costId, item);
  }
  const priced = [...uniqueCosts.values()].filter((item) => item.plannedCny != null);
  const unpriced = [...uniqueCosts.values()].filter((item) => item.plannedCny == null);
  const total = priced.reduce((sum, item) => sum + (item.plannedCny ?? 0), 0);
  lines.push('');
  lines.push(`成本项口径合计（按成本项去重、每项只计一次，共担项不重复计）：**${yuan(total)}**（${priced.length} 项已定价；未定价 ${unpriced.length} 项${unpriced.length ? `：${unpriced.map((item) => item.costId).join('、')}` : ''}）。金额全部来自 control.yaml 的 planned_cny 登记值，本脚本不做任何价格推导。`);
  lines.push('');
  const undecided = report.undecided;
  lines.push('## 成本归属未定（开放决策点名，非归属认定）');
  lines.push('');
  if (undecided.length) {
    lines.push('| 对象 | 房间/类型 | 决策 | 说明 |');
    lines.push('|---|---|---|---|');
    for (const ledger of undecided) {
      for (const decision of ledger.openDecisions) {
        lines.push(`| ${ledger.ref} | ${ledger.roomId}/${ledger.type} | ${decision.id} ${decision.topic} | ${decision.note.replaceAll('|', '\\|')} |`);
      }
    }
  } else {
    lines.push('（无——当前没有「被开放决策点名且无成本归属」的对象）');
  }
  lines.push('');
  lines.push('> 注：关联 pending 只按「对象 id / 房间.类型 / 全屋唯一裸类型名」全等点名；台账（docs/pending-site-data.md）里以多房同型裸类型名或点位 id 引用对象的行不会被关联——那是台账未按对象 id 登记的现状，由本视图显形，不靠猜补齐。');
  lines.push('');
  return lines.join('\n');
}

function main(): void {
  const root = process.cwd();
  const args = process.argv.slice(2);
  const inventoryMode = args.includes('--inventory');
  const positional = args.filter((arg) => !arg.startsWith('--'));
  if (positional.length > 1) {
    console.error('用法：npm run cost:by-object [<object_id>]（或加 --inventory 列机器绑定引用清单）');
    process.exit(2);
  }
  const ctx = loadCostByObjectContext(root);
  if (ctx.state.errors.length) {
    console.error([
      'schedule 控制源校验失败（shared/schedule-state.ts loadScheduleState），拒绝按对象出账：',
      ...ctx.state.errors.map((error) => `- ${error}`),
    ].join('\n'));
    process.exit(1);
  }
  const report = buildObjectLedgerReport(ctx);
  if (inventoryMode) {
    console.log(renderInventoryReport(report));
    process.exit(0);
  }
  if (!positional.length) {
    console.log(renderOwnershipSummary(report));
    process.exit(0);
  }
  const query = positional[0];
  const universe = [...report.objects, ...report.undecided];
  const ledger = universe.find((candidate) => candidate.ref === query)
    ?? universe.find((candidate) => candidate.aliases.includes(query));
  if (!ledger) {
    console.error([
      `未知对象 id：${query}（既不是已声明稳定 id，也不是「房间.类型」别名，或该对象未被任何机器引用/开放决策点名）`,
      '可用清单：npm run cost:by-object -- --inventory',
    ].join('\n'));
    process.exit(1);
  }
  console.log(renderObjectLedger(ledger));
}

const invokedDirectly = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
