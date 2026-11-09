/**
 * CLI：从当前 config 导出施工 DXF（npm run export:dxf）。
 *
 * 与 web「导出 DXF」按钮共用 shared/dxf/project-dxf.ts 的唯一装配实现；本脚本只负责
 * 从文件装配输入（catalog + overlay + render facts + MEP 协调），产物写 tmp/capture/
 * （过程物不进 git，铁律「过程物不进 git」）。也是 ezdxf 回读验证的输入通道。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { ProjectCatalog } from '../../../server/project-catalog.js';
import { mergeSceneElements, parseOverlayFiles } from '../../../server/overlay-merge.js';
import { loadMepCoordinationConfig } from '../../../server/config-loader.js';
import { ProjectRenderFactsLoader } from '../../../server/project-render-facts-loader.js';
import { endpointSourcesFromFacts } from '../../../shared/mep-hvac-coordination-schema.js';
import { pointMountHostIndex, pointWallIndexFromElements } from '../../../shared/point-placement.js';
import { buildProjectDxf } from '../../../shared/dxf/project-dxf.js';
import type { PointCircuitTopologyLike } from '../../../shared/point-circuits.js';

function main(): void {
  const catalog = ProjectCatalog.load('.');
  const overlay = parseOverlayFiles();
  const factsLoader = new ProjectRenderFactsLoader();
  factsLoader.load();
  const facts = factsLoader.getFacts();
  if (!facts) throw new Error('render facts 加载失败（config/electrical|plumbing|ceiling|hvac.yaml）');

  const mepConfig = loadMepCoordinationConfig();
  // 点位宿主墙索引：MEP 路线端点与 E-*/P-POINTS 出图共用 shared/point-placement.ts 单一解算。
  const mepSources = endpointSourcesFromFacts(facts, pointWallIndexFromElements(catalog.getWalls()), pointMountHostIndex(Object.values(catalog.getFurnishings()).flat()));
  // 点位 → 回路 单一派生（issue #98 S3）：图上「点位属于哪条回路」的标注源。点位侧 circuit
  // 字段已退役，只认 topology 的 member_point_ids + controls。
  const pointCircuitSources = parseYaml(readFileSync('config/electrical-topology.yaml', 'utf-8')) as PointCircuitTopologyLike;

  const result = buildProjectDxf({
    house: {
      rooms: catalog.getRooms(),
      furnishings: catalog.getFurnishingsForPhase('full'),
      electrical: facts.electrical,
      ceilingZones: facts.ceiling,
      sceneElements: mergeSceneElements(catalog.getWalls(), overlay),
    },
    plumbing: facts.plumbing,
    mep: { coordination: mepConfig, sources: mepSources },
    pointCircuitSources,
    notes: ['PHASE: full (all furnishings)'],
  });

  // 定位诊断 = 施工摆位/点位/路线不可得（issue #98：家具断引用/越界/负净宽，电气/给排水
  // 点位解算失败，MEP 路线端点悬空——同一 errors 通道）：不出图纸，非零退出。
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(`ERROR ${error}`);
    throw new Error(`DXF 导出失败：${result.errors.length} 条定位诊断（家具摆位/点位定位/MEP 路线端点），修复配置后重导`);
  }

  mkdirSync('tmp/capture', { recursive: true });
  const outPath = 'tmp/capture/house-dxf-export.dxf';
  writeFileSync(outPath, result.dxf, 'utf8');

  console.log(`DXF -> ${outPath}`);
  console.log(`entities: ${result.entityCount}`);
  for (const [layer, count] of Object.entries(result.stats).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${layer.padEnd(14)} ${count}`);
  }
  if (result.warnings.length > 0) {
    console.log(`warnings (${result.warnings.length}):`);
    for (const warning of result.warnings) console.log(`  - ${warning}`);
  }
}

main();
