/**
 * CLI：从当前 config 导出施工 DXF（npm run export:dxf）。
 *
 * 与 web「导出 DXF」按钮共用 shared/dxf/project-dxf.ts 的唯一装配实现；本脚本只负责
 * 从文件装配输入（catalog + overlay + render facts + MEP 协调），产物写 tmp/capture/
 * （过程物不进 git，铁律「过程物不进 git」）。也是 ezdxf 回读验证的输入通道。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { ProjectCatalog } from '../../../server/project-catalog.js';
import { mergeSceneElements, parseOverlayFiles } from '../../../server/overlay-merge.js';
import { loadMepCoordinationConfig } from '../../../server/config-loader.js';
import { ProjectRenderFactsLoader } from '../../../server/project-render-facts-loader.js';
import { endpointSourcesFromFacts } from '../../../shared/mep-hvac-coordination-schema.js';
import { pointWallIndexFromElements } from '../../../shared/point-placement.js';
import { buildProjectDxf } from '../../../shared/dxf/project-dxf.js';

function main(): void {
  const catalog = ProjectCatalog.load('.');
  const overlay = parseOverlayFiles();
  const factsLoader = new ProjectRenderFactsLoader();
  factsLoader.load();
  const facts = factsLoader.getFacts();
  if (!facts) throw new Error('render facts 加载失败（config/electrical|plumbing|ceiling|hvac.yaml）');

  const mepConfig = loadMepCoordinationConfig();
  // 点位宿主墙索引：MEP 路线端点与 E-*/P-POINTS 出图共用 shared/point-placement.ts 单一解算。
  const mepSources = endpointSourcesFromFacts(facts, pointWallIndexFromElements(catalog.getWalls()));

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
    notes: ['PHASE: full (all furnishings)'],
  });

  // 家具摆位诊断 = 施工摆位不可得（issue #98 PR-3：断引用/越界/负净宽）：不出图纸，非零退出。
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(`ERROR ${error}`);
    throw new Error(`DXF 导出失败：${result.errors.length} 条家具摆位诊断，修复配置后重导`);
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
