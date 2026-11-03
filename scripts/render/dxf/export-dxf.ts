/**
 * CLI：从当前 config 导出施工 DXF（npm run export:dxf）。
 *
 * 与 web「导出 DXF」按钮共用 shared/dxf/project-dxf.ts 的唯一装配实现；本脚本只负责
 * 从文件装配输入（catalog + overlay + render facts + MEP 协调），产物写 tmp/capture/
 * （过程物不进 git，铁律「过程物不进 git」）。也是 ezdxf 回读验证的输入通道。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ProjectCatalog } from '../../../server/project-catalog.js';
import { mergeSceneElements, parseOverlay } from '../../../server/overlay-merge.js';
import { loadMepCoordinationConfig } from '../../../server/config-loader.js';
import { ProjectRenderFactsLoader } from '../../../server/project-render-facts-loader.js';
import { endpointSourcesFromFacts } from '../../../shared/mep-hvac-coordination-schema.js';
import { buildProjectDxf } from '../../../shared/dxf/project-dxf.js';

function main(): void {
  const catalog = ProjectCatalog.load('.');
  const overlay = parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8'));
  const factsLoader = new ProjectRenderFactsLoader();
  factsLoader.load();
  const facts = factsLoader.getFacts();
  if (!facts) throw new Error('render facts 加载失败（config/electrical|plumbing|ceiling|hvac.yaml）');

  const mepConfig = loadMepCoordinationConfig();
  const mepSources = endpointSourcesFromFacts(facts);

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
