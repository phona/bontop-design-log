// 灯具派生 parity 守门测试。
//
// 背景：渲染锚点派生曾经有两份实现——权威投影 shared/project-render-facts-projection.ts
// （喂 app/GLB 的 data/project-render-facts.json）与 shared/penetration/scene.ts 的
// renderLightingFixtures()（喂 verify:spatial / verify:penetration 的 runtime 场景）。
// 分叉的那版不做 offsetX/offsetZ 平移、高度还静默兜底 2.8m，于是 linter 校验的是
// 「位置上不存在的灯」（实例：light_tv_strip 的 offsetX: 0.15）。
//
// 现在两边共用 shared/lighting-fixtures.ts 的同一个函数。本文件钉住三件事：
// ① 同一份权威配置下，linter 侧派生结果与投影逐字段（含键序）一致；
// ② overrides 的平面偏移真的进了 linter 的 runtime 场景，而不是只进了投影；
// ③ 缺 override / 缺 height / 重复或未知 override / 非 night_light 挂家具面 → throw（fail-closed）。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  buildRenderLightingFixtures,
  buildRenderLightingFixtureHeights,
  isLightingFixtureType,
} from '../../shared/lighting-fixtures.js';
import { parseElectricalPoints, parseRenderLightingOverrides } from '../../shared/project-render-facts-schema.js';
import { buildProjectRenderFactsFromFiles } from '../../scripts/project/project-render-facts-projection.js';
import { buildRuntimeScene, loadSceneInputs } from '../../shared/penetration/scene.js';
import type { ElectricalPoint, RenderLightingFixture, RenderLightingOverride } from '../../shared/types.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (relative: string) => readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');

/** 真实 house 的权威输入：电气点位 + 渲染挂点偏移。 */
const houseElectrical = () => parseElectricalPoints(read('config/electrical.yaml'));
const houseOverrides = () => parseRenderLightingOverrides(read('config/render/overrides.yaml'));

const override = (id: string, extra: Partial<RenderLightingOverride> = {}): RenderLightingOverride => ({
  id,
  anchorY_offset: 0,
  basis: 'test basis',
  reason: 'test reason',
  applies_to: ['web', 'blender'],
  ...extra,
});

const point = (extra: Partial<ElectricalPoint> & Pick<ElectricalPoint, 'id' | 'type'>): ElectricalPoint => ({
  room: 'living_dining',
  x: 1,
  z: 2,
  height: 2.8,
  ...extra,
});

describe('lighting fixture derivation parity', () => {
  it('derives the same fixtures in the linter as in the authoritative projection', () => {
    const projection = buildProjectRenderFactsFromFiles(ROOT);
    const derived = buildRenderLightingFixtures(houseElectrical(), houseOverrides());
    assert.deepEqual(derived, projection.lightingFixtures);
    // 键序也要一致：project-render-facts 的 schema 对产出键序敏感（见 project-render-facts-schema.ts）。
    assert.equal(JSON.stringify(derived), JSON.stringify(projection.lightingFixtures));
  });

  it('computes the same position for every fixture id, offset included', () => {
    const projection = buildProjectRenderFactsFromFiles(ROOT);
    const derived = new Map(buildRenderLightingFixtures(houseElectrical(), houseOverrides()).map((fixture) => [fixture.id, fixture]));
    assert.equal(derived.size, projection.lightingFixtures.length);
    for (const expected of projection.lightingFixtures) {
      const actual = derived.get(expected.id);
      assert.ok(actual, `linter derivation is missing lighting fixture ${expected.id}`);
      assert.deepEqual(actual.position, expected.position, `position drift for ${expected.id}`);
    }
    // 活证据：light_tv_strip 声明 offsetX: 0.15（电视墙灯带向室内偏移）。
    // 投影把它放在 x=7.35；linter 必须算同一个点，而不是电气点位原值 7.2。
    const strip = derived.get('light_tv_strip');
    assert.equal(strip?.position.x, 7.35);
    assert.equal(houseElectrical().find((item) => item.id === 'light_tv_strip')?.x, 7.2);
  });

  it('feeds the offset position into the linter runtime scene', () => {
    const inputs = loadSceneInputs();
    const scene = buildRuntimeScene(inputs);
    const strip = scene.index.lightingFixtures.get('electrical:light_tv_strip');
    assert.ok(strip, 'runtime scene must build a lighting fixture for light_tv_strip');
    strip.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(strip);
    assert.ok(!box.isEmpty());
    // 灯带是 0.02×0.02×2.4 的盒体，中心即渲染锚点：x 必须落在 7.35（电气 7.2 + offsetX 0.15）。
    assert.ok(Math.abs((box.min.x + box.max.x) / 2 - 7.35) < 1e-6, `runtime strip center x = ${(box.min.x + box.max.x) / 2}`);
  });

  it('derives the expected anchor height table from the same formula as the render anchor', () => {
    const projection = buildProjectRenderFactsFromFiles(ROOT);
    const heights = buildRenderLightingFixtureHeights(houseElectrical(), houseOverrides());
    for (const fixture of projection.lightingFixtures) {
      assert.equal(heights.get(fixture.id), fixture.position.y, `anchor drift for ${fixture.id}`);
    }
    assert.equal(heights.size, projection.lightingFixtures.length);
  });

  it('recognises exactly the electrical schema lighting types', () => {
    for (const type of ['night_light', 'ceiling_light', 'pendant', 'dome', 'wall_lamp', 'downlight', 'led_strip', 'track_light'] as const) {
      assert.equal(isLightingFixtureType(type), true, type);
    }
    for (const type of ['socket', 'switch', 'network', 'floor_socket', 'strong_panel', 'weak_panel', 'ac_controller', 'switch_2way', 'usb'] as const) {
      assert.equal(isLightingFixtureType(type), false, type);
    }
  });
});

