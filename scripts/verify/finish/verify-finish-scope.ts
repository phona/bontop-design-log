import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { resolveLayout } from '../../../server/layout-resolver.js';
import { loadCeilingConfig } from '../../../server/config-loader.js';
import {
  runFinishScopeChecks,
  loadFinishLintConfig,
  CONFIG_PATH,
  SOURCE,
  type FinishIssue,
} from '../../../shared/finish/registry.js';
import type { FinishScopeInput } from '../../../shared/finish/rules.js';

/**
 * 面层范围核查（finish-scope）入口：面层声明之间是否互相压、重复、挂错房间。
 *
 * 为什么需要它：漆/砖/防水台/吊顶都是面层声明，各自圈一片墙或一片顶。声明互相压时
 * **面积数字不报错、3D 里也看不出来**——漆是 inspection-only 半透明叠加层，要开
 * 开关转视角，而且「压了 0.3㎡」肉眼判不了。浏览器核对面层归属不可行，必须有一层
 * 专职 linter。
 *
 * CLI 契约与 verify:penetration 一致：`--json` 不含时间戳、issue 按
 * `code/entity/message` 稳定排序；errors > 0 → exit 1。
 */

const ROOT = path.resolve(import.meta.dirname, '../../..');

function readYaml(file: string): any {
  return parseYaml(readFileSync(path.join(ROOT, file), 'utf8'));
}

function buildInput(): FinishScopeInput {
  const MG = readYaml('config/layout/model-geometry.yaml');
  const OV = readYaml('config/layout/overlay.yaml');
  const layout = resolveLayout(MG);
  const elements: any[] = OV.elements ?? [];
  const vertexById = new Map((MG.vertices ?? []).map((v: any) => [v.id, v]));

  const walls: FinishScopeInput['walls'] = [];
  for (const element of elements) {
    if (element.type === 'paint_region') {
      walls.push({
        id: element.id, wall: element.wall, room: element.room,
        along: [Math.min(...element.along), Math.max(...element.along)],
        bottom: element.bottom ?? 0, top: element.height ?? 2.8,
        finish: 'paint', type: element.type,
      });
    } else if (element.type === 'wall_region' && /^walltile/.test(String(element.id))) {
      walls.push({
        id: element.id, wall: element.wall, room: element.room,
        along: [Math.min(...element.along), Math.max(...element.along)],
        bottom: element.bottom ?? 0, top: element.height ?? 2.65,
        finish: 'tile', type: element.type,
      });
    }
  }

  const sills: FinishScopeInput['sills'] = [];
  for (const element of elements) {
    if (element.type === 'paint_sill_region') {
      sills.push({ id: element.id, element: element.element, room: element.room, faces: element.faces ?? [], finish: 'paint', type: element.type });
    } else if (element.type === 'sill_region') {
      sills.push({ id: element.id, element: element.element, room: element.room, faces: element.face ? [element.face] : [], finish: 'tile', type: element.type });
    }
  }

  const rooms: FinishScopeInput['rooms'] = [];
  for (const raw of MG.rooms ?? []) {
    const points = (raw.boundary ?? []).map((id: string) => vertexById.get(id)).filter(Boolean) as Array<{ x: number; z: number }>;
    if (points.length >= 3) rooms.push({ id: raw.id, points });
  }

  const wallGeometry: FinishScopeInput['wallGeometry'] = {};
  for (const wall of layout.walls as any[]) {
    const polyline = wall.segments?.length
      ? wall.segments.map((segment: any) => ({ x1: segment.x1, z1: segment.z1, x2: segment.x2, z2: segment.z2 }))
      : [{ x1: wall.x1, z1: wall.z1, x2: wall.x2, z2: wall.z2 }];
    wallGeometry[wall.id] = {
      id: wall.id, polyline,
      length: polyline.reduce((sum: number, s: any) => sum + Math.hypot(s.x2 - s.x1, s.z2 - s.z1), 0),
      suppressed: Boolean(wall.suppressed),
    };
  }

  // 吊顶：zone 清单 + 房间外接矩形 + 两组房间集合（供 F05/F06 判定「在不在涂装范围」）
  const ceilings: FinishScopeInput['ceilings'] = [];
  for (const zone of loadCeilingConfig() as any[]) {
    if (!zone.room) continue;
    ceilings.push({ id: zone.id, room: zone.room, type: zone.type, ...(zone.area ? { area: zone.area as [number, number, number, number] } : {}) });
  }
  const roomRects: FinishScopeInput['roomRects'] = (layout.rooms as any[]).map((room) => ({ id: room.id, x: room.x, z: room.z, width: room.width ?? 0, depth: room.depth ?? 0 }));
  const ceilingPaintRooms = new Set(elements.filter((e) => e.type === 'paint_ceiling_region').map((e) => e.room));
  const wallPaintRooms = new Set(elements.filter((e) => e.type === 'paint_region').map((e) => e.room));

  const config = loadFinishLintConfig();
  return { walls, sills, rooms, wallGeometry, ceilings, roomRects, ceilingPaintRooms, wallPaintRooms, tolerance: config.tolerance ?? 0.01, source: SOURCE };
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  const today = new Date().toISOString().slice(0, 10);
  const issues: FinishIssue[] = [];

  let input: FinishScopeInput;
  try {
    input = buildInput();
  } catch (error) {
    console.error(`finish-scope: 权威配置读不动时必须红——${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  const result = runFinishScopeChecks(input, today, loadFinishLintConfig());
  issues.push(...result.registryIssues, ...result.issues);

  const sorted = [...issues].sort((a, b) => a.code.localeCompare(b.code) || a.entity.localeCompare(b.entity) || a.message.localeCompare(b.message));
  const errors = sorted.filter((issue) => issue.level === 'error');
  const warnings = sorted.filter((issue) => issue.level === 'warning');
  const infos = sorted.filter((issue) => issue.level === 'info');

  const output = JSON.stringify({
    version: 1,
    config: CONFIG_PATH,
    counts: { errors: errors.length, warnings: warnings.length, info: infos.length },
    inputs: {
      wallFinishDeclarations: input.walls.length,
      sillFinishDeclarations: input.sills.length,
      ceilingZones: (input.ceilings ?? []).length,
      ceilingPaintRooms: [...(input.ceilingPaintRooms ?? [])].length,
      rooms: input.rooms.length,
      walls: Object.keys(input.wallGeometry).length,
    },
    issues: sorted,
  }, null, 2);

  if (args.has('--json')) console.log(output);
  else {
    console.log(`Finish-scope lint: ${errors.length} error(s), ${warnings.length} warning(s), ${infos.length} info`);
    for (const issue of sorted) {
      const mark = issue.level === 'error' ? 'x' : issue.level === 'warning' ? '!' : '.';
      console.log(`  ${mark} [${issue.code}] ${issue.entity}: ${issue.message}`);
    }
  }
  if (errors.length > 0) process.exitCode = 1;
}

main();
