import { writeFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  deriveRuntimeGlassJoins,
  makeSpatialReport,
  requiredClearance,
  type GlassPathSegment,
  type RuntimeGlassJoinSpec,
  type SpatialIssue,
} from '../../../shared/spatial-validation.js';
import { validateRuntimePenetration } from '../../../shared/penetration/rules.js';
import {
  buildRuntimeScene,
  collectPenetrationObjects,
  loadSceneInputs,
  type SceneInputs,
} from '../../../shared/penetration/scene.js';
import { declaredDims, profileFor, validateFurnitureClearance } from '../../../shared/penetration/clearance.js';

/**
 * 防穿模 linter（penetration）入口：两块实体是否占了同一块空间。
 *
 * 与 `verify:spatial` 的分工：本 CLI 只判穿透/净距族规则；声明完整性、墙线拓扑、
 * 运行时权威性、灯具宿主由 verify:spatial 负责。两者共用 `shared/penetration/scene.ts`
 * 的同一份场景采集与 `shared/penetration/rules.ts` 的同一份判定，因此并联期结论一致。
 *
 * CLI 契约与 verify:spatial 逐字一致：`--json` 不含时间戳、issue 按
 * `code/entity/message` 稳定排序；`--out <path>` 缺路径 exit 2；每条 issue 固定
 * `level/code/entity/source/message/evidence`；errors > 0 → exit 1。
 */

const ROOT = path.resolve(import.meta.dirname, '../../..');
const SOURCE = 'config/house.yaml + shared/render/SceneBuilder.ts + shared/penetration/rules.ts';

function placedFurnitureClearanceIssues(inputs: SceneInputs, collected: ReturnType<typeof collectPenetrationObjects>): SpatialIssue[] {
  const issues: SpatialIssue[] = [];
  const config = inputs.config;
  const wallMap = new Map(inputs.layout.walls.map((wall) => [wall.id, wall]));
  const furnitureById = new Map(collected.furnitureEntries.map((entry) => [entry.entity, entry]));
  for (const [roomId, items] of Object.entries(inputs.house.furnishings ?? {})) {
    let runtimeIndex = 0;
    for (const [index, raw] of items.entries()) {
      const item = raw as unknown as Record<string, unknown>;
      const isPlaced = item.x !== undefined || item.z !== undefined || item.wall !== undefined || item.along !== undefined;
      if (!isPlaced) continue;
      const type = String(item.type ?? '');
      const runtimeId = `furniture:${roomId}:${type}:${runtimeIndex}`;
      runtimeIndex++;
      // 缺尺寸/无 runtime 实例的条目不进净距判定，与 verify:spatial 的循环契约一致
      // （尺寸缺失由 verify:spatial 的 furniture_dimensions_missing 单一负责）。
      const dims = declaredDims(item, type);
      if (!dims || dims.width <= 0 || dims.depth <= 0) continue;
      const entry = furnitureById.get(runtimeId);
      if (!entry) continue;
      // 未登记类型由 verify:spatial 的 furniture_profile_unregistered fail-closed
      // 单一负责；这里静默跳过该类型的净距，避免两个 CLI 对同一份 override 各判一半。
      const override = profileFor(type, config);
      if (!override) continue;
      const profile = config.tolerance_profiles?.[override.profile] ?? config.tolerance_profiles?.default ?? {};
      issues.push(...validateFurnitureClearance({ entry, type, override, profile, wallEntries: collected.wallEntries, wallMap, source: SOURCE }));
    }
  }
  return issues;
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  const issues: SpatialIssue[] = [];

  let inputs: SceneInputs;
  try {
    inputs = loadSceneInputs();
  } catch (error) {
    // 权威配置读不动时必须红：不能因为拿不到几何就假装没有穿模。
    issues.push({ level: 'error', code: 'scene_inputs_unreadable', entity: 'CONFIG', source: 'config/layout/model-geometry.yaml', message: error instanceof Error ? error.message : String(error), evidence: {} });
    inputs = undefined as unknown as SceneInputs;
  }

  let collected: ReturnType<typeof collectPenetrationObjects> | undefined;
  if (inputs) {
    try {
      const scene = buildRuntimeScene(inputs);
      collected = collectPenetrationObjects(scene, inputs.structuralPaths);
    } catch (error) {
      issues.push({ level: 'error', code: 'scene_build_failed', entity: 'HOUSE_EXPORT', source: 'shared/render/SceneBuilder.ts', message: error instanceof Error ? error.message : String(error), evidence: {} });
    }
  }

  if (inputs && collected) {
    const config = inputs.config;
    const glassJoins: RuntimeGlassJoinSpec[] = deriveRuntimeGlassJoins(inputs.structuralPaths, config.overlay_replacements ?? []);
    issues.push(...validateRuntimePenetration({
      furniture: collected.furniture,
      walls: collected.walls,
      glass: collected.glass,
      ceilings: collected.ceilings,
      relationships: config.relationships,
      glassJoins,
      mepTypes: config.mep_coordination_types,
      collisionMargin: config.tolerance_profiles?.default?.collision_margin ?? 0.005,
      glassRequiredClearance: requiredClearance(config.tolerance_profiles?.curtain_wall ?? {}),
      source: SOURCE,
    }));
    issues.push(...placedFurnitureClearanceIssues(inputs, collected));
  }

  const report = makeSpatialReport(issues.sort((a, b) => a.code.localeCompare(b.code) || a.entity.localeCompare(b.entity) || a.message.localeCompare(b.message)));
  const output = JSON.stringify({
    version: 1,
    report,
    inputs: inputs
      ? {
        rooms: inputs.layout.rooms.length,
        walls: inputs.layout.walls.length,
        suppressedWalls: [...new Set(inputs.suppressIds)].length,
        placedFurniture: Object.values(inputs.house.furnishings ?? {}).flat().filter((item) => item.x !== undefined || item.z !== undefined || item.wall !== undefined || item.along !== undefined).length,
        runtimeObjects: collected
          ? { furniture: collected.furniture.length, walls: collected.walls.length, glass: collected.glass.length, ceilings: collected.ceilings.length }
          : null,
      }
      : null,
    ...(inputs && inputs.layoutWarnings.length > 0 ? { runtimeWarnings: inputs.layoutWarnings } : {}),
  }, null, 2);

  if (args.has('--json')) console.log(output);
  else {
    console.log(`Penetration lint: ${report.counts.errors} error(s), ${report.counts.warnings} warning(s), ${report.counts.info} info`);
    for (const issue of report.issues) console.log(`${issue.level === 'error' ? '✗' : issue.level === 'warning' ? '⚠' : '·'} [${issue.code}] ${issue.entity}: ${issue.message}`);
  }
  if (args.has('--out')) {
    const outIndex = process.argv.indexOf('--out');
    const target = process.argv[outIndex + 1];
    if (!target || target.startsWith('--')) {
      console.error('verify:penetration --out requires a file path');
      process.exitCode = 2;
    } else {
      writeFileSync(path.resolve(ROOT, target), `${output}\n`);
    }
  }
  if (report.errors.length > 0) process.exitCode = 1;
}

main();
