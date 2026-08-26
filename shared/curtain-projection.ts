/**
 * 窗帘渲染投影：overlay.yaml 的 curtain 元素 × presentation-state.json 的有效状态，
 * 统一驱动 web/blender 两条渲染链的窗帘节点导出。
 * shared 层禁止反向依赖 server，overlay 以最小结构 CurtainOverlayLike 传入。
 */
import { sha256Hex } from './sha256.js';
import type {
  CurtainPresentationState,
  CurtainRenderItem,
  CurtainRenderProjection,
  CurtainState,
} from './types.js';

export type { CurtainRenderItem, CurtainRenderProjection } from './types.js';

export type CurtainKind = 'sheer_blackout' | 'blinds';

/** 最小 overlay 输入结构；server 的 OverlayConfig 结构兼容本接口 */
export interface CurtainOverlayLike {
  elements: Array<{ id: string; type: string; room?: string; kind?: CurtainKind }>;
}

/** blinds 不支持遮光语义：blackout 归一化为 privacy */
export function normalizeCurtainState(state: CurtainState, kind: CurtainKind): CurtainState {
  return kind === 'blinds' && state === 'blackout' ? 'privacy' : state;
}

/** 与 app 侧 GLB 导出的共同契约：按 kind+state 推导应导出的可见节点 */
export function expectedVisibleCurtainNodes(id: string, kind: CurtainKind, state: CurtainState): string[] {
  if (state === 'open') return [];
  if (kind === 'blinds') return [`${id}:blinds:deployed`];
  if (state === 'privacy') {
    return [`${id}:sheer:deployed`, `${id}:blackout:gathered:left`, `${id}:blackout:gathered:right`];
  }
  return [`${id}:sheer:deployed`, `${id}:blackout:deployed`];
}

/** canonical JSON：所有 object key 递归排序，保证哈希对 key 顺序稳定 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function curtainProjectionSnapshotSha256(projection: Omit<CurtainRenderProjection, 'snapshotSha256'>): string {
  return sha256Hex(canonicalJson({
    source: { default: projection.source.default, roomOverrides: projection.source.roomOverrides },
    effectiveByRoom: projection.effectiveByRoom,
    curtains: projection.curtains,
  }));
}

function sortedRecord<T>(source: Record<string, T>): Record<string, T> {
  const result: Record<string, T> = {};
  for (const key of Object.keys(source).sort()) result[key] = source[key];
  return result;
}

export function buildCurtainRenderProjection(
  overlay: CurtainOverlayLike,
  presentation: CurtainPresentationState,
): CurtainRenderProjection {
  // 与 PresentationStateStore.curtainRooms() 一致：无 room 的 curtain 元素不参与状态投影
  const curtainElements = overlay.elements.filter((element) => element.type === 'curtain' && element.room);

  const ids = new Set<string>();
  const kindByRoom = new Map<string, CurtainKind>();
  for (const element of curtainElements) {
    if (ids.has(element.id)) throw new Error(`duplicate curtain id "${element.id}"`);
    ids.add(element.id);
    const kind = element.kind ?? 'sheer_blackout';
    const previous = kindByRoom.get(element.room!);
    if (previous && previous !== kind) throw new Error(`room "${element.room}" mixes curtain kinds`);
    kindByRoom.set(element.room!, kind);
  }

  // 归一化 overrides：拒绝无窗帘房间的 override，删除与 default 归一化后相同的冗余项
  const roomOverrides: Record<string, CurtainState> = {};
  for (const roomId of Object.keys(presentation.roomOverrides)) {
    const kind = kindByRoom.get(roomId);
    if (!kind) throw new Error(`curtain override references room "${roomId}" without curtains`);
    const normalized = normalizeCurtainState(presentation.roomOverrides[roomId], kind);
    if (normalized === normalizeCurtainState(presentation.default, kind)) continue;
    roomOverrides[roomId] = normalized;
  }

  const effectiveByRoom: Record<string, CurtainState> = {};
  for (const roomId of [...kindByRoom.keys()].sort()) {
    const kind = kindByRoom.get(roomId)!;
    effectiveByRoom[roomId] = roomOverrides[roomId] ?? normalizeCurtainState(presentation.default, kind);
  }

  const curtains: CurtainRenderItem[] = curtainElements
    .map((element) => {
      const kind = element.kind ?? 'sheer_blackout';
      const state = effectiveByRoom[element.room!];
      return {
        id: element.id,
        roomId: element.room!,
        kind,
        state,
        expectedVisibleNodes: expectedVisibleCurtainNodes(element.id, kind, state),
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const normalized = {
    source: {
      default: presentation.default,
      roomOverrides: sortedRecord(roomOverrides),
      updatedAt: presentation.updatedAt,
    },
    effectiveByRoom,
    curtains,
  };
  // updatedAt 保留在 source 供审计，但不进入语义哈希；纯 TS 实现可同时进入 browser bundle。
  return { ...normalized, snapshotSha256: curtainProjectionSnapshotSha256(normalized) };
}
