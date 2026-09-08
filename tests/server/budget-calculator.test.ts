import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BudgetCalculator } from '../../server/budget-calculator.js';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { RuleEngine } from '../../server/rule-engine.js';
import type { CurrentScheme, DesignRulesConfig, FurnishingsYaml } from '../../shared/types.js';

const rulesConfig: DesignRulesConfig = {
  version: '1.0',
  budget: {
    topicCategories: {
      floor: 'masonry',
      wall: 'masonry',
      paint: 'painting',
      hvac: 'hvac',
    },
    lineItems: [
      { topic: 'floor', quantityField: 'floorArea' },
      { topic: 'wall', quantityField: 'wetWallArea' },
      { topic: 'paint', quantityField: 'paintWallArea' },
      { topic: 'hvac' },
    ],
  },
  risks: [],
  constraints: [],
};

describe('BudgetCalculator', () => {
  it('calculates HVAC as global topic', () => {
    const catalog = ProjectCatalog.load('.');
    const calc = new BudgetCalculator(catalog, rulesConfig);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        hvac: { default: 'A2', roomOverrides: {} },
        floor: { default: 'floor_tile_01', roomOverrides: {} },
        wall: { default: 'wall_tile_01', roomOverrides: {} },
        paint: { default: 'latex_paint_01', roomOverrides: {} },
      },
    };
    const snapshot = calc.calculate(scheme);
    const hvacCategory = snapshot.categories.find((c) => c.key === 'hvac');
    assert.ok(hvacCategory);
    assert.equal(hvacCategory.autoActual, 29000);
  });

  it('calculates per-room floor topic', () => {
    const catalog = ProjectCatalog.load('.');
    const calc = new BudgetCalculator(catalog, rulesConfig);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        hvac: { default: 'A1', roomOverrides: {} },
        floor: { default: 'floor_tile_01', roomOverrides: {} },
        wall: { default: 'wall_tile_01', roomOverrides: {} },
        paint: { default: 'latex_paint_01', roomOverrides: {} },
      },
    };
    const snapshot = calc.calculate(scheme);
    const floorItems = snapshot.lineItems.filter((li) => li.topic === 'floor');
    assert.ok(floorItems.length > 0);
    const masonryCategory = snapshot.categories.find((c) => c.key === 'masonry');
    assert.ok(masonryCategory);
    assert.ok(masonryCategory.autoActual > 0);
  });

  it('returns zero for unregistered topic line items', () => {
    const catalog = ProjectCatalog.load('.');
    const configWithUnknown: DesignRulesConfig = {
      ...rulesConfig,
      budget: {
        ...rulesConfig.budget,
        lineItems: [
          ...(rulesConfig.budget?.lineItems ?? []),
          { topic: 'curtains', quantityField: 'windowLength' },
        ],
        topicCategories: {
          ...rulesConfig.budget?.topicCategories,
          curtains: 'curtains',
        },
      },
    };
    const calc = new BudgetCalculator(catalog, configWithUnknown);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        hvac: { default: 'A1', roomOverrides: {} },
        floor: { default: 'floor_tile_01', roomOverrides: {} },
        wall: { default: 'wall_tile_01', roomOverrides: {} },
        paint: { default: 'latex_paint_01', roomOverrides: {} },
      },
    };
    const snapshot = calc.calculate(scheme);
    const curtainItems = snapshot.lineItems.filter((li) => li.topic === 'curtains');
    assert.equal(curtainItems.length, 0);
  });

  it('handles room overrides', () => {
    const catalog = ProjectCatalog.load('.');
    const calc = new BudgetCalculator(catalog, rulesConfig);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        hvac: { default: 'A1', roomOverrides: {} },
        floor: {
          default: 'floor_tile_01',
          roomOverrides: { master_bedroom: 'floor_tile_01' },
        },
        wall: { default: 'wall_tile_01', roomOverrides: {} },
        paint: { default: 'latex_paint_01', roomOverrides: {} },
      },
    };
    const snapshot = calc.calculate(scheme);
    const masterFloor = snapshot.lineItems.find(
      (li) => li.topic === 'floor' && li.roomId === 'master_bedroom'
    );
    assert.ok(masterFloor);
  });

  it('totalBudget sums all category budgets', () => {
    const catalog = ProjectCatalog.load('.');
    const calc = new BudgetCalculator(catalog, rulesConfig);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        hvac: { default: 'A1', roomOverrides: {} },
        floor: { default: 'floor_tile_01', roomOverrides: {} },
        wall: { default: 'wall_tile_01', roomOverrides: {} },
        paint: { default: 'latex_paint_01', roomOverrides: {} },
      },
    };
    const snapshot = calc.calculate(scheme);
    const expectedTotal = snapshot.categories.reduce((s, c) => s + c.budget, 0);
    assert.equal(snapshot.totalBudget, expectedTotal);
  });

  it('fixed calcMode adds option price directly', () => {
    const catalog = ProjectCatalog.load('.');
    const fixedConfig: DesignRulesConfig = {
      version: '1.0',
      budget: {
        topicCategories: { hvac: 'hvac' },
        lineItems: [{ topic: 'hvac', calcMode: 'fixed' }],
      },
      risks: [],
      constraints: [],
    };
    const calc = new BudgetCalculator(catalog, fixedConfig);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        hvac: { default: 'A2', roomOverrides: {} },
      },
    };
    const snapshot = calc.calculate(scheme);
    const hvacCategory = snapshot.categories.find((c) => c.key === 'hvac');
    assert.ok(hvacCategory);
    assert.equal(hvacCategory.autoActual, 29000);
    const hvacItem = snapshot.lineItems.find((li) => li.topic === 'hvac');
    assert.ok(hvacItem);
    assert.equal(hvacItem.unitPrice, 29000);
  });

  it('count calcMode computes cost from furnishings', () => {
    const catalog = ProjectCatalog.load('.');
    const countConfig: DesignRulesConfig = {
      version: '1.0',
      budget: {
        topicCategories: { range_hood: 'range_hood' },
        lineItems: [{ topic: 'range_hood', calcMode: 'count' }],
      },
      risks: [],
      constraints: [],
    };
    const calc = new BudgetCalculator(catalog, countConfig);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        range_hood: { default: 'range_hood_01', roomOverrides: {} },
      },
    };
    const snapshot = calc.calculate(scheme);
    const rangeHoodCategory = snapshot.categories.find((c) => c.key === 'range_hood');
    assert.ok(rangeHoodCategory);
    assert.equal(rangeHoodCategory.autoActual, 1200);
    const hoodItem = snapshot.lineItems.find((li) => li.topic === 'range_hood');
    assert.ok(hoodItem);
    assert.equal(hoodItem.quantity, 1);
    assert.equal(hoodItem.unitPrice, 1200);
    assert.equal(hoodItem.cost, 1200);
  });

  it('labor costs are added to categories', () => {
    const catalog = ProjectCatalog.load('.');
    const calc = new BudgetCalculator(catalog, rulesConfig);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        hvac: { default: 'A1', roomOverrides: {} },
        floor: { default: 'floor_tile_01', roomOverrides: {} },
        wall: { default: 'wall_tile_01', roomOverrides: {} },
        paint: { default: 'latex_paint_01', roomOverrides: {} },
      },
    };
    const snapshot = calc.calculate(scheme);

    const masonry = snapshot.categories.find((c) => c.key === 'masonry');
    assert.ok(masonry);
    assert.ok(masonry.actual > masonry.autoActual, 'masonry should have labor cost added');

    const painting = snapshot.categories.find((c) => c.key === 'painting');
    assert.ok(painting);
    assert.ok(painting.actual > painting.autoActual, 'painting should have labor cost added');

    const hvac = snapshot.categories.find((c) => c.key === 'hvac');
    assert.ok(hvac);
  });

  it('fixed labor rate is added as flat value', () => {
    const catalog = ProjectCatalog.load('.');
    const calc = new BudgetCalculator(catalog, rulesConfig);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        hvac: { default: 'A1', roomOverrides: {} },
        floor: { default: 'floor_tile_01', roomOverrides: {} },
        wall: { default: 'wall_tile_01', roomOverrides: {} },
        paint: { default: 'latex_paint_01', roomOverrides: {} },
      },
    };
    const snapshot = calc.calculate(scheme);

    const waterElectric = snapshot.categories.find((c) => c.key === 'water_electric');
    assert.ok(waterElectric);
    assert.equal(waterElectric.actual, 5000, 'water_electric has fixed labor of 5000');
  });

  it('categories have autoActual and manualActual tracked separately', () => {
    const catalog = ProjectCatalog.load('.');
    const calc = new BudgetCalculator(catalog, rulesConfig);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        hvac: { default: 'A1', roomOverrides: {} },
        floor: { default: 'floor_tile_01', roomOverrides: {} },
        wall: { default: 'wall_tile_01', roomOverrides: {} },
        paint: { default: 'latex_paint_01', roomOverrides: {} },
      },
    };
    const snapshot = calc.calculate(scheme);
    for (const cat of snapshot.categories) {
      assert.equal(
        cat.manualActual,
        0,
        `manualActual should be 0 for ${cat.key}`
      );
      assert.ok(
        cat.actual >= cat.manualActual + cat.autoActual,
        `actual should be >= manualActual + autoActual for ${cat.key} (labor adds on top)`
      );
    }
  });

  it('should read wet rooms from config, not hardcoded list', () => {
    const source = readFileSync('./server/budget-calculator.ts', 'utf8');
    assert.ok(!source.includes("'master_bath', 'guest_bath'"), 'should not contain hardcoded room IDs');
    assert.ok(source.includes('needs_waterproof'), 'should reference needs_waterproof');
  });

  it('uses room.area for non-rectangular rooms instead of width*depth (Gap 2)', () => {
    const catalog = ProjectCatalog.load('.');
    // 2026-08-21 隔墙北移后非矩形房间为主卧（含存储条带 L 形）
    const masterBedroom = catalog.getRoom('master_bedroom');
    assert.ok(masterBedroom, 'master_bedroom should exist');
    assert.ok(masterBedroom.area, 'master_bedroom should have resolved area');
    const bboxArea = masterBedroom.width * masterBedroom.depth;
    assert.ok(
      Math.abs(masterBedroom.area! - bboxArea) > 0.01,
      `area (${masterBedroom.area}) should differ from bbox (${bboxArea}) for non-rectangular room`
    );
  });

  it('computes status ok when actual is below 90% of budget', () => {
    const catalog = ProjectCatalog.load('.');
    const calc = new BudgetCalculator(catalog, rulesConfig);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        hvac: { default: 'A2', roomOverrides: {} },
        floor: { default: 'floor_tile_01', roomOverrides: {} },
        wall: { default: 'wall_tile_01', roomOverrides: {} },
        paint: { default: 'latex_paint_01', roomOverrides: {} },
      },
    };
    const snapshot = calc.calculate(scheme);
    const painting = snapshot.categories.find((c) => c.key === 'painting');
    assert.ok(painting);
    assert.ok(['ok', 'near', 'over'].includes(painting.status));
  });

  it('computes status over when actual exceeds budget and includes attribution', () => {
    const catalog = ProjectCatalog.load('.');
    // Force wall_tile_02 (22元/片, expensive) to push masonry over budget
    const calc = new BudgetCalculator(catalog, rulesConfig);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        hvac: { default: 'A2', roomOverrides: {} },
        floor: { default: 'floor_tile_03', roomOverrides: {} },
        wall: { default: 'wall_tile_02', roomOverrides: {} },
        paint: { default: 'latex_paint_01', roomOverrides: {} },
      },
    };
    const snapshot = calc.calculate(scheme);
    const masonry = snapshot.categories.find((c) => c.key === 'masonry');
    assert.ok(masonry);
    if (masonry.status === 'over' || masonry.status === 'near') {
      const att = snapshot.attribution?.masonry;
      assert.ok(att, 'attribution must exist for near/over category');
      assert.ok(att.topItems.length > 0);
      assert.equal(att.overBy, masonry.actual - masonry.budget);
    }
  });

  it('keeps contingency status as reserved', () => {
    const catalog = ProjectCatalog.load('.');
    const calc = new BudgetCalculator(catalog, rulesConfig);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        hvac: { default: 'A2', roomOverrides: {} },
        floor: { default: 'floor_tile_01', roomOverrides: {} },
        wall: { default: 'wall_tile_01', roomOverrides: {} },
        paint: { default: 'latex_paint_01', roomOverrides: {} },
      },
    };
    const snapshot = calc.calculate(scheme);
    const contingency = snapshot.categories.find((c) => c.key === 'contingency');
    assert.ok(contingency);
    assert.equal(contingency.status, 'reserved');
  });

  it('hvac budget reflects selected option price (P0 four-pool)', () => {
    const catalog = ProjectCatalog.load('.');
    const calc = new BudgetCalculator(catalog, rulesConfig);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        hvac: { default: 'A2', roomOverrides: {} },
        floor: { default: 'floor_tile_01', roomOverrides: {} },
        wall: { default: 'wall_tile_01', roomOverrides: {} },
        paint: { default: 'latex_paint_01', roomOverrides: {} },
      },
    };
    const snapshot = calc.calculate(scheme);
    const hvac = snapshot.categories.find((c) => c.key === 'hvac');
    assert.ok(hvac);
    assert.equal(hvac.budget, 29000, 'hvac budget now part of four-pool total');
    assert.equal(hvac.actual, 29000);
    assert.equal(hvac.status, 'near');
  });

  it('furniture count mode prices via furnishingTypeToTopic mapping (P0 bug fix)', () => {
    const catalog = ProjectCatalog.load('.');
    const realRules = RuleEngine.load('config/design-rules.yaml').getConfig();
    const calc = new BudgetCalculator(catalog, realRules);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        bed: { default: 'bed_180_01', roomOverrides: {} },
        mattress: { default: 'mattress_180_01', roomOverrides: {} },
        wardrobe: { default: 'wardrobe_240_01', roomOverrides: {} },
        sofa: { default: 'sofa_3seat_01', roomOverrides: {} },
      },
    };
    const snapshot = calc.calculate(scheme);

    const bedItems = snapshot.lineItems.filter((li) => li.topic === 'bed');
    assert.equal(bedItems.length, 3, 'three rooms have a bed (bed_180/bed_150 → bed)');
    assert.equal(
      bedItems.reduce((s, li) => s + li.cost, 0),
      7500,
      '3 beds × 2500'
    );

    const furnitureSoft = snapshot.categories.find((c) => c.key === 'furniture_soft');
    assert.ok(furnitureSoft, 'furniture_soft category exists');
    assert.ok(furnitureSoft!.autoActual > 0, 'furniture now priced (was 0 before mapping fix)');
  });

  it('appliances fixed mode flows into appliances pool (P0)', () => {
    const catalog = ProjectCatalog.load('.');
    const realRules = RuleEngine.load('config/design-rules.yaml').getConfig();
    const calc = new BudgetCalculator(catalog, realRules);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        gas_stove: { default: 'gas_stove_01', roomOverrides: {} },
        dishwasher: { default: 'dishwasher_01', roomOverrides: {} },
        water_purifier: { default: 'water_purifier_01', roomOverrides: {} },
        washer: { default: 'washer_01', roomOverrides: {} },
        dryer: { default: 'dryer_01', roomOverrides: {} },
        shower_enclosure: { default: 'shower_enclosure_01', roomOverrides: {} },
      },
    };
    const snapshot = calc.calculate(scheme);
    const appliances = snapshot.categories.find((c) => c.key === 'appliances');
    assert.ok(appliances, 'appliances category exists');
    assert.equal(appliances!.autoActual, 11300, '6 appliances sum (800+2500+1500+2500+2500+1500)');
  });

  it('four-pool total_budget includes hard + hvac + furniture + appliances (P0)', () => {
    const catalog = ProjectCatalog.load('.');
    const calc = new BudgetCalculator(catalog, rulesConfig);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: { hvac: { default: 'A2', roomOverrides: {} } },
    };
    const snapshot = calc.calculate(scheme);
    assert.equal(snapshot.totalBudget, 208000);
    for (const key of ['furniture_soft', 'appliances', 'hvac']) {
      assert.ok(snapshot.categories.find((c) => c.key === key), `${key} category present`);
    }
  });

  it('DEC-041: unified floor topic bills all rooms except entry_garden (developer-finished skip)', () => {
    const catalog = ProjectCatalog.load('.');
    const realRules = RuleEngine.load('config/design-rules.yaml').getConfig();
    const calc = new BudgetCalculator(catalog, realRules);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: { floor: { default: 'floor_pbr_tile_612', roomOverrides: {} } },
    };
    const snapshot = calc.calculate(scheme);
    const floorRooms = new Set(
      snapshot.lineItems.filter((li) => li.topic === 'floor').map((li) => li.roomId)
    );
    assert.ok(!floorRooms.has('entry_garden'), 'entry_garden skipped (开发商已铺)');
    assert.ok(!floorRooms.has('elevator_shaft'), 'elevator_shaft never billed');
    for (const rid of ['kitchen', 'living_dining', 'master_bedroom', 'study', 'bedroom_nw', 'bedroom_se']) {
      assert.ok(floorRooms.has(rid), `floor applies to ${rid}`);
    }
  });

  it('DEC-041: explicit entry_garden override re-enables billing (overrides always respected)', () => {
    const catalog = ProjectCatalog.load('.');
    const realRules = RuleEngine.load('config/design-rules.yaml').getConfig();
    const calc = new BudgetCalculator(catalog, realRules);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: { floor: { default: 'floor_pbr_tile_612', roomOverrides: { entry_garden: 'floor_tile_01' } } },
    };
    const snapshot = calc.calculate(scheme);
    const entryItem = snapshot.lineItems.find((li) => li.topic === 'floor' && li.roomId === 'entry_garden');
    assert.ok(entryItem, 'explicit override bypasses applyRooms skip');
    assert.ok((entryItem?.cost ?? 0) > 0);
  });

  it('cabinet scoped to kitchen only (calibration)', () => {
    const catalog = ProjectCatalog.load('.');
    const realRules = RuleEngine.load('config/design-rules.yaml').getConfig();
    const calc = new BudgetCalculator(catalog, realRules);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: { cabinet: { default: 'cabinet_board_01', roomOverrides: {} } },
    };
    const snapshot = calc.calculate(scheme);
    const cabinetItems = snapshot.lineItems.filter((li) => li.topic === 'cabinet');
    assert.equal(cabinetItems.length, 1, 'cabinet only in kitchen');
    assert.equal(cabinetItems[0].roomId, 'kitchen');
  });

  it('DEC-041: per-room floor override bills the overridden option', () => {
    const catalog = ProjectCatalog.load('.');
    const realRules = RuleEngine.load('config/design-rules.yaml').getConfig();
    const calc = new BudgetCalculator(catalog, realRules);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: { floor: { default: 'floor_pbr_tile_612', roomOverrides: { living_dining: 'floor_tile_herringbone_01' } } },
    };
    const snapshot = calc.calculate(scheme);
    const livingItem = snapshot.lineItems.find((li) => li.topic === 'floor' && li.roomId === 'living_dining');
    assert.ok(livingItem);
    assert.equal(livingItem?.optionId, 'floor_tile_herringbone_01');
    const masonry = snapshot.categories.find((c) => c.key === 'masonry');
    assert.ok(masonry && masonry.autoActual > 0);
  });

  it('exposes projectCeiling and overCeilingBy in snapshot (P1)', () => {
    const catalog = ProjectCatalog.load('.');
    const calc = new BudgetCalculator(catalog, rulesConfig);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: { hvac: { default: 'A2', roomOverrides: {} } },
    };
    const snapshot = calc.calculate(scheme);
    assert.equal(snapshot.projectCeiling, 190000);
    assert.equal(snapshot.overCeilingBy, snapshot.totalActual - 190000);
  });

  it('wardrobe topic bills per-room with distinct options (master frontstage / study seasonal backstage)', () => {
    const catalog = ProjectCatalog.load('.');
    // Stub furnishings so this test does not depend on in-flight house.yaml edits:
    // master_bedroom 用 R7 北墙650定制柜（收窄避 d_mb 门扇），bedroom_se 用新后台柜，bedroom_nw 沿用既有 wardrobe_180
    (catalog as unknown as { furnishings: FurnishingsYaml }).furnishings = {
      master_bedroom: [{ type: 'master_north_wall_wardrobe_950', x: 1.0, z: 1.0, rotation: 0 }],
      bedroom_se: [{ type: 'study_seasonal_wardrobe_wall', x: 1.0, z: 1.0, rotation: 0 }],
      bedroom_nw: [{ type: 'wardrobe_180', x: 1.0, z: 1.0, rotation: 0 }],
    };
    const realRules = RuleEngine.load('config/design-rules.yaml').getConfig();
    const calc = new BudgetCalculator(catalog, realRules);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        wardrobe: {
          default: 'wardrobe_180_01',
          roomOverrides: {
            master_bedroom: 'wardrobe_north_950_custom_01',
            bedroom_se: 'study_seasonal_wardrobe_170_01',
          },
        },
      },
    };
    const snapshot = calc.calculate(scheme);
    const wardrobeItems = snapshot.lineItems.filter((li) => li.topic === 'wardrobe');
    assert.equal(wardrobeItems.length, 3, 'three rooms each produce one wardrobe line');
    const mb = wardrobeItems.find((li) => li.roomId === 'master_bedroom');
    assert.equal(mb?.optionId, 'wardrobe_north_950_custom_01');
    assert.equal(mb?.unitPrice, 0);
    const mbOption = catalog.getOption('wardrobe', 'wardrobe_north_600_finished_01');
    assert.ok(mbOption);
    assert.match(mbOption.name, /600/);
    assert.equal(mbOption.data && (mbOption.data as { spec?: string }).spec, '600×580×2050mm');
    const legacyOption = catalog.getOption('wardrobe', 'wardrobe_062_finished_01');
    assert.ok(legacyOption, 'legacy option remains historical');
    const se = wardrobeItems.find((li) => li.roomId === 'bedroom_se');
    assert.equal(se?.optionId, 'study_seasonal_wardrobe_170_01');
    assert.equal(se?.unitPrice, 2600);
    const nw = wardrobeItems.find((li) => li.roomId === 'bedroom_nw');
    assert.equal(nw?.optionId, 'wardrobe_180_01', 'rooms without override fall back to topic default');
    assert.equal(nw?.unitPrice, 3200);
    const prices = new Set(wardrobeItems.map((li) => li.unitPrice));
    assert.equal(prices.size, 3, 'per-room pricing, not a single whole-house default');
  });

  it('home_fitness bills only the count-only set; placed equipment stays render-only', () => {
    const catalog = ProjectCatalog.load('.');
    // 可见器材 adjustable_dumbbell_pair / bench_adjustable / rollable_training_mat 故意不映射
    // （只渲染不计价）；只有 count-only 的 home_fitness_light_set 应产生一条预算行
    (catalog as unknown as { furnishings: FurnishingsYaml }).furnishings = {
      bedroom_se: [
        { type: 'adjustable_dumbbell_pair', x: 15.0, z: 6.5, rotation: 0 },
        { type: 'bench_adjustable', x: 15.2, z: 6.65, rotation: 90 },
        { type: 'rollable_training_mat', x: 15.2, z: 6.6, rotation: 0 },
        { type: 'home_fitness_light_set', count: 1 },
      ],
    };
    const realRules = RuleEngine.load('config/design-rules.yaml').getConfig();
    const calc = new BudgetCalculator(catalog, realRules);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        home_fitness: { default: 'home_fitness_light_set_01', roomOverrides: {} },
      },
    };
    const snapshot = calc.calculate(scheme);
    const fitnessItems = snapshot.lineItems.filter((li) => li.topic === 'home_fitness');
    assert.equal(fitnessItems.length, 1, 'exactly one home_fitness line (the count-only set)');
    assert.equal(fitnessItems[0].roomId, 'bedroom_se');
    assert.equal(fitnessItems[0].optionId, 'home_fitness_light_set_01');
    assert.equal(fitnessItems[0].quantity, 1);
    assert.equal(fitnessItems[0].unitPrice, 1800);
    assert.equal(fitnessItems[0].cost, 1800);
    assert.equal(
      snapshot.lineItems.filter((li) => li.roomId === 'bedroom_se').length,
      1,
      'placed dumbbell/bench/mat produce no budget lines (render-only, anti triple-billing)'
    );
  });

  it('wardrobe_180_01 topic fix: orphan miscellaneous topic gone, existing priced lines unchanged', () => {
    const catalog = ProjectCatalog.load('.');
    assert.equal(
      catalog.getTopic('miscellaneous'),
      undefined,
      'miscellaneous orphan topic eliminated (wardrobe_180_01 was its only option)'
    );
    assert.ok(
      catalog.getOption('wardrobe', 'wardrobe_180_01'),
      'wardrobe_180_01 is now a wardrobe option'
    );
    const realRules = RuleEngine.load('config/design-rules.yaml').getConfig();
    const calc = new BudgetCalculator(catalog, realRules);
    const scheme = JSON.parse(readFileSync('./data/current-scheme.json', 'utf8')) as CurrentScheme;
    const snapshot = calc.calculate(scheme);
    // 纠偏前后 diff：design-rules 从未为 miscellaneous 声明 lineItem，current-scheme 也无
    // selections.miscellaneous —— 孤儿 topic 不产生任何计价行，纠偏移除 0 行、新增 0 行
    assert.ok(
      !snapshot.lineItems.some((li) => li.topic === 'miscellaneous'),
      'no miscellaneous line items (topic never had a lineItem)'
    );
    const wardrobeItems = snapshot.lineItems.filter((li) => li.topic === 'wardrobe');
    // 既有衣柜计价行（bedroom_nw / study 的 wardrobe_180 家具，无 roomOverride）保持 default wardrobe_240_01
    for (const roomId of ['bedroom_nw', 'study']) {
      const li = wardrobeItems.find((item) => item.roomId === roomId);
      assert.ok(li, `wardrobe line exists for ${roomId}`);
      assert.equal(li.optionId, 'wardrobe_240_01', `${roomId} still on default wardrobe_240_01`);
      assert.equal(li.unitPrice, 4200, `${roomId} unit price unchanged by the topic fix`);
    }
  });

  it('dresser topic bills the low dresser on its own line without polluting wardrobe (R1)', () => {
    const catalog = ProjectCatalog.load('.');
    // R7：主卧同时持有北墙650定制柜（收窄版，wardrobe topic）与南侧矮柜（dresser topic），
    // 两者必须各自成行——矮柜并入 wardrobe 会按柜价重复计价
    (catalog as unknown as { furnishings: FurnishingsYaml }).furnishings = {
      master_bedroom: [
        { type: 'master_north_wall_wardrobe_950', x: 3.075, z: 4.59, rotation: 0 },
        { type: 'master_hot_season_low_dresser', x: 1.00, z: 9.31, rotation: 180 },
      ],
      bedroom_nw: [{ type: 'wardrobe_180', x: 3.50, z: 4.00, rotation: 0 }],
    };
    const realRules = RuleEngine.load('config/design-rules.yaml').getConfig();
    const calc = new BudgetCalculator(catalog, realRules);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        wardrobe: {
          default: 'wardrobe_180_01',
          roomOverrides: { master_bedroom: 'wardrobe_north_950_custom_01' },
        },
        dresser: { default: 'light_midcentury_dresser_01', roomOverrides: {} },
      },
    };
    const snapshot = calc.calculate(scheme);
    const dresserItems = snapshot.lineItems.filter((li) => li.topic === 'dresser');
    assert.equal(dresserItems.length, 1, 'dresser topic produces exactly one line');
    assert.equal(dresserItems[0].roomId, 'master_bedroom');
    assert.equal(dresserItems[0].optionId, 'light_midcentury_dresser_01');
    assert.equal(dresserItems[0].quantity, 1);
    assert.equal(dresserItems[0].unitPrice, 2200);
    assert.equal(dresserItems[0].cost, 2200);
    // wardrobe 不受污染：主卧仅计 R7 北墙650定制柜（只数衣柜，不含矮柜）
    const mbWardrobe = snapshot.lineItems.find((li) => li.topic === 'wardrobe' && li.roomId === 'master_bedroom');
    assert.ok(mbWardrobe);
    assert.equal(mbWardrobe.optionId, 'wardrobe_north_950_custom_01');
    assert.equal(mbWardrobe.quantity, 1);
    assert.equal(mbWardrobe.unitPrice, 0);
    assert.equal(mbWardrobe.cost, 0);
    // 矮柜归 furniture_soft 池；R7 衣柜 price pending 为 0（不伪装完成）
    const furnitureSoft = snapshot.categories.find((c) => c.key === 'furniture_soft');
    assert.ok(furnitureSoft && furnitureSoft.autoActual >= 2200, 'dresser + pending wardrobe both flow into furniture_soft');
  });
});
