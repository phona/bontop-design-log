import assert from 'node:assert/strict';
import test from 'node:test';
import { DxfWriter } from '../../shared/dxf/dxf-writer.js';

/** 最小 DXF 对解析器：文本 → 组码对数组 → 实体序列（只取 ENTITIES 段）。 */
const DXF_ENTITY_TYPES = new Set(['LINE', 'CIRCLE', 'ARC', 'TEXT']);
function parseEntities(dxf: string): Array<Record<string, string>> {
  const lines = dxf.split('\n').map((line) => line.trim());
  const pairs: Array<[number, string]> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    pairs.push([Number(lines[i]), lines[i + 1]]);
  }
  const entities: Array<Record<string, string>> = [];
  let inEntities = false;
  let current: Record<string, string> | undefined;
  for (const [code, value] of pairs) {
    if (code === 0) {
      if (value === 'ENDSEC') { inEntities = false; continue; }
      if (inEntities && DXF_ENTITY_TYPES.has(value)) {
        if (current) entities.push(current);
        current = { type: value };
      }
      continue;
    }
    if (code === 2 && value === 'ENTITIES') { inEntities = true; continue; }
    if (!inEntities || !current) continue;
    current[String(code)] = value;
  }
  if (current) entities.push(current);
  return entities;
}

function sectionNames(dxf: string): string[] {
  const lines = dxf.split('\n').map((line) => line.trim());
  const names: string[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    if (lines[i] === '0' && lines[i + 1] === 'SECTION' && i + 3 < lines.length && lines[i + 2] === '2') {
      names.push(lines[i + 3]);
    }
  }
  return names;
}

test('DxfWriter: 空图输出合法骨架（HEADER/TABLES/ENTITIES + EOF）', () => {
  const dxf = new DxfWriter().toString();
  assert.deepEqual(sectionNames(dxf), ['HEADER', 'TABLES', 'ENTITIES']);
  assert.match(dxf, /\$ACADVER\n1\nAC1009/);
  assert.match(dxf, /0\nEOF\n?$/);
});

test('DxfWriter: LINE/CIRCLE/TEXT 组码正确且引用图层', () => {
  const writer = new DxfWriter();
  writer.addLayer('A-WALL', 7);
  writer.addLine('A-WALL', 0, 0, 1000, 2000);
  writer.addCircle('A-WALL', 500, -500, 100);
  writer.addText('A-WALL', 0, 0, 100, '主卧');
  const entities = parseEntities(writer.toString());
  assert.equal(entities.length, 3);
  const line = entities[0];
  assert.equal(line['8'], 'A-WALL');
  assert.equal(line['10'], '0.0000');
  assert.equal(line['20'], '0.0000');
  assert.equal(line['11'], '1000.0000');
  assert.equal(line['21'], '2000.0000');
  const circle = entities[1];
  assert.equal(circle['40'], '100.0000');
  const text = entities[2];
  assert.equal(text['1'], '主卧');
  assert.equal(text['40'], '100.0000');
});

test('DxfWriter: 闭合折线补首尾闭合段；开放折线不补', () => {
  const closed = new DxfWriter();
  closed.addPolyline('X', [[0, 0], [100, 0], [100, 100]], true);
  const open = new DxfWriter();
  open.addPolyline('X', [[0, 0], [100, 0], [100, 100]], false);
  const closedEntities = parseEntities(closed.toString());
  const openEntities = parseEntities(open.toString());
  assert.equal(closedEntities.length, 3);
  assert.equal(openEntities.length, 2);
});

test('DxfWriter: 非 ASCII 图层名拒绝（R12 编码安全）', () => {
  const writer = new DxfWriter();
  assert.throws(() => writer.addLayer('墙体'), /ASCII/);
  assert.throws(() => writer.addLine('图层', 0, 0, 1, 1), /ASCII/);
});

test('DxfWriter: 实体引用未注册图层时自动补图层表；layerStats 计数正确', () => {
  const writer = new DxfWriter();
  writer.addLine('AUTO', 0, 0, 1, 1);
  writer.addLine('AUTO', 1, 1, 2, 2);
  writer.addCircle('AUTO', 5, 5, 1);
  const dxf = writer.toString();
  assert.match(dxf, /2\nAUTO\n/); // LAYER 表里有 AUTO
  assert.deepEqual(writer.layerStats(), { AUTO: 3 });
});

test('DxfWriter: EXTMIN/EXTMAX 随实体包围盒扩展（含 100mm 余量）', () => {
  const writer = new DxfWriter();
  writer.addLine('X', 1000, -2000, 3000, -4000);
  const dxf = writer.toString();
  assert.match(dxf, /9\n\$EXTMIN\n10\n900\.0000\n20\n-4100\.0000/);
  assert.match(dxf, /9\n\$EXTMAX\n10\n3100\.0000\n20\n-1900\.0000/);
});
