import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { parseCeilingZones, parseElectricalPoints, parsePlumbingPoints } from './project-render-facts-schema.js';
import type { ElementInput, ElementKind } from './element-state.js';

/**
 * 构件采集：从权威配置里读出「有哪些构件、各自的声明状态」。
 *
 * 与 `element-state.ts`（纯派生）分开：这里做 I/O，那里不做。CLI 与测试共用同一份
 * 采集，避免「CLI 采一套、测试另写一套」导致计数对不上。
 *
 * 几何与状态一律来自配置，本模块不推断、不补默认值。
 */

const ROOT = path.resolve(import.meta.dirname, '..');

function read(file: string): string {
  return readFileSync(path.join(ROOT, file), 'utf8');
}

function extractDecision(note: string | undefined): string | undefined {
  if (!note) return undefined;
  const match = note.match(/DEC-\d{4}-\d{2}-\d{2}-[A-Za-z0-9.]+/);
  return match ? match[0] : undefined;
}

/** 承载场景构件的配置 → objectId 前缀。 */
export const ELEMENT_SOURCES = {
  electrical: 'config/electrical.yaml',
  plumbing: 'config/plumbing.yaml',
  ceiling: 'config/ceiling.yaml',
} as const;

export function collectElements(): ElementInput[] {
  const elements: ElementInput[] = [];

  for (const point of parseElectricalPoints(read(ELEMENT_SOURCES.electrical))) {
    const note = (point as { note?: string }).note;
    const decision = extractDecision(note);
    elements.push({
      id: `electrical:${point.id}`,
      kind: 'electrical',
      label: `${point.type} ${point.id}`,
      ...(point.room ? { room: point.room } : {}),
      // position_status 优先于 status：前者描述「这个位置准不准」，后者描述「这项定没定」
      ...(point.position_status ? { configStatus: point.position_status } : point.status ? { configStatus: point.status } : {}),
      ...(decision ? { decision } : {}),
    });
  }

  for (const point of parsePlumbingPoints(read(ELEMENT_SOURCES.plumbing))) {
    const note = (point as { note?: string }).note;
    const decision = extractDecision(note);
    const positionStatus = (point as { position_status?: string }).position_status;
    elements.push({
      id: `plumbing:${point.id}`,
      kind: 'plumbing',
      label: `${point.type} ${point.id}`,
      ...(point.room ? { room: point.room } : {}),
      ...(positionStatus ? { configStatus: positionStatus } : {}),
      ...(decision ? { decision } : {}),
    });
  }

  for (const zone of parseCeilingZones(read(ELEMENT_SOURCES.ceiling))) {
    const decision = extractDecision(zone.note);
    elements.push({
      id: `ceiling:${zone.id}`,
      kind: (zone.type === 'ac_indoor' ? 'hvac' : 'ceiling') as ElementKind,
      label: `${zone.type} ${zone.id}`,
      ...(zone.room ? { room: zone.room } : {}),
      ...(decision ? { decision } : {}),
    });
  }

  return elements;
}

/** 这些配置里出现过的 type 取值——用于把台账里的 `ac_indoor` 这类类型引用与元素 id 区分开。 */
export function collectKnownTypes(): Set<string> {
  const types = new Set<string>();
  for (const point of parseElectricalPoints(read(ELEMENT_SOURCES.electrical))) types.add(String(point.type));
  for (const point of parsePlumbingPoints(read(ELEMENT_SOURCES.plumbing))) types.add(String(point.type));
  for (const zone of parseCeilingZones(read(ELEMENT_SOURCES.ceiling))) types.add(String(zone.type));
  return types;
}
