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

  it('adds a daylight-only local fill and exposure override for living_from_sw', () => {
    const camera = buildRenderConfig(projection).cameras.find((item) => item.id === 'living_from_sw');
    assert.ok(camera);

    assert.deepEqual(camera.scenario_overrides, {
      daylight: { fill_light: 120, fill_from_camera: true, exposure: 0.25 },
    });
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

  it('updates the guest bathroom overview to an exterior three-quarter view', () => {
    const camera = buildRenderConfig(projection).cameras.find((item) => item.id === 'guest_bath_overview');
    assert.ok(camera);

    assert.equal(camera.label, '客卫门外三分之四总览（马桶、淋浴与外置洗漱台）');
    assert.deepEqual(camera.position, [5.15, 1.55, 4.65]);
    assert.deepEqual(camera.target, [6.45, 0.95, 3.15]);
    assert.equal(camera.lens, 20);
    assert.equal(camera.room, 'guest_bath');
    assert.equal(camera.purpose, 'overview');
    assert.deepEqual(camera.scenarios, ['material_review', 'bare_shell']);
    assert.equal(camera.fill_light, 60);
    assert.equal(camera.exposure, -1.5);
  });

  it('adds the kitchen reverse southeast relationship camera', () => {
    const camera = buildRenderConfig(projection).cameras.find((item) => item.id === 'kitchen_function_reverse_se');
    assert.ok(camera);

    assert.deepEqual(camera.position, [9.25, 1.55, 3.55]);
    assert.deepEqual(camera.target, [9.75, 1.05, 0.95]);
    assert.equal(camera.lens, 28);
    assert.deepEqual(camera.scenarios, ['material_review', 'daylight_clear']);
    assert.equal(camera.room, 'kitchen');
    assert.equal(camera.purpose, 'relationship');
    assert.deepEqual(camera.decisionQuestions, [
      '水槽—灶台—冰箱三角动线是否清晰？',
      'L 型柜体的转角、连续性与操作区关系是否协调？',
    ]);
  });

  it('adjusts only the kitchen function overview camera for full L-work-area readability', () => {
    const cameras = buildRenderConfig(projection).cameras;
    const camera = cameras.find((item) => item.id === 'kitchen_function_overview');
    assert.ok(camera);

    assert.deepEqual(camera.position, [7.2, 2.3, 5.85]);
    assert.deepEqual(camera.target, [9.35, 1.0, 1.35]);
    assert.deepEqual(camera.scenarios, ['material_review']);
    assert.equal(camera.lens, 24);
    assert.equal(camera.fill_light, 420);
    assert.equal(camera.exposure, -1.0);

    const lOverview = cameras.find((item) => item.id === 'kitchen_l_overview');
    assert.ok(lOverview);
    assert.deepEqual(lOverview.position, [7.85, 1.55, 5.35]);
    assert.deepEqual(lOverview.target, [9.15, 1.05, 1.2]);
    assert.equal(lOverview.lens, 24);
    assert.deepEqual(lOverview.scenario_overrides, {
      material_review: { exposure: -0.75 },
    });
  });

  it('moves the master bedroom three-quarter view right and slightly back/up to clear the cabinet', () => {
    const camera = buildRenderConfig(projection).cameras.find((item) => item.id === 'master_bed_looking_glass');
    assert.ok(camera);

    assert.deepEqual(camera.position, [1.2, 2.2, 3.7]);
    assert.deepEqual(camera.target, [3.0, 1.05, 8.55]);
    assert.deepEqual(camera.scenarios, ['material_review', 'daylight', 'daylight_clear', 'bare_shell']);
    assert.equal(camera.fill_light, 160);
    assert.equal(camera.exposure, -1.0);
    assert.deepEqual(camera.scenario_overrides, { daylight_clear: { sheer_opacity: 0.40 } });
  });

  it('adds the master bedroom entry context relationship camera inside the room', () => {
    const camera = buildRenderConfig(projection).cameras.find((item) => item.id === 'master_bedroom_entry_context');
    assert.ok(camera);

    assert.deepEqual(camera.position, [1.45, 1.65, 6.55]);
    assert.ok(camera.position[0] < 4.2);
    assert.deepEqual(camera.target, [2.85, 1.05, 8.75]);
    assert.equal(camera.lens, 24);
    assert.deepEqual(camera.scenarios, ['daylight_clear', 'material_review']);
    assert.equal(camera.room, 'master_bedroom');
    assert.equal(camera.purpose, 'relationship');
    assert.equal(camera.decisionQuestions.length, 2);
    assert.deepEqual(camera.decisionQuestions, [
      '从入口看床、窗帘与玻璃的整体关系是否协调？',
      '床侧活动区与入口通道是否保持顺畅？',
    ]);
  });

  it('adds the master bedroom room-level relationship overview camera', () => {
    const camera = buildRenderConfig(projection).cameras.find((item) => item.id === 'master_bedroom_relationship_overview');
    assert.ok(camera);

    assert.equal(camera.label, '主卧西侧通道看床+衣柜+西侧玻璃/窗帘关系总览');
    assert.deepEqual(camera.position, [0.70, 1.60, 6.85]);
    assert.deepEqual(camera.target, [2.65, 1.05, 8.15]);
    assert.equal(camera.lens, 20);
    assert.equal(camera.room, 'master_bedroom');
    assert.equal(camera.purpose, 'relationship');
    assert.deepEqual(camera.scenarios, ['material_review', 'daylight_clear']);
    assert.deepEqual(camera.decisionQuestions, [
      '床与衣柜的尺度、位置及使用关系是否协调？',
      '西侧玻璃/窗帘与床侧通道的采光、隐私和通行关系是否合理？',
    ]);
  });

  it('uses the master bedroom north entry toward south window relationship camera', () => {
    const camera = buildRenderConfig(projection).cameras.find((item) => item.id === 'master_bedroom_window_context');
    assert.ok(camera);

    assert.equal(camera.label, '主卧北侧入口向南窗看床体+床侧通道+衣柜');
    assert.deepEqual(camera.position, [0.75, 1.65, 5.40]);
    assert.deepEqual(camera.target, [2.60, 1.05, 8.65]);
    assert.equal(camera.lens, 18);
    assert.equal(camera.room, 'master_bedroom');
    assert.equal(camera.purpose, 'relationship');
    assert.deepEqual(camera.scenarios, ['material_review', 'daylight_clear']);
    assert.deepEqual(camera.decisionQuestions, [
      '南侧窗帘与玻璃的完整关系是否清晰？',
      '床体、床侧通道与衣柜之间的尺度和通行关系是否合理？',
    ]);
  });

  it('adds the balcony utility wall relationship camera', () => {
    const cameras = buildRenderConfig(projection).cameras;
    const camera = cameras.find((item) => item.id === 'balcony_utility_wall');
    assert.ok(camera);

    assert.equal(camera.label, '生活阳台洗烘设备墙正视（设备前通道与玻璃门关系）');
    assert.deepEqual(camera.position, [6.72, 1.45, 1.55]);
    assert.deepEqual(camera.target, [5.92, 1.2, 1.55]);
    assert.equal(camera.lens, 18);
    assert.equal(camera.room, 'balcony');
    assert.equal(camera.purpose, 'relationship');
    assert.deepEqual(camera.scenarios, ['material_review']);
    assert.deepEqual(camera.decisionQuestions, [
      '洗衣机与烘干机叠放后，设备前通道是否满足使用与检修？',
      '玻璃门开启范围与洗烘设备墙之间的关系是否合理？',
    ]);

    const overview = cameras.find((item) => item.id === 'balcony_overview');
    assert.ok(overview);
    assert.deepEqual(overview.position, [9.2, 1.7, 2.05]);
    assert.deepEqual(overview.target, [6.45, 0.9, 1.35]);
  });

  it('adds the bathroom door relationship cameras', () => {
    const cameras = buildRenderConfig(projection).cameras;
    const masterBath = cameras.find((item) => item.id === 'master_bath_door_relationship');
    assert.ok(masterBath);
    assert.equal(masterBath.label, '主卫门洞门扇关系视角（入口外侧看门洞/门扇/淋浴/马桶/外置洗手台）');
    assert.deepEqual(masterBath.position, [1.55, 1.65, 4.65]);
    assert.deepEqual(masterBath.target, [1.45, 1.00, 1.55]);
    assert.equal(masterBath.lens, 18);
    assert.equal(masterBath.room, 'master_bath');
    assert.equal(masterBath.purpose, 'relationship');
    assert.deepEqual(masterBath.scenarios, ['material_review']);
    assert.deepEqual(masterBath.decisionQuestions, [
      '门洞与门扇开启范围是否清晰？',
      '门洞、门扇与马桶、淋浴及玻璃隔断的关系是否合理？',
    ]);

    const guestBath = cameras.find((item) => item.id === 'guest_bath_door_relationship');
    assert.ok(guestBath);
    assert.equal(guestBath.label, '客卫门洞门扇关系候选视角（门洞/门扇/洁具/外置洗手台/过道）');
    assert.deepEqual(guestBath.position, [5.95, 1.55, 4.65]);
    assert.deepEqual(guestBath.target, [6.40, 0.95, 2.65]);
    assert.equal(guestBath.lens, 20);
    assert.equal(guestBath.room, 'guest_bath');
    assert.equal(guestBath.purpose, 'relationship');
    assert.deepEqual(guestBath.scenarios, ['material_review']);
    assert.deepEqual(guestBath.decisionQuestions, [
      '门洞与门扇开启范围是否清晰？',
      '门洞、门扇与洁具、外置洗手台及过道的关系是否合理？',
    ]);

    const reverse = cameras.find((item) => item.id === 'guest_bath_fixture_reverse');
    assert.ok(reverse);
    assert.equal(reverse.label, '客卫洁具反向关系视角（马桶/淋浴/玻璃隔断/门洞/外置洗手台/通道）');
    assert.deepEqual(reverse.position, [5.80, 1.45, 3.25]);
    assert.deepEqual(reverse.target, [6.70, 0.95, 2.65]);
    assert.equal(reverse.lens, 20);
    assert.equal(reverse.room, 'guest_bath');
    assert.equal(reverse.purpose, 'relationship');
    assert.deepEqual(reverse.scenarios, ['material_review']);
    assert.deepEqual(reverse.decisionQuestions, [
      '马桶、淋浴与玻璃隔断的尺度、位置及干湿分区关系是否合理？',
      '门洞、外置洗手台与通道的开启、使用和通行关系是否顺畅？',
    ]);
  });

  it('uses the child bedroom wider doorway-right relationship camera', () => {
    const camera = buildRenderConfig(projection).cameras.find((item) => item.id === 'bedroom_nw_relationship');
    assert.ok(camera);

    assert.equal(camera.label, '儿童房门外右侧开阔关系视角（床+衣柜+书桌椅+窗+入口通道）');
    assert.deepEqual(camera.position, [5.72, 2.05, 4.78]);
    assert.deepEqual(camera.target, [3.95, 1.05, 2.45]);
    assert.equal(camera.lens, 18);
    assert.equal(camera.room, 'bedroom_nw');
    assert.equal(camera.purpose, 'relationship');
    assert.deepEqual(camera.scenarios, ['material_review']);
    assert.deepEqual(camera.decisionQuestions, [
      '床、衣柜与书桌椅的尺度、位置及使用关系是否协调？',
      '北窗采光与入口通道是否清晰、顺畅？',
    ]);
  });

  it('adds the southeast bedroom entry context relationship camera', () => {
    const camera = buildRenderConfig(projection).cameras.find((item) => item.id === 'bedroom_se_entry_context');
    assert.ok(camera);

    assert.deepEqual(camera.position, [13.80, 1.60, 6.20]);
    assert.deepEqual(camera.target, [15.20, 1.05, 7.35]);
    assert.equal(camera.lens, 18);
    assert.equal(camera.room, 'bedroom_se');
    assert.equal(camera.purpose, 'relationship');
    assert.deepEqual(camera.scenarios, ['material_review']);
    assert.deepEqual(camera.decisionQuestions, [
      '从入口看桌椅、训练区、低柜与南侧飘窗/玻璃的关系是否清晰？',
      '入口通道与桌椅、训练区、低柜之间的通行关系是否顺畅？',
    ]);
  });

  it('uses the southeast bedroom east-side diagonal relationship overview to avoid the training rack', () => {
    const camera = buildRenderConfig(projection).cameras.find((item) => item.id === 'bedroom_se_relationship_overview');
    assert.ok(camera);

    assert.equal(camera.label, '书房东侧斜向关系总览（避开训练架，书桌、椅子、东墙低柜、南侧飘窗/玻璃与入口通道）');
    assert.deepEqual(camera.position, [16.05, 1.60, 5.85]);
    assert.deepEqual(camera.target, [14.70, 1.05, 7.50]);
    assert.equal(camera.lens, 19);
    assert.equal(camera.room, 'bedroom_se');
    assert.equal(camera.purpose, 'relationship');
    assert.deepEqual(camera.scenarios, ['material_review']);
    assert.deepEqual(camera.decisionQuestions, [
      '书桌、椅子与东墙低柜的尺度、位置及使用关系是否协调？',
      '南侧飘窗/玻璃、训练区边界与入口通道的关系是否清晰、顺畅？',
    ]);
  });

  it('uses the south work-area relationship view without claiming a full-room view', () => {
    const camera = buildRenderConfig(projection).cameras.find((item) => item.id === 'study_work_detail');
    assert.ok(camera);

    assert.equal(camera.label, '书房东侧桌椅工作区辅助视角（避开训练架横杆；桌椅/桌前使用尺度）');
    assert.deepEqual(camera.position, [15.80, 1.50, 6.40]);
    assert.deepEqual(camera.target, [14.20, 0.90, 8.00]);
    assert.equal(camera.lens, 20);
    assert.equal(camera.room, 'bedroom_se');
    assert.equal(camera.purpose, 'detail');
    assert.deepEqual(camera.decisionQuestions, [
      '桌椅与低柜的尺度、位置及使用关系是否协调？',
      '桌前使用尺度与活动空间是否满足日常工作？',
    ]);
  });

  it('adds explicit metadata to every camera', () => {
    const cameras = buildRenderConfig(projection).cameras;
    assert.equal(cameras.length, 37);

    const purposes = new Set(['overview', 'relationship', 'detail', 'auxiliary']);
    for (const camera of cameras) {
      assert.equal(typeof camera.room, 'string');
      assert.ok(purposes.has(camera.purpose));
      assert.equal(camera.decisionQuestions.length, 2);
      assert.ok(camera.decisionQuestions.every((question) => question.length > 0));
    }
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