// 家具角色显式查表（fail-closed）单测 + 真实仓数据不变式断言。
//   1) 纯逻辑：resolveFurnitureProfile 的查表顺序（override → furniture_profiles → mep_coordination_types）
//      与未登记返回 undefined 的 fail-closed 信号。
//   2) 数据不变式：config/house.yaml 中每个 placed 类型都必须在 spatial-validation.yaml 显式登记，
//      否则 verify:spatial 会 fail-closed 报 error；该不变式可防新增放置类型漏登记。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import {
  resolveFurnitureProfile,
  isFurnitureProfileRegistered,
  type FurnitureProfileConfig,
} from '../../scripts/verify/spatial/furniture-profile.js';

// ─── 纯逻辑 ────────────────────────────────────────────────────────────────

const config: FurnitureProfileConfig = {
  furniture_profile_overrides: [
    { types: ['mb_vanity_base_cabinet'], profile: 'built_in_casework', wall: 'w_mbath_east', wall_side: 'west', required_wall_clearance: 0.015, site_trim: true },
  ],
  furniture_profiles: {
    wardrobe_180: { profile: 'built_in_casework' },
    bed_150: { profile: 'freestanding' },
  },
  mep_coordination_types: ['condensate_pipe_ac_outlet'],
};

test('furniture_profile_overrides 优先，并带回墙/净距/收口特化字段', () => {
  const resolved = resolveFurnitureProfile('mb_vanity_base_cabinet', config);
  assert.deepEqual(resolved, { profile: 'built_in_casework', wall: 'w_mbath_east', wall_side: 'west', required_wall_clearance: 0.015, site_trim: true });
});

test('furniture_profiles 登记表命中，仅回 profile', () => {
  assert.deepEqual(resolveFurnitureProfile('wardrobe_180', config), { profile: 'built_in_casework' });
  assert.deepEqual(resolveFurnitureProfile('bed_150', config), { profile: 'freestanding' });
});

test('mep_coordination_types 命中 → mep_coordination', () => {
  assert.deepEqual(resolveFurnitureProfile('condensate_pipe_ac_outlet', config), { profile: 'mep_coordination' });
});

test('未登记类型返回 undefined —— fail-closed 信号，而非回落到 freestanding 默认', () => {
  assert.equal(resolveFurnitureProfile('xxx_cabinet_run', config), undefined);
  assert.equal(isFurnitureProfileRegistered('xxx_cabinet_run', config), false);
});

// ─── 真实仓数据不变式 ────────────────────────────────────────────────────────

function placedTypes(furnishings: Record<string, unknown>): string[] {
  const types = new Set<string>();
  for (const items of Object.values(furnishings)) {
    for (const raw of items as Array<Record<string, unknown>>) {
      const placed = raw.x !== undefined || raw.z !== undefined || raw.wall !== undefined || raw.along !== undefined;
      if (placed) types.add(String(raw.type));
    }
  }
  return [...types].sort();
}

test('config/house.yaml 的每个 placed 类型都已在 spatial-validation.yaml 显式登记（fail-closed 不误触）', () => {
  const house = parseYaml(readFileSync(new URL('../../config/house.yaml', import.meta.url), 'utf8')) as { furnishings: Record<string, unknown> };
  const spatial = parseYaml(readFileSync(new URL('../../config/spatial-validation.yaml', import.meta.url), 'utf8')) as FurnitureProfileConfig;
  const placed = placedTypes(house.furnishings);
  assert.ok(placed.length > 0, 'expected placed furniture types');
  const unregistered = placed.filter((type) => !isFurnitureProfileRegistered(type, spatial));
  assert.deepEqual(unregistered, [], `placed types missing explicit role registration: ${unregistered.join(', ')}`);
});
