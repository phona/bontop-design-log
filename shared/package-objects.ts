/**
 * 链接 scope → 工程对象 ID 的解析（issue #191，issue #98 验收清单第 3、4 项）。
 *
 * 为什么需要它：`config/model-package-links.yaml` 的 scope 选择器此前只有
 * `server/model-package-links.ts` 的 `assertSelector` 做「值存在」校验，没有任何地方把
 * 「一个选择器到底选中了哪些对象」算出来。结果：
 *   - 工作包（`schedule/phase-1/control.yaml` 的 `work_packages[]`）没有对象 targets；
 *   - 验收项只能靠 `rooms: [...]` 与散文点名；
 *   - stale 指纹只能整份权威文件求和（单对象改动让所有引用该文件的工作包一起 stale）。
 *
 * 本模块给出**唯一**的解析实现：输入是解析好的 authority 文档（overlay 已由
 * `server/overlay-merge.ts` 合并），输出是对象 id 集合 + 对象声明的稳定摘要。消费方：
 *   1. `server/model-package-links.ts` 装载时解析并把结果挂在返回对象上（非 enumerable，
 *      `/api/model-package-links` 的 JSON 形状不变）；
 *   2. `shared/schedule-state.ts` 用摘要建对象粒度指纹；
 *   3. `scripts/verify/facts/verify-facts.ts` 把解析结果作为 `package_objects` 数据集，
 *      供 `config/facts.yaml` 的三条 `object_link` 契约做反证。
 *
 * 选择器语义（与 `shared/package-scope.ts` 的 3D 展开口径对齐，但这里按**对象 ID** 而非
 * 高亮能力）：单条 scope ref 内，多个字段之间取**交集**（如
 * `{room_ids: [kitchen], types: [sink]}` = 厨房里 type=sink 的对象），字段的多值之间取并集；
 * 多条 scope ref 之间取并集。这修正了一个历史误读：`shared/package-scope.ts` 把
 * room_ids 只记进 roomIds、types 只对 sceneElements 匹配，家具来源的 types 从来解析不出
 * 对象（见该文件 OBJECT_ID_SOURCES 注释）——按交集解析才是「房间 + 类型」原本的意图。
 *
 * 解析不出对象的选择器不静默丢弃：进 `unresolved`（整条 ref 解析为空 / 未知来源 / 未知字段）。
 * 单个过滤值无命中（如 count-only 家具的 type）进 `dropped`，因为 ref 本身仍可能解析出其它对象。
 */

import { furnitureObjectId } from './furniture-object-id.js';

/** 全模型标记：`mapping_status: project_scope` 链接的对象集。写进 targets 时必须加引号。 */
export const ALL_MODEL_TARGET = '*';

type AnyRecord = Record<string, any>;

/** 单个 authority 文档里的对象登记：id → 声明节点 + 房间归属（有则记）。 */
export interface AuthorityObject {
  id: string;
  node: AnyRecord;
  /** 对象自身的 `room`（点位/吊顶分区/家具）或家具声明的房组名。 */
  room?: string;
  /** model_geometry 的集合归属：room / wall / opening / beam / platform / vertex。 */
  collection?: string;
  /**
   * 宿主对象 id（目前只有墙洞：wall.openings[] 的声明本身不带 wall 字段，父墙只在
   * 嵌套位置里）。摘要键必须带它——否则把门洞从一面墙搬到另一面墙，洞的声明一字未改，
   * 指纹却不变，layout-resolver 已按新宿主墙重算位置（issue #191 Codex blocking）。
   */
  parent?: string;
}

/** 对象摘要键：宿主关系也是对象身份的一部分（墙洞 @ 父墙）。 */
export function objectDigestKey(source: string, object: AuthorityObject): string {
  return `${source}:${object.id}${object.parent ? `@${object.parent}` : ''}`;
}

export interface AuthorityObjectIndex {
  source: string;
  objects: Map<string, AuthorityObject>;
}

/**
 * `config/model-package-links.yaml` 的一条 scope ref 的 select 形状。
 * 与 `shared/model-package-links.ts` 的 SelectorSchema 保持同步；这里只读不校验。
 */
export interface ObjectScopeSelector {
  all?: boolean;
  ids?: string[];
  room_ids?: string[];
  types?: string[];
  layers?: string[];
  trade?: string[];
  plan_ids?: string[];
  collections?: string[];
}

export interface ObjectScopeRef {
  source: string;
  select: ObjectScopeSelector;
}

/** 单条 scope ref 的解析结果。 */
export interface ScopeObjectResolution {
  objectIds: string[];
  /** 整条 ref 解析为空 / 未知来源或字段：必须显形，不许静默当 0 个对象。 */
  unresolved: string[];
  /** 单个过滤值在该来源里 0 命中；ref 仍可能解析出其它对象（count-only 家具即此形态）。 */
  dropped: string[];
}

