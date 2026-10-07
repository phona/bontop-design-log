/**
 * 吊顶算量子系统 · CLI（可归档、可追溯）。
 *
 * 用法：
 *   npm run takeoff:ceiling              # 全量分区表 + 工艺小计
 *   npm run takeoff:ceiling -- --json    # 机器可读（与 GET /api/ceiling/takeoff 同口径）
 *
 * 为什么要有 CLI：PKG-070 的「待报价/待算量」条目需要一份能贴进 decision_log / control.yaml
 * 的确定性数字；API/MCP 面向查询，CLI 面向留档（README：没有事后失忆）。
 */
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { computeCeilingTakeoff, type CeilingTakeoffZone } from '../../shared/ceiling-takeoff.js';
import { parseCeilingZones } from '../../shared/project-render-facts-schema.js';

const asJson = process.argv.includes('--json');
const zones = parseCeilingZones(readFileSync('config/ceiling.yaml', 'utf8'));
const rooms = ProjectCatalog.load('.').getRooms().map((room) => ({ id: room.id, name: room.name, height: room.height }));
const roomNames = new Map(rooms.map((room) => [room.id, room.name]));
const takeoff = computeCeilingTakeoff(zones, rooms);

if (asJson) {
  console.log(JSON.stringify(takeoff, null, 2));
} else {
  const pad = (value: string | number, width: number): string => String(value).padEnd(width);
  const num = (value: number, digits = 3): string => value.toFixed(digits).padStart(9);
  console.log(`吊顶算量（config/ceiling.yaml，共 ${takeoff.zones.length} 个实心分区）\n`);
  console.log(`${pad('分区', 26)}${pad('房间', 10)}${pad('工艺', 16)}${pad('类型', 17)}${pad('厚', 6)}${'净㎡'.padStart(9)}${'展开㎡'.padStart(9)}${'周长m'.padStart(8)}${'长边m'.padStart(8)}${'板块'.padStart(6)}  完成面`);
  for (const zone of takeoff.zones) {
    console.log(
      `${pad(zone.id, 26)}${pad(roomNames.get(zone.room) ?? zone.room, 10)}${pad(zone.trade ?? '(未归类)', 16)}${pad(zone.type, 17)}${pad(zone.thickness.toFixed(2), 6)}` +
      `${num(zone.netAreaM2)}${num(zone.expandedAreaM2)}${num(zone.perimeterM, 2)}${num(zone.longSideM, 2)}${String(zone.panelCount ?? '-').padStart(6)}  ${zone.bottomY.toFixed(2)}m`
    );
  }
  console.log('\n按工艺/计价类别（报价须逐项列，没有合并项报价）');
  for (const [key, rollup] of Object.entries(takeoff.byClass)) {
    if (rollup.zones === 0) continue;
    console.log(
      `  ${pad(key, 15)} ${rollup.zones} 区  净 ${rollup.netAreaM2.toFixed(3)}㎡  展开 ${rollup.expandedAreaM2.toFixed(3)}㎡  ` +
      `延长米 ${rollup.linearM.toFixed(2)}m  板块 ${rollup.panelCount}  主口径 ${rollup.pricingUnit}`
    );
  }
  console.log(
    `\n合计：净 ${takeoff.totalNetAreaM2.toFixed(3)}㎡ · 展开 ${takeoff.totalExpandedAreaM2.toFixed(3)}㎡ · 周长 ${takeoff.totalPerimeterM.toFixed(2)}m`
  );
  console.log(`按房间：${Object.entries(takeoff.byRoom).map(([room, area]) => `${roomNames.get(room) ?? room} ${area.toFixed(2)}㎡`).join(' · ')}`);
  if (takeoff.roomIdsWithoutCeiling.length > 0) {
    console.log(`无吊顶分区（保持 2.80m 原顶）：${takeoff.roomIdsWithoutCeiling.map((id) => roomNames.get(id) ?? id).join('、')}`);
  }
  const explicit: string[] = [
    ...takeoff.excludedIds.map((id) => `不计量 ${id}（非实心/缺 area）`),
    ...takeoff.invalidZoneIds.map((id) => `几何非法 ${id}`),
    ...takeoff.unclassifiedZoneIds.map((id) => `工艺未归类 ${id}`),
    ...takeoff.overlaps.map((pair) => `平面重叠 ${pair}`),
  ];
  if (explicit.length > 0) {
    console.log(`\n显形项（合计重叠 ${takeoff.overlapAreaM2.toFixed(3)}㎡，业主裁定分区边界前不得当作 resolved）：`);
    for (const line of explicit) console.log(`  - ${line}`);
  }
}
