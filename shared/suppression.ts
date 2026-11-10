/**
 * suppress 语义的唯一权威实现（2026-11-07 issue #98 第三阶段 S3）。
 *
 * 改判前的形态：config/layout/overlay.yaml 顶层 `suppress:`（8 条 wall/walls/region 选择器）
 * + config/spatial-validation.yaml 的 `overlay_replacements` 镜像表（14 行，一行一被压制的墙：
 * suppress 的墙 ↔ curtain_run/railing_run ↔ kind/part/join），由 shared/spatial-validation.ts
 * 约 100 行校验器守护；语义本身在 10 处独立实现里各写一遍（overlay-merge / budget-calculator /
 * penetration-scene / paint-cost-comparison / verify-rules / verify-data-consistency /
 * verify-electrical-lint / verify-mep-lint / verify-collision-coverage / spatial-validation，
 * 外加 docs 生成器 current-values-render 一处漏登记的同款副本）。
 *
 * 改判后（S3）：suppress 是 model-geometry.yaml 墙条目的属性
 * `suppressed: { reason, replacement: <envelope 对象 id> }`——replacement 从"猜关联的镜像表"
 * 变成对象 id 直引用；region 包围盒选择器随镜像表一并退场（迁移前 0 使用，且"按几何选墙"
 * 无法表达为墙的属性）。全部消费方 import 本模块，禁止再各自 flatMap 一份 suppress 清单。
 *
 * 为什么放 shared/ 而不是 schema 源头 server/overlay-merge.ts：消费者横跨三棵树——
 * server/（overlay-merge / budget-calculator / paint-cost-comparison / index 的 view-context）、
 * scripts/（六个 verifier + 文档生成器）、shared/ 自身（penetration / finish / render）。
 * overlay-merge 只是 suppress 的旧 schema 宿主，不是语义的所有者；放 server/ 会让 scripts/
 * 与 shared/ 反向依赖 server，只有 shared/ 是三者共同的下游。
 */

import type { OverlayReplacement, SpatialIssue } from './spatial-validation.js';
import type { WallSuppression } from './types.js';

/** 墙的最小形状：任何带 id + suppressed 的墙列表（WallDef / ResolvedWall / WallSegment / 原始 yaml）。 */
export interface SuppressibleWall {
  id?: string;
  suppressed?: WallSuppression;
}

/** 该墙是否被 suppress（实体盒不渲染/不碰撞/不可挂载）。 */
export function isWallSuppressed(wall: SuppressibleWall | undefined): boolean {
  return Boolean(wall?.suppressed);
}

/** 取某面墙的 suppress 声明（未压制返回 undefined）。 */
export function suppressionOf(walls: readonly SuppressibleWall[], wallId: string | undefined): WallSuppression | undefined {
  if (!wallId) return undefined;
  return walls.find((wall) => wall.id === wallId)?.suppressed;
}

/** 全部被 suppress 的墙 id（稳定序：按墙列表原序，调用方要集合自建 Set）。 */
export function suppressedWallIds(walls: readonly SuppressibleWall[]): string[] {
  const ids: string[] = [];
  for (const wall of walls) {
    if (wall.suppressed && wall.id && !ids.includes(wall.id)) ids.push(wall.id);
  }
  return ids;
}

/** 被 suppress 的墙 id 集合（O(1) 查询的场景用这个，别在循环里 includes）。 */
export function suppressedWallIdSet(walls: readonly SuppressibleWall[]): Set<string> {
  return new Set(suppressedWallIds(walls));
}

/** 围护对象引用墙的最小形状（ curtain_run / railing_run 的 wall/walls/parts）。 */
export interface SuppressionElementRef {
  id: string;
  type: string;
  wall?: string;
  walls?: string[];
  parts?: Array<{ id?: string; wall?: string; walls?: string[]; wallRefs?: string[] }>;
}

/**
 * 围护对象引用了哪些墙：parts 是规范来源（part 级 wall/walls/wallRefs），
 * 无 parts 时退到根级 wall/walls。原 overlay-merge / penetration-scene /
 * spatial-validation 各写了一份，S3 收敛到此处。
 */
export function elementWallRefs(element: SuppressionElementRef): string[] {
  const parts = element.parts ?? [];
  if (parts.length > 0) {
    return parts.flatMap((part) => [...(part.wall ? [part.wall] : []), ...(part.walls ?? []), ...(part.wallRefs ?? [])]);
  }
  return [...(element.wall ? [element.wall] : []), ...(element.walls ?? [])];
}

/** 能接管墙实体表现的围护对象类型（其余类型不能当 replacement）。 */
const STRUCTURAL_KINDS = new Set(['curtain_run', 'railing_run']);

const SUPPRESSION_SOURCE = 'config/layout/model-geometry.yaml + config/model/envelope/openings.yaml';

/**
 * suppress 改判后的替换关系校验（取代原 overlay_replacements 镜像表的 ~100 行校验器）：
 * 每条墙属性自带 replacement 对象 id 直引用，这里只查直引用本身是否自洽——
 * 镜像表（墙↔对象↔kind↔part 的手工第二份）随之删除。
 *
 * 覆盖原校验器的五类真实问题：替换对象不存在 / 类型不是结构围护 / 没引用这面墙 /
 * 一面墙被多个结构对象接管 / 结构对象挂在未 suppress 的墙上。任一条缺失都会让
 * "玻璃幕墙接管实体墙"这条链静默断裂（墙没了、玻璃也没声明）。
 */
