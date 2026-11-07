import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { loadOverlayDoc } from '../../../server/overlay-merge.js';
import { isWallSuppressed } from '../../../shared/suppression.js';

const ROOT = path.resolve(import.meta.dirname, '../../..');

interface OverlayElement {
  id: string;
  type: string;
  points?: Array<{ x: number; z: number }>;
  wall?: string;
  walls?: string[];
}

interface WallDef {
  id: string;
  from: string;
  to: string;
  /** suppress 改判（issue #98 S3）后的墙属性：实体盒不进碰撞。 */
  suppressed?: { reason: string; replacement: string };
}

function main() {
  const geomPath = path.join(ROOT, 'config/layout/model-geometry.yaml');

  // S1 搬迁（issue #98）：原 config/layout/overlay.yaml 拆为 envelope 三文件，合并读
  const overlay = loadOverlayDoc() as {
    elements?: OverlayElement[];
  };
  const geom = yaml.load(fs.readFileSync(geomPath, 'utf8')) as {
    walls?: WallDef[];
  };

  const errors: string[] = [];

  // suppress 改判（2026-11-07 issue #98 第三阶段 S3）：被 suppress 的墙（玻璃幕墙/实体已删除）
  // 不产生实体盒、不进碰撞，判定读墙条目自身的 suppressed 属性，权威实现 shared/suppression.ts。
  const solidWalls = (geom.walls ?? []).filter(w => !isWallSuppressed(w));
  console.log(`  solid walls (collision expected): ${solidWalls.length}`);

  const curtainRuns = (overlay.elements ?? []).filter(el => el.type === 'curtain_run');
  console.log(`  curtain_run elements (collision expected): ${curtainRuns.length}`);

  for (const cr of curtainRuns) {
    const hasPoints = cr.points && cr.points.length >= 2;
    const hasWallRef = cr.wall || cr.walls;
    if (!hasPoints && !hasWallRef) {
      errors.push(`curtain_run "${cr.id}" has neither points nor wall ref — cannot generate collision`);
    }
  }

  const railings = (overlay.elements ?? []).filter(el => el.type === 'railing_run');
  console.log(`  railing_run elements (no collision, by design): ${railings.length}`);

  const collidableTypes = new Set(['wall', 'curtain_run', 'wall_run']);
  // 涂装叠加层三类（paint_region / paint_ceiling_region / paint_sill_region）都是「要刷漆的声明面」，
  // 不是场景实体：不产碰撞体、不进 first-person 碰撞。漏登记会让本脚本 fail-closed 报
  // unknown element type——2026-10-09 新增后两类时正是这么发现的。
  const nonCollidableTypes = new Set(['floor_region', 'bay_sill', 'railing_run', 'frosted_privacy', 'shower_screen', 'curtain', 'wall_region', 'sill_region', 'paint_region', 'paint_ceiling_region', 'paint_sill_region', 'skirting_region']); // 踢脚线墙脚薄片饰面，与 floor_region 同款不需要碰撞（DEC-2026-10-28-R02）
  const conditionalCollidableTypes = new Set(['sliding_door_run']);

  for (const el of overlay.elements ?? []) {
    if (!collidableTypes.has(el.type) && !nonCollidableTypes.has(el.type) && !conditionalCollidableTypes.has(el.type)) {
      errors.push(`unknown element type "${el.type}" (id: ${el.id}) — update collision-utils.ts and this script`);
    }
  }

  const slidingDoors = (overlay.elements ?? []).filter(el => el.type === 'sliding_door_run') as Array<OverlayElement & { open?: boolean }>;
  console.log(`  sliding_door_run elements (collision only when closed): ${slidingDoors.length}`);
  for (const sd of slidingDoors) {
    if (sd.open === false && !(sd.points && sd.points.length >= 2)) {
      errors.push(`sliding_door_run "${sd.id}" is closed but has no points — cannot generate collision`);
    }
  }

  // hinged_glass_door / glass_infill 检查已删（issue #98 第三阶段 S1：overlay 0 元素，类型退场）。

  if (errors.length > 0) {
    console.error('\nFAIL:');
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }

  console.log('\nverify-collision-coverage: OK');
}

main();
