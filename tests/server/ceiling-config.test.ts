import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { VALID_CEILING_TYPES } from '../../server/config-loader.js';

interface CeilingEntry {
  id: string;
  room: string;
  type: string;
  thickness?: number;
  area?: [number, number, number, number];
}

const entries = parseYaml(readFileSync('config/ceiling.yaml', 'utf8')) as CeilingEntry[];

test('ceiling.yaml: every entry type is in VALID_CEILING_TYPES', () => {
  for (const e of entries) {
    assert.ok(
      (VALID_CEILING_TYPES as readonly string[]).includes(e.type),
      `ceiling/${e.id}: unknown type "${e.type}"`,
    );
  }
});

test('ceiling.yaml: corridor/foyer gap entries exist with matching floor_region areas', () => {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const expected: Record<string, [number, number, number, number]> = {
    ceiling_main_corridor: [4.20, 4.30, 7.20, 5.55],
    // 2026-08-26：父母房走廊吊顶收窄为衣柜深度边吊（z 5.55–6.45），z[6.45,7.8] 走廊地面由 study 房间基础顶面覆盖
    ceiling_corridor: [4.20, 5.55, 7.20, 6.45],
    ceiling_entry_foyer: [10.80, 2.90, 13.40, 4.30],
  };
  for (const [id, area] of Object.entries(expected)) {
    const e = byId.get(id);
    assert.ok(e, `missing ceiling entry ${id}`);
    assert.equal(e.type, 'drop');
    assert.equal(e.thickness, 0.30);
    assert.deepEqual(e.area, area);
  }
});
