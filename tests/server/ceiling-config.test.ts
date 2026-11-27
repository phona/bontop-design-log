import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { VALID_CEILING_TYPES } from '../../server/config-loader.js';
import { CeilingZoneSchema } from '../../shared/project-render-facts-schema.js';

interface CeilingEntry {
  id: string;
  room: string;
  type: string;
  thickness?: number;
  area?: [number, number, number, number];
}

const entries = parseYaml(readFileSync('config/model/envelope/ceiling.yaml', 'utf8')) as CeilingEntry[];

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
  // 2026-11-27 量房回填：矩形随实测几何改（x 4.20→4.16、z 5.55→5.455、门厅西缘 10.80→11.11、
  // 客卫南缘 4.155→4.04）；厚度不再是统一 0.30，而是实测板底高 − 2.50m 完成面：
  // 主走廊 2.898−2.50=0.398、书房北缘 2.909−2.50=0.409、门厅板底约 2.90−2.50=0.40。
  // 矩形与 floor-zones.yaml 对应 floor_region 一致（entry_foyer_floor x 11.11 起、
  // main_corridor_floor x 4.16 / z 3.75 起）。
  const expected: Record<string, { area: [number, number, number, number]; thickness: number }> = {
    ceiling_main_corridor: { area: [4.16, 3.75, 7.15, 5.455], thickness: 0.398 },
    // 2026-08-26：父母房走廊吊顶收窄为衣柜深度边吊（z 5.55–6.45），z[6.45,7.8] 走廊地面由 study 房间基础顶面覆盖
    ceiling_corridor: { area: [4.16, 5.455, 7.15, 6.355], thickness: 0.409 },
    ceiling_entry_foyer: { area: [11.11, 3.00, 12.77, 4.155], thickness: 0.40 }, // R01 重算
  };
  for (const [id, want] of Object.entries(expected)) {
    const e = byId.get(id);
    assert.ok(e, `missing ceiling entry ${id}`);
    assert.equal(e.type, 'drop');
    assert.equal(e.thickness, want.thickness);
    assert.deepEqual(e.area, want.area);
  }
});

test('ceiling corner_radii accepts a partial set of known corners and rejects unknown keys', () => {
  const partialCorners = CeilingZoneSchema.safeParse({
    id: 'ceiling_test', room: 'living', type: 'drop', corner_radii: { nw: 0.4, se: 0.2 },
  });
  assert.equal(partialCorners.success, true);

  const typoCorner = CeilingZoneSchema.safeParse({
    id: 'ceiling_test', room: 'living', type: 'drop', corner_radii: { north_west: 0.4 },
  });
  assert.equal(typoCorner.success, false);
});