describe('lighting fixture derivation fail-closed', () => {
  it('applies offsetX/offsetZ and keeps host wall metadata', () => {
    const derived = buildRenderLightingFixtures(
      [point({ id: 'lamp', type: 'wall_lamp', wall: 'w_liv_east', wallSide: 'west' })],
      [override('lamp', { offsetX: 0.15, offsetZ: -0.25, anchorY_offset: -0.25 })],
    );
    assert.equal(derived.length, 1);
    assert.deepEqual(derived[0].position, { x: 1.15, y: 2.55, z: 1.75 });
    assert.equal(derived[0].wallId, 'w_liv_east');
    assert.equal(derived[0].wallSide, 'west');
    assert.equal(derived[0].temperatureK, 3000);
  });

  it('throws when a lighting fixture has no render override', () => {
    assert.throws(
      () => buildRenderLightingFixtures([point({ id: 'orphan', type: 'ceiling_light' })], []),
      /Missing render override for lighting fixture orphan/,
    );
  });

  it('throws when a lighting fixture has no electrical.height', () => {
    const noHeight = point({ id: 'headless', type: 'ceiling_light' });
    delete (noHeight as { height?: number }).height;
    assert.throws(
      () => buildRenderLightingFixtures([noHeight], [override('headless')]),
      /has no electrical\.height/,
    );
  });

  it('throws on duplicate, unknown and non-lighting override ids', () => {
    const electrical = [point({ id: 'lamp', type: 'ceiling_light' })];
    assert.throws(() => buildRenderLightingFixtures(electrical, [override('lamp'), override('lamp')]), /Duplicate render override/);
    assert.throws(() => buildRenderLightingFixtures(electrical, [override('ghost')]), /references an unknown electrical id/);
    assert.throws(
      () => buildRenderLightingFixtures([...electrical, point({ id: 'sock', type: 'socket' })], [override('sock')]),
      /does not reference a lighting fixture/,
    );
  });

  it('throws when a non-night_light declares a furniture-face mount anchor', () => {
    const anchor = { kind: 'furniture_face' as const, furnitureId: 'furniture:living_dining:tv_stand:0', face: 'north' as const };
    assert.throws(
      () => buildRenderLightingFixtures([point({ id: 'dome', type: 'dome', mountAnchor: anchor })], [override('dome')]),
      /mount_anchor is only supported for night_light/,
    );
    const allowed = buildRenderLightingFixtures([point({ id: 'night', type: 'night_light', mountAnchor: anchor })], [override('night')]);
    assert.deepEqual(allowed[0].mountAnchor, anchor);
  });

  it('omits undeclared anchors from the height table instead of inventing one', () => {
    const heights = buildRenderLightingFixtureHeights(
      [point({ id: 'lamp', type: 'ceiling_light' }), point({ id: 'headless', type: 'dome', height: undefined })],
      [override('lamp', { anchorY_offset: -0.25 })],
    );
    assert.deepEqual([...heights.entries()], [['lamp', 2.55]]);
  });
});