export interface LinkObjectResolution {
  linkId: string;
  /** 对应 phase control 的工作包 id（budget_ref.id）。 */
  packageId: string;
  /** 解析出的对象 id（裸 id，排序去重）；`project_scope` 链接 = ['*']。 */
  objectIds: string[];
  /** `source:id` → 对象声明的 sha256（project_scope 链接为空，改按整份权威文件）。 */
  digests: Record<string, string>;
  /** 参与解析的 authority 来源（project_scope 的整份文件指纹按它取 authorities）。 */
  sources: string[];
  projectScope: boolean;
  unresolved: string[];
  /** 供契约/人读：每条 scope ref 的解析摘要。 */
  refs: Array<{source: string; objectCount: number; unresolved: string[]; dropped: string[]}>;
}

/** 深度键排序后的 JSON：同一对象声明在不同书写顺序下摘要相同。 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as AnyRecord;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * 把一个 authority 文档展开成对象索引。
 *
 * `source` 的形状是数据约定，不是猜测：每个来源的对象住在哪个字段，由各自 schema 决定。
 * 未登记的来源退化为「递归收集带 id 的对象」——只服务 `all: true` 的全集枚举，
 * 解析具体选择器时仍按来源分支处理。
 */
export function indexAuthorityObjects(source: string, doc: unknown): AuthorityObjectIndex {
  const index = new Map<string, AuthorityObject>();
  const add = (id: unknown, node: AnyRecord, extra: {room?: string; collection?: string; parent?: string} = {}) => {
    if (typeof id !== 'string' || !id || index.has(id)) return;
    index.set(id, {id, node, ...extra});
  };
  const d = (doc ?? {}) as AnyRecord;

  switch (source) {
    case 'model_geometry': {
      // 顶点也是几何对象：墙的 from/to、房间/平台的 boundary、门洞 anchor 都以 id 引用顶点。
      // 不索引顶点时，移动一个顶点不会改变任何已收录对象的声明，引用闭包也无从捕获——
      // 移墙后相关工作包的旧通过记录仍会显得有效（issue #191 Codex blocking）。
      for (const vertex of d.vertices ?? []) add(vertex.id, vertex, {collection: 'vertex'});
      for (const room of d.rooms ?? []) add(room.id, room, {room: room.id, collection: 'room'});
      for (const wall of d.walls ?? []) {
        add(wall.id, wall, {collection: 'wall'});
        for (const opening of wall.openings ?? []) add(opening.id, opening, {collection: 'opening', parent: wall.id});
      }
      for (const beam of d.beams ?? []) add(beam.id, beam, {collection: 'beam'});
      if (d.platform?.id) add(d.platform.id, d.platform, {collection: 'platform'});
      break;
    }
    case 'furnishings': {
      for (const [roomId, items] of Object.entries((d.furnishings ?? {}) as Record<string, AnyRecord[]>)) {
        (items ?? []).forEach((item, indexInRoom) => {
          // count-only 条目没有 runtime 对象（无 x/z、无 wall/mount/anchor），不进对象索引。
          // 这是 `collectDeclaredFurnitureIds` 的同一判据（shared/furniture-object-id.ts）。
          const placed = !!(item.mount || item.wall || item.anchor || item.x !== undefined || item.z !== undefined);
          if (!placed) return;
          add(furnitureObjectId(roomId, item as {id?: string; type: string}, indexInRoom), item, {room: roomId});
        });
      }
      break;
    }
    default: {
      if (Array.isArray(doc)) {
        for (const item of doc) {
          if (item && typeof item === 'object' && typeof (item as AnyRecord).id === 'string') {
            const record = item as AnyRecord;
            add(record.id, record, {room: typeof record.room === 'string' ? record.room : undefined});
          }
        }
        break;
      }
      const walk = (node: unknown) => {
        if (Array.isArray(node)) {
          for (const item of node) walk(item);
          return;
        }
        if (!node || typeof node !== 'object') return;
        const record = node as AnyRecord;
        if (typeof record.id === 'string') add(record.id, record);
        for (const value of Object.values(record)) walk(value);
      };
      walk(doc);
      break;
    }
  }
  return {source, objects: index};
}

function matchesField(object: AuthorityObject, source: string, field: keyof ObjectScopeSelector, value: string): boolean {
  switch (field) {
    case 'ids':
      return object.id === value;
    case 'room_ids':
      return source === 'model_geometry'
        ? object.collection === 'room' && object.id === value
        : object.room === value;
    case 'types':
      return object.node.type === value;
    case 'layers':
      return object.node.layer === value;
    case 'trade':
      return object.node.trade === value;
    case 'collections':
      // 选择器写复数（model-geometry 的 rooms/walls/openings），索引记单数。
      return object.collection === ({rooms: 'room', walls: 'wall', openings: 'opening', beams: 'beam'} as Record<string, string>)[value];
    case 'plan_ids':
      // plan_ids 指向 config/hvac.yaml 的 plans[].id；展开见 resolveScopeObjects。
      return false;
    default:
      return false;
  }
}

const FILTER_FIELDS = ['ids', 'room_ids', 'types', 'layers', 'trade', 'collections'] as const;

/**
 * 解析一条 scope ref。字段之间取交集；`plan_ids` 单独展开成「方案对象 + 其内联设备」。
 *
 * 空集判定：所有字段交集为空 → unresolved（并列出各字段单独命中数，便于定位是哪个字段
 * 把范围收窄成空）。单字段 0 命中 → dropped（值本身不存在于该来源，但不影响交集）。
 */
export function resolveScopeObjects(index: AuthorityObjectIndex, select: ObjectScopeSelector, docs?: Map<string, unknown>): ScopeObjectResolution {
  const unresolved: string[] = [];
  const dropped: string[] = [];
  const present = FILTER_FIELDS.filter((field) => (select[field] ?? []).length > 0);
  const hasPlan = (select.plan_ids ?? []).length > 0;

  if (select.all === true) {
    return {objectIds: [...index.objects.keys()].sort(), unresolved, dropped};
  }

  let candidates: AuthorityObject[] | undefined;
  for (const field of present) {
    const values = select[field] as string[];
    const matched = new Set<AuthorityObject>();
    for (const value of values) {
      let hits = 0;
      for (const object of index.objects.values()) {
        if (!matchesField(object, index.source, field, value)) continue;
        matched.add(object);
        hits += 1;
      }
      if (!hits) dropped.push(`${index.source}.${field}: ${value}`);
    }
    candidates = candidates ? candidates.filter((object) => matched.has(object)) : [...matched];
  }

  if (hasPlan) {
    const plans = ((docs?.get('hvac') as AnyRecord | undefined)?.plans ?? []) as AnyRecord[];
    const planObjectIds = new Set<string>();
    for (const planId of select.plan_ids ?? []) {
      const plan = plans.find((entry) => entry.id === planId);
      if (!plan) {
        dropped.push(`${index.source}.plan_ids: ${planId}`);
        continue;
      }
      // 方案对象本身 + 方案内联设备（outdoor / indoor）：内机在 ceiling.yaml 里另立对象，
      // 这里只收方案文档自己声明的设备，不跨文档猜测。
      planObjectIds.add(plan.id);
      for (const unit of [plan.outdoor, ...(plan.indoor ?? []), ...(plan.indoor_units ?? [])]) {
        if (unit?.id) planObjectIds.add(unit.id);
      }
    }
    candidates = candidates
      ? candidates.filter((object) => planObjectIds.has(object.id))
      : [...index.objects.values()].filter((object) => planObjectIds.has(object.id));
  }

  if (!present.length && !hasPlan) {
    unresolved.push(`${index.source}: 空选择器（schema 已拒绝，这里兜底显形）`);
    return {objectIds: [], unresolved, dropped};
  }
  const objectIds = (candidates ?? []).map((object) => object.id).sort();
  if (!objectIds.length) {
    unresolved.push(`${index.source}: 选择器 ${stableStringify(select)} 解析为空${dropped.length ? `（无命中：${dropped.join('；')}）` : ''}`);
  }
  return {objectIds, unresolved, dropped};
}

export interface ResolveLinkOptions {
  /** authority 名 → 解析后的文档（overlay 传 loadOverlayDoc() 的合并结果）。 */
  docs: Map<string, unknown>;
  /** 预建索引；缺省时按 docs 现建（调用方批量解析时自行缓存）。 */
  indexes?: Map<string, AuthorityObjectIndex>;
}

/**
 * 解析一条 model-package-link 的对象集。
 *
 * `mapping_status: project_scope`（PKG-000/005/010/142/170/900）是显式全项目声明：
 * 对象集 = `['*']`，不做选择器展开（与 `shared/package-scope.ts` 的 3D 语义一致）。
 */
export function resolveLinkObjects(link: {id: string; mapping_status?: string; budget_ref?: {id?: string}; scope?: ObjectScopeRef[]}, options: ResolveLinkOptions): LinkObjectResolution {
  const sources = [...new Set((link.scope ?? []).map((ref) => ref.source))];
  const projectScope = link.mapping_status === 'project_scope';
  const base: LinkObjectResolution = {
    linkId: link.id,
    packageId: link.budget_ref?.id ?? '',
    objectIds: projectScope ? [ALL_MODEL_TARGET] : [],
    digests: {},
    sources,
    projectScope,
    unresolved: [],
    refs: [],
  };
  if (projectScope) return base;

  const ids = new Set<string>();
  for (const ref of link.scope ?? []) {
    const index = options.indexes?.get(ref.source) ?? (options.docs.has(ref.source)
      ? indexAuthorityObjects(ref.source, options.docs.get(ref.source))
      : undefined);
    if (!index) {
      base.unresolved.push(`${ref.source}: 未登记的 authority 来源`);
      base.refs.push({source: ref.source, objectCount: 0, unresolved: [`${ref.source}: 未登记的 authority 来源`], dropped: []});
      continue;
    }
    const resolved = resolveScopeObjects(index, ref.select ?? {}, options.docs);
    for (const id of resolved.objectIds) ids.add(id);
    base.unresolved.push(...resolved.unresolved);
    base.refs.push({source: ref.source, objectCount: resolved.objectIds.length, unresolved: resolved.unresolved, dropped: resolved.dropped});
  }
  base.objectIds = [...ids].sort();
  // not_modelled 的链接按 schema 本就不许声明 scope（「不得发明对象」），空集是设计而非缺陷。
  if (!base.objectIds.length && link.mapping_status !== 'not_modelled') base.unresolved.push(`${link.id}: scope 解析出的对象集为空`);
  return base;
}

/**
 * 计算解析结果的对象摘要：`source:id` → sha256(声明)。
 *
 * 只摘要**对象声明本身**，不摘要整份文件——这正是对象粒度指纹的来源。找不到对象节点
 * （理论上 assertSelector 已拦住）记 unresolved，不静默跳过。
 *
 * **引用闭包（决策 3「宁可过度 stale，不能漏 stale」）**：对象的声明里会以 id 字符串引用
 * 别的对象（家具 `anchor.source=hvac`、`mount.furniture_id`、点位 `wall`/`room`、路线端点），
 * 被引用对象的声明变化会改变本对象的派生事实（例如内机移动 → 挂在它上面的家具位置变）。
 * 因此摘要沿「声明里出现的已知对象 id」递归展开（visited 去重），把被引用对象的声明也计入。
 * 方向只会更宽（无关对象进指纹 → 多几条 stale），不会更窄；跨文档 id 同名时全部计入。
 */
export function digestResolvedObjects(
  resolution: LinkObjectResolution,
  options: ResolveLinkOptions,
  sha256: (text: string) => string,
): LinkObjectResolution {
  if (resolution.projectScope) return resolution;
  const digests: Record<string, string> = {};
  const found = new Set<string>();
  for (const source of resolution.sources) {
    const index = options.indexes?.get(source) ?? (options.docs.has(source) ? indexAuthorityObjects(source, options.docs.get(source)) : undefined);
    if (!index) continue;
    for (const object of index.objects.values()) {
      if (!resolution.objectIds.includes(object.id)) continue;
      digests[objectDigestKey(source, object)] = sha256(stableStringify(object.node));
      found.add(object.id);
    }
  }
  for (const id of resolution.objectIds) {
    if (!found.has(id)) resolution.unresolved.push(`${id}: 对象声明节点缺失，无法建对象指纹`);
  }

  // 引用闭包：已知 id → 声明节点（只看参与解析的 authority 来源，不把预算/分期文件当对象域）。
  const referents = new Map<string, Array<{source: string; object: AuthorityObject}>>();
  for (const [source, index] of options.indexes ?? []) {
    for (const object of index.objects.values()) {
      const list = referents.get(object.id) ?? [];
      list.push({source, object});
      referents.set(object.id, list);
    }
  }
  const queue: Array<{source: string; object: AuthorityObject}> = [];
  for (const source of resolution.sources) {
    const index = options.indexes?.get(source);
    if (!index) continue;
    for (const object of index.objects.values()) {
      if (resolution.objectIds.includes(object.id)) queue.push({source, object});
    }
  }
  while (queue.length) {
    const current = queue.shift()!;
    // 宿主关系（墙洞 @ 父墙）也要进闭包：门洞的几何依赖父墙端点，只把父墙写进摘要键
    // 还不够——改变父墙 from/to 时，洞自己的声明一字未改，必须靠父墙声明进摘要才会 stale。
    const referenced = collectReferencedStrings(current.object.node);
    if (current.object.parent) referenced.add(current.object.parent);
    for (const value of referenced) {
      for (const referent of referents.get(value) ?? []) {
        const key = objectDigestKey(referent.source, referent.object);
        if (digests[key] !== undefined) continue;
        digests[key] = sha256(stableStringify(referent.object.node));
        queue.push(referent);
      }
    }
  }
  resolution.digests = digests;
  return resolution;
}

/** 声明子树里的全部字符串值（精确匹配用；不做子串匹配，避免注释/散文误命中）。 */
function collectReferencedStrings(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    out.add(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectReferencedStrings(item, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as AnyRecord)) collectReferencedStrings(item, out);
  }
  return out;
}
