import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildRenderConfig } from '../../scripts/blender/gen-render-config.js';
import type { ProjectRenderFactsProjection } from '../../shared/types.js';

const projection: ProjectRenderFactsProjection = {
  version: '2.0',
  lighting: { fixtures: [] },
  lightingFixtures: [],
  plumbing: [],
  ceiling: [],
  hvac: { status: 'unimplemented', planId: null },
  materials: { floor: { default: null, roomOverrides: {} } },
  presentation: {
    curtains: {
      source: { default: 'open', roomOverrides: {}, updatedAt: '2026-08-25T00:00:00.000Z' },
      effectiveByRoom: {},
      curtains: [],
      snapshotSha256: '0'.repeat(64),
    },
  },
};

describe('buildRenderConfig daylight scenarios', () => {
  it('reduces daylight light stacking and explicitly controls exposure transform', () => {
    const scenarios = buildRenderConfig(projection).scenarios;
    const daylight = scenarios.find((scenario) => scenario.id === 'daylight');
    assert.ok(daylight);

    assert.deepEqual(daylight.sun_direction, [-0.3, -0.6, 0.7]);
    assert.equal(daylight.sun_energy, 4);
    assert.equal(daylight.world_hdri_lighting, true);
    assert.equal(daylight.world_strength, 0.55);
    assert.equal(Object.hasOwn(daylight, 'window_portal'), false);
    assert.equal(daylight.lights_on, false);
    assert.equal(daylight.view_transform, 'AgX');
    assert.equal(daylight.look, 'None');
    assert.equal(daylight.exposure, -0.5);
  });

  it('keeps daylight_clear lighting and camera controls identical to daylight', () => {
    const scenarios = buildRenderConfig(projection).scenarios;
    const daylight = scenarios.find((scenario) => scenario.id === 'daylight');
    const clear = scenarios.find((scenario) => scenario.id === 'daylight_clear');
    assert.ok(daylight);
    assert.ok(clear);

    for (const key of [
      'sun_direction', 'sun_energy', 'sun_temp', 'world_hdri', 'world_hdri_lighting',
      'world_hdri_camera_strength', 'world_color', 'world_strength', 'lights_on',
      'light_temp', 'view_transform', 'look', 'exposure', 'sheer_opacity', 'glass_ior',
    ] as const) {
      assert.deepEqual(clear[key], daylight[key], `${key} must match daylight`);
    }
    assert.equal(Object.hasOwn(clear, 'window_portal'), false);
    assert.equal(clear.glass_tint, '#e8f0ee');
  });

  it('calibrates material_review and bare_shell exposure controls', () => {
    const scenarios = buildRenderConfig(projection).scenarios;
    const night = scenarios.find((scenario) => scenario.id === 'night');
    const materialReview = scenarios.find((scenario) => scenario.id === 'material_review');
    assert.ok(night);
    assert.ok(materialReview);

    assert.equal(night.exposure, 0.5);
    assert.equal(materialReview.view_transform, 'Standard');
    assert.equal(materialReview.look, 'None');
    assert.equal(materialReview.exposure, 0.5);
    const bareShell = scenarios.find((scenario) => scenario.id === 'bare_shell');
    assert.ok(bareShell);
    assert.equal(bareShell.view_transform, 'Standard');
    assert.equal(bareShell.look, 'None');
    assert.equal(bareShell.exposure, 0.5);
  });
});