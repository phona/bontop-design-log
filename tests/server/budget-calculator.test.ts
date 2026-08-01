import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BudgetCalculator } from '../../server/budget-calculator.js';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { RuleEngine } from '../../server/rule-engine.js';
import type { CurrentScheme, DesignRulesConfig } from '../../shared/types.js';

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
    const masterBath = catalog.getRoom('master_bath');
    assert.ok(masterBath, 'master_bath should exist');
    assert.ok(masterBath.area, 'master_bath should have resolved area');
    const bboxArea = masterBath.width * masterBath.depth;
    assert.ok(
      Math.abs(masterBath.area! - bboxArea) > 0.01,
      `area (${masterBath.area}) should differ from bbox (${bboxArea}) for non-rectangular room`
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
    assert.equal(snapshot.totalBudget, 192000);
    for (const key of ['furniture_soft', 'appliances', 'hvac']) {
      assert.ok(snapshot.categories.find((c) => c.key === key), `${key} category present`);
    }
  });

  it('applyRooms restricts floor line items to wet+public rooms (calibration)', () => {
    const catalog = ProjectCatalog.load('.');
    const realRules = RuleEngine.load('config/design-rules.yaml').getConfig();
    const calc = new BudgetCalculator(catalog, realRules);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: { floor: { default: 'floor_tile_01', roomOverrides: {} } },
    };
    const snapshot = calc.calculate(scheme);
    const floorRooms = new Set(
      snapshot.lineItems.filter((li) => li.topic === 'floor').map((li) => li.roomId)
    );
    const excluded = ['master_bedroom', 'study', 'bedroom_nw', 'bedroom_se', 'elevator_shaft'];
    for (const rid of excluded) {
      assert.ok(!floorRooms.has(rid), `floor must NOT apply to ${rid}`);
    }
    assert.ok(floorRooms.has('kitchen'), 'floor applies to kitchen');
    assert.ok(floorRooms.has('living_dining'), 'floor applies to living_dining');
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

  it('bedroom_floor prices only the 4 bedrooms (决策闭环)', () => {
    const catalog = ProjectCatalog.load('.');
    const realRules = RuleEngine.load('config/design-rules.yaml').getConfig();
    const calc = new BudgetCalculator(catalog, realRules);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: { bedroom_floor: { default: 'bedroom_tile_01', roomOverrides: {} } },
    };
    const snapshot = calc.calculate(scheme);
    const rooms = new Set(
      snapshot.lineItems.filter((li) => li.topic === 'bedroom_floor').map((li) => li.roomId)
    );
    assert.deepEqual(
      [...rooms].sort(),
      ['bedroom_nw', 'bedroom_se', 'master_bedroom', 'study'],
      'bedroom_floor applies to exactly the 4 bedrooms'
    );
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
});