export function validateWallSuppressions(
  walls: readonly SuppressibleWall[],
  elements: readonly SuppressionElementRef[],
  source: string = SUPPRESSION_SOURCE,
): SpatialIssue[] {
  const issues: SpatialIssue[] = [];
  const elementById = new Map(elements.map((element) => [element.id, element]));
  const suppressedById = new Map(walls.filter((wall) => wall.suppressed).map((wall) => [wall.id ?? '', wall.suppressed!]));
  const ownersByWall = new Map<string, Set<string>>();

  for (const [wallId, suppression] of suppressedById) {
    if (typeof suppression.reason !== 'string' || suppression.reason === '' || typeof suppression.replacement !== 'string' || suppression.replacement === '') {
      issues.push({ level: 'error', code: 'suppression_declaration_invalid', entity: wallId, source, message: `suppressed wall ${wallId} 的声明缺 reason/replacement（对象 id 直引用，禁止只写一半）`, evidence: { wall: wallId, suppressed: suppression } });
      continue;
    }
    const element = elementById.get(suppression.replacement);
    if (!element) {
      issues.push({ level: 'error', code: 'suppression_replacement_unknown', entity: suppression.replacement, source, message: `suppressed wall ${wallId} 的 replacement ${suppression.replacement} 不是已声明的围护对象`, evidence: { wall: wallId, replacement: suppression.replacement } });
      continue;
    }
    if (!STRUCTURAL_KINDS.has(element.type)) {
      issues.push({ level: 'error', code: 'suppression_replacement_kind_invalid', entity: suppression.replacement, source, message: `replacement ${suppression.replacement} 是 ${element.type}，只有 curtain_run/railing_run 能接管墙的实体表现`, evidence: { wall: wallId, replacement: suppression.replacement, actual: element.type, allowed: [...STRUCTURAL_KINDS] } });
      continue;
    }
    if (!elementWallRefs(element).includes(wallId)) {
      issues.push({ level: 'error', code: 'suppression_replacement_not_covering', entity: suppression.replacement, source, message: `replacement ${suppression.replacement} 没有引用被 suppress 的墙 ${wallId}`, evidence: { wall: wallId, replacement: suppression.replacement } });
    }
    const owners = ownersByWall.get(wallId) ?? new Set<string>();
    owners.add(element.id);
    ownersByWall.set(wallId, owners);
  }

  for (const element of elements) {
    if (!STRUCTURAL_KINDS.has(element.type)) continue;
    for (const wallId of elementWallRefs(element)) {
      const owners = ownersByWall.get(wallId) ?? new Set<string>();
      owners.add(element.id);
      ownersByWall.set(wallId, owners);
      if (!suppressedById.has(wallId)) {
        issues.push({ level: 'error', code: 'overlay_on_unsuppressed_wall', entity: `${element.id}↔${wallId}`, source, message: `结构围护 ${element.id} 引用墙 ${wallId}，但该墙未声明 suppressed`, evidence: { element: element.id, wall: wallId } });
      }
    }
  }

  for (const [wallId, owners] of ownersByWall) {
    if (owners.size > 1) {
      issues.push({ level: 'error', code: 'suppression_replacement_duplicate', entity: wallId, source, message: `被 suppress 的墙 ${wallId} 被多个结构围护对象接管：${[...owners].join(', ')}`, evidence: { wall: wallId, owners: [...owners] } });
    }
  }
  return issues;
}

/** 玻璃接缝声明的最小形状：curtain_run/railing_run 根级或其 parts 上的 join。 */
export interface JoinDeclarationElement {
  id: string;
  type: string;
  wall?: string;
  walls?: string[];
  join?: string;
  parts?: Array<{ id?: string; wall?: string; walls?: string[]; join?: string }>;
}

/**
 * 从围护对象声明派生"墙↔替换对象"的 join 语义（原 overlay_replacements 镜像表的唯一存留信息）。
 * join 描述同一对象相邻玻璃路径的交接（continuous 无缝延续 / butt 对接），它本是围护对象的
 * 属性而不是墙的属性——S3 随镜像表删除上移为对象声明（根级或 part 级），此处机械派生，
 * 不再手写第二份关联表。
 */
export function glassJoinSpecs(elements: readonly JoinDeclarationElement[]): OverlayReplacement[] {
  const specs: OverlayReplacement[] = [];
  for (const element of elements) {
    if (!STRUCTURAL_KINDS.has(element.type)) continue;
    const parts = element.parts ?? [];
    const partJoins = parts.filter((part) => part.join !== undefined);
    if (partJoins.length > 0) {
      for (const part of partJoins) {
        for (const wallId of elementWallRefs({ id: element.id, type: element.type, parts: [part] })) {
          specs.push({ wall: wallId, replacement: element.id, kind: element.type, ...(part.id ? { part: part.id } : {}), join: part.join });
        }
      }
      continue;
    }
    if (element.join !== undefined) {
      for (const wallId of elementWallRefs({ id: element.id, type: element.type, wall: element.wall, walls: element.walls })) {
        specs.push({ wall: wallId, replacement: element.id, kind: element.type, join: element.join });
      }
    }
  }
  return specs;
}

/**
 * 把 parseOverlayFiles 的产物（未解析 wall refs 的 OverlayConfig.elements）收窄成
 * join 声明形状。入参用 unknown[]：OverlayConfig 的 curtain_run 是声明态（points 可选），
 * 与解析后的 SceneElement（points 必填）不是同一类型，这里只取 join/wall/parts 四个字段。
 */
export function joinDeclarationsOf(elements: readonly unknown[]): JoinDeclarationElement[] {
  return elements as JoinDeclarationElement[];
}
