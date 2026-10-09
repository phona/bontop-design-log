import { writeFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  makeSpatialReport,
  type SpatialIssue,
} from '../../../shared/spatial-validation.js';
import { runPenetrationChecks } from '../../../shared/penetration/registry.js';
import {
  buildRuntimeScene,
  collectPenetrationObjects,
  loadSceneInputs,
  type SceneInputs,
} from '../../../shared/penetration/scene.js';

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

function resolveToday(): string {
  const index = process.argv.indexOf('--today');
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      console.error('verify:penetration --today requires YYYY-MM-DD');
      process.exitCode = 2;
      return '1970-01-01';
    }
    return value;
  }
  return new Date().toISOString().slice(0, 10);
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  const todayStamp = resolveToday();
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
  let penetration: ReturnType<typeof runPenetrationChecks> | undefined;
  if (inputs) {
    try {
      const scene = buildRuntimeScene(inputs);
      collected = collectPenetrationObjects(scene, inputs.structuralPaths);
      // 全部穿透规则走注册表：配置声明 severity 下限、豁免与机电参与策略，
      // 与 verify:spatial 共用同一入口，不会各自漂移。
      penetration = runPenetrationChecks(inputs, scene, todayStamp);
      issues.push(...penetration.issues);
      issues.push(...penetration.registryIssues);
    } catch (error) {
      issues.push({ level: 'error', code: 'scene_build_failed', entity: 'HOUSE_EXPORT', source: 'shared/render/SceneBuilder.ts', message: error instanceof Error ? error.message : String(error), evidence: {} });
    }
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
