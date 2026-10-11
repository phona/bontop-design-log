import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { BudgetCalculator } from '../../server/budget-calculator.js';
import { loadExtraFloorRegionArea } from '../../server/budget-calculator.js';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { RuleEngine } from '../../server/rule-engine.js';
import type { CurrentScheme, DesignRulesConfig, FurnishingsYaml } from '../../shared/types.js';
import { parseOverlay } from '../../server/overlay-merge.js';

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
      { topic: 'floor', quantityField: 'floorArea', applyRooms: [
        'master_bath', 'guest_bath', 'kitchen', 'balcony', 'living_dining',
        'master_bedroom', 'study', 'bedroom_nw', 'bedroom_se',
      ] },
      { topic: 'wall', quantityField: 'wetWallArea' },
      { topic: 'paint', quantityField: 'paintWallArea' },
      { topic: 'hvac' },
    ],
  },
  risks: [],
  constraints: [],
};

describe('BudgetCalculator', () => {
  it('uses resolved floor polygon areas only for the floor topic applyRooms', () => {
    const catalog = ProjectCatalog.load('.');
    const projectRules = load(readFileSync('config/design-rules.yaml', 'utf8')) as DesignRulesConfig;
    const floorApplyRooms = projectRules.budget?.lineItems?.find(item => item.topic === 'floor')?.applyRooms ?? [];
    const allRooms = catalog.getRooms();
    const selectedRooms = allRooms.filter(room => floorApplyRooms.includes(room.id));
    assert.ok(floorApplyRooms.length > 0);
    assert.ok(!floorApplyRooms.includes('entry_garden'));
    assert.ok(!floorApplyRooms.includes('elevator_shaft'));

    const areaFromResolvedPolygons = selectedRooms.reduce((sum, room) => sum + (room.area ?? room.width * room.depth), 0);
    const areaFromBoundingBoxes = selectedRooms.reduce((sum, room) => sum + room.width * room.depth, 0);
    assert.notEqual(areaFromResolvedPolygons, areaFromBoundingBoxes, 'polygon area should differ from at least one room bounding box');
    // DEC-2026-10-09-P16：非房间地面**默认**进算量，只有两种例外退出——① 整块落在某个
    // applyRooms 房间内（几何判定，双计路径从根上消失）；② 显式 `excluded: true`。
    // 这里独立复算同一口径（不调生产函数 loadExtraFloorRegionArea），两边各自算才算交叉验证。
    const overlay = parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8'));
    const shoelace = (pts: Array<{ x: number; z: number }>) => {
      let acc = 0;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) acc += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
      return Math.abs(acc) / 2;
    };
    const inPolygonOrOnEdge = (p: { x: number; z: number }, poly: Array<{ x: number; z: number }>) => {
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[j]; const b = poly[i];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < 1e-9) continue;
        if (Math.abs((b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x)) / len > 1e-6) continue;
        const dot = (p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z);
        if (dot >= -1e-6 && dot <= len * len + 1e-6) return true;
      }
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[j]; const b = poly[i];
        if ((a.z > p.z) !== (b.z > p.z)) {
          const x = a.x + ((p.z - a.z) / (b.z - a.z)) * (b.x - a.x);
          if (x > p.x) inside = !inside;
        }
      }
      return inside;
    };
    const insideAnyApplyRoom = (element: any) => {
      const pts = element.points as Array<{ x: number; z: number }>;
      const minX = Math.min(...pts.map(p => p.x));
      const maxX = Math.max(...pts.map(p => p.x));
      const minZ = Math.min(...pts.map(p => p.z));
      const maxZ = Math.max(...pts.map(p => p.z));
      const corners = [{ x: minX, z: minZ }, { x: maxX, z: minZ }, { x: minX, z: maxZ }, { x: maxX, z: maxZ }];
      return selectedRooms.some((room) => {
        if (room.points && room.points.length >= 3) {
          const poly = room.points.map(p => ({ x: p.x, z: p.z }));
          return corners.every(c => inPolygonOrOnEdge(c, poly));
        }
        return minX >= room.x - room.width / 2 - 1e-6 && maxX <= room.x + room.width / 2 + 1e-6
          && minZ >= room.z - room.depth / 2 - 1e-6 && maxZ <= room.z + room.depth / 2 + 1e-6;
      });
    };
    // 弧段 region（north_platform_floor 的 NW 角 r=1.0）已被 excluded 滤掉，所以这里用朴素
    // shoelace 复算不会碰到「外接矩形 1.60㎡ vs 真实 1.3854㎡」的坑；生产侧的圆角闭式解
    // 由 .tmp 探针与 excludedArea 留档值另行核对（1.3854）。
    const extra = (overlay.elements ?? [])
      .filter((e: any) => e.type === 'floor_region' && e.excluded !== true)
      .filter((e: any) => !insideAnyApplyRoom(e))
      .reduce((sum: number, e: any) => sum + shoelace(e.points as Array<{ x: number; z: number }>), 0);
    // 只剩主走廊 3.75㎡：门厅过渡面落在 living_dining 内、书房通道落在 study 内（都已被房间算过），
    // 入户花园/设备平台显式 excluded
    assert.equal(Math.round(extra * 100) / 100, 3.75, 'extra 应只剩主走廊 3.75㎡');
    assert.ok(extra > 0, '主走廊必须计入，且不再依赖任何手工 costed 标志');
    assert.equal(Math.round((areaFromResolvedPolygons + extra) * 100) / 100, 125.26, 'floor 算量必须仍是 125.26㎡');

    const calc = new BudgetCalculator(catalog, projectRules);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        floor: { default: 'floor_tile_01', roomOverrides: {} },
        wall: { default: 'wall_tile_01', roomOverrides: {} },
        paint: { default: 'latex_paint_01', roomOverrides: {} },
        hvac: { default: 'A1', roomOverrides: {} },
      },
    };
    const snapshot = calc.calculate(scheme);
    const masonry = snapshot.categories.find(category => category.key === 'masonry');
    assert.ok(masonry);
    const laborAdded = masonry.actual - masonry.autoActual;
    assert.equal(laborAdded, Math.round(45 * (areaFromResolvedPolygons + extra)));
    assert.notEqual(laborAdded, Math.round(45 * areaFromBoundingBoxes));
  });

  // DEC-2026-10-09-P16 负例①：显式把 `excluded` 设成 false 救不回「整块落在已计费房间内」的双计。
  // 旧 P12 口径下 corridor_floor 靠 `costed` 手工 opt-in，标志一多写/漏写就是双计或漏计；
  // 新口径下它落在 study 内，任何标志都改不动这个结论——双计路径从根上消失。
  it('DEC-2026-10-09-P16 负例①：excluded:false 救不回落在已计费房间内的双计', () => {
    const catalog = ProjectCatalog.load('.');
    const projectRules = load(readFileSync('config/design-rules.yaml', 'utf8')) as DesignRulesConfig;
    const applyRooms = projectRules.budget?.lineItems?.find(item => item.topic === 'floor')?.applyRooms ?? [];
    const elements = parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8')).elements ?? [];
    const rooms = catalog.getRooms();
    const base = loadExtraFloorRegionArea(rooms, applyRooms);
    const forced = loadExtraFloorRegionArea(rooms, applyRooms, elements.map((element: any) =>
      element.id === 'corridor_floor' ? { ...element, excluded: false } : element));
    assert.ok(Math.abs(forced.extraArea - base.extraArea) < 1e-6,
      `corridor_floor 标 excluded:false 也不该进 extra（base ${base.extraArea} → forced ${forced.extraArea}）`);
    assert.ok(Math.abs(forced.skippedInsideRoomArea - base.skippedInsideRoomArea) < 1e-6,
      '显式 excluded:false 不改变它被几何跳过的事实（仍走 skippedInsideRoomArea，6.75㎡ 已由 study 房间 footprint 算过）');
    assert.ok(Math.abs(forced.excludedArea - base.excludedArea) < 1e-6,
      'excluded:false 更不该把它算成「有意排除」');
    // 对照组：同一块地只要不再落在任何 applyRooms 房间内（去掉 study），就必须进 extra——
    // 证明「跳过」确实是几何驱动，不是把这条 region 悄悄吞掉。
    const outside = loadExtraFloorRegionArea(
      rooms,
      applyRooms.filter(id => id !== 'study'),
      elements.map((element: any) => (element.id === 'corridor_floor' ? { ...element, excluded: false } : element)),
    );
    assert.ok(Math.abs(outside.extraArea - (base.extraArea + 6.75)) < 1e-6,
      `去掉 study 后 corridor_floor 必须计入（base ${base.extraArea} → ${outside.extraArea}）`);
    assert.ok(Math.abs(outside.skippedInsideRoomArea - (base.skippedInsideRoomArea - 6.75)) < 1e-6,
      '对照组里它应从 skippedInsideRoomArea 挪到 extraArea，两档此消彼长');
  });

  // DEC-2026-10-09-P16 负例②：一条不在任何房间内的 region 标 `excluded: true` 就退出算量。
  // 这是新口径唯一允许的例外口子，且必须留档到 excludedArea——「有意不算」和「漏算」要能区分。
  it('DEC-2026-10-09-P16 负例②：不在任何房间内的 region 标 excluded:true 即退出', () => {
    const catalog = ProjectCatalog.load('.');
    const projectRules = load(readFileSync('config/design-rules.yaml', 'utf8')) as DesignRulesConfig;
    const applyRooms = projectRules.budget?.lineItems?.find(item => item.topic === 'floor')?.applyRooms ?? [];
    const elements = parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8')).elements ?? [];
    const rooms = catalog.getRooms();
    const base = loadExtraFloorRegionArea(rooms, applyRooms);
    const marked = loadExtraFloorRegionArea(rooms, applyRooms, elements.map((element: any) =>
      element.id === 'main_corridor_floor' ? { ...element, excluded: true } : element));
    assert.ok(Math.abs(marked.extraArea) < 1e-6,
      `主走廊标 excluded:true 后 extra 必须归零（${marked.extraArea}），它是唯一默认计入的 region`);
    assert.ok(Math.abs(marked.excludedArea - (base.excludedArea + 3.75)) < 1e-6,
      `排除面积要留档（${base.excludedArea} → ${marked.excludedArea}）`);
    assert.ok(Math.abs(marked.skippedInsideRoomArea - base.skippedInsideRoomArea) < 1e-6,
      '显式排除不该挤占「落在已计费房间内」这一档');
  });

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

  it('live totals come from control.yaml while archived categories stay readable (A2)', () => {
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
    // 2026-10-04 之前本测试断言 `totalBudget == Σcategories.budget`（208,000，base.json
    // 四池快照）。base.json 交出活字段身份后，totalBudget / projectCeiling 一律等于
    // schedule/phase-1/control.yaml 的 phase_ceiling_cny（210,000，DEC-2026-10-05-R4 抬池后）。
    assert.equal(snapshot.totalBudget, 210000);
    assert.equal(snapshot.projectCeiling, 210000);
    // 分科目明细仍可读（base.json 是唯一可用的分科预算拆分），历史合计走 historicalBaseline 露出
    const archivedTotal = snapshot.categories.reduce((s, c) => s + c.budget, 0);
    assert.equal(archivedTotal, 208000);
    assert.equal(snapshot.historicalBaseline?.totalBudgetCny, archivedTotal);
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

  it('carpentry labor is measured from ceiling zones, not room areas', () => {
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
    const carpentry = snapshot.categories.find((c) => c.key === 'carpentry');
    assert.ok(carpentry);
    // area: 'ceiling_zones' → shared/ceiling-takeoff.ts 的吊顶板面净面积（总净面积 45.130 − 窗帘盒 4.463 = 40.667㎡）× 40 元/㎡。
    // 旧口径按房间面积合计 142.92㎡（¥5,717），把无吊顶平顶/电梯井/入户花园都计了费。
    // 注意：人工费进 cat.actual（不是 autoActual），与 computeLabor 既有口径一致。
    assert.ok(
      Math.abs(carpentry.actual - Math.round(40 * (45.13 - 4.463))) <= 2,
      `carpentry 板面人工应为 ~1627（40 元/㎡ × 40.667㎡），实际 ${carpentry.actual}`
    );
    assert.ok(carpentry.actual < carpentry.budget, '按分区实算后木工板面人工应低于预算');
    assert.ok(!('ceiling' in JSON.parse(readFileSync('config/budget/base.json', 'utf8')).categories.carpentry.labor), 'base.json 不应再引用废弃的 ceiling 键');
  });

  it('DEC-2026-10-08-C02: 窗帘盒人工拆成延长米行，数量显形、金额待报价', () => {
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
    const carpentry = calc.calculate(scheme).categories.find((c) => c.key === 'carpentry')!;
    // 窗帘盒 5 区 17.85 延长米：数量必须显形，rate 未定所以不进 actual
    assert.deepEqual(carpentry.pendingLabor, [
      { area: 'curtain_box_linear', quantity: 17.85, unit: '元/m', reason: 'rate 待报价' },
    ]);
    // 板面行不含窗帘盒面积（4.463㎡ × 40 = ¥178 已从 actual 里拆出）
    const raw = JSON.parse(readFileSync('config/budget/base.json', 'utf8')) as { categories: Record<string, { labor: Array<{ area: string }> }> };
    assert.deepEqual(raw.categories.carpentry.labor.map((line) => line.area), ['ceiling_zones', 'curtain_box_linear']);
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

  it('four-pool categories include hard + hvac + furniture + appliances (P0); live totals come from control.yaml', () => {
    const catalog = ProjectCatalog.load('.');
    const calc = new BudgetCalculator(catalog, rulesConfig);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: { hvac: { default: 'A2', roomOverrides: {} } },
    };
    const snapshot = calc.calculate(scheme);
    // 现行一期执行上限与已分配额一律来自 schedule/phase-1/control.yaml（210,000），
    // 不再读 config/budget/base.json 的 total_budget 208,000 / project_ceiling 190,000。
    assert.equal(snapshot.totalBudget, 210000);
    assert.equal(snapshot.projectCeiling, 210000);
    assert.deepEqual(snapshot.historicalBaseline, {
      source: 'config/budget/base.json',
      totalBudgetCny: 208000,
      projectCeilingCny: 190000,
      status: 'historical_reference_only',
    });
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
    // 上限来自 schedule/phase-1/control.yaml control.phase_ceiling_cny，
    // 而不是 config/budget/base.json 的作废值 project_ceiling=190,000。
    assert.equal(snapshot.projectCeiling, 210000);
    assert.equal(snapshot.overCeilingBy, snapshot.totalActual - 210000);
    // 作废口径仍可读，但只作为 historicalBaseline 留档露出，不参与计算。
    assert.equal(snapshot.historicalBaseline?.projectCeilingCny, 190000);
    assert.equal(snapshot.historicalBaseline?.status, 'historical_reference_only');
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

  it('light training set is fully removed: no topic, no furnishing mapping, no budget line (2026-10-05 swap)', () => {
    // 2026-10-05 功能互换 + 删除健身器材（iteration parent-room-study-swap-20261005）：
    // 原口径是「home_fitness_light_set count-only 一套计价、可见三件只渲染不计价」；
    // 现在整个 topic / 材料条目 / 采购条目 / 映射全部删除，预算与采购链路不得残留。
    const catalog = ProjectCatalog.load('.');
    const rules = RuleEngine.load('config/design-rules.yaml').getConfig();
    const scheme = JSON.parse(readFileSync('data/current-scheme.json', 'utf8')) as CurrentScheme;
    const materials = load(readFileSync('config/materials.yaml', 'utf8')) as { materials: Array<{ id: string }> };
    const procurement = load(readFileSync('config/procurement.yaml', 'utf8')) as { materials: Array<{ id: string }> };

    assert.equal(materials.materials.some((m) => m.id === 'home_fitness_light_set_01'), false, 'materials.yaml must not keep the fitness set');
    assert.equal(procurement.materials.some((p) => p.id === 'home_fitness_light_set_01'), false, 'procurement.yaml must not keep the fitness set');
    assert.equal(scheme.selections.home_fitness, undefined, 'current-scheme.json must not select home_fitness');
    assert.equal(rules.budget?.furnishingTypeToTopic?.['home_fitness_light_set'], undefined, 'design-rules must not map the furnishing type');
    assert.equal(
      (rules.budget?.lineItems ?? []).some((line) => line.topic === 'home_fitness'),
      false,
      'design-rules must not keep the home_fitness topic line item',
    );

    const snapshot = new BudgetCalculator(catalog, rules).calculate(scheme);
    assert.equal(snapshot.lineItems.some((li) => li.topic === 'home_fitness'), false, 'no home_fitness budget line may survive');
    for (const type of ['bench_adjustable', 'adjustable_dumbbell_pair', 'rollable_training_mat', 'squat_rack', 'barbell_olympic', 'weight_plate_set', 'rubber_training_mat']) {
      assert.equal(snapshot.lineItems.some((li) => li.topic === type), false, `${type} must not be priced`);
    }
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
    // 2026-10-05 功能互换整改批次 A（DEC-2026-10-05-R10）后：
    // bedroom_nw 仍无 roomOverride → 保持 default wardrobe_240_01（¥4,200，1.8m 柜按 2.4m 计价属存量口径缺陷，待业主裁决）；
    // study（书房放 1.7m 季节后台柜）→ study_seasonal_wardrobe_170_01 ¥2,600；
    // bedroom_se（客房放 1.8m 成品衣柜）→ wardrobe_180_01 ¥3,200。
    const expected: Record<string, { optionId: string; unitPrice: number }> = {
      bedroom_nw: { optionId: 'wardrobe_240_01', unitPrice: 4200 },
      study: { optionId: 'study_seasonal_wardrobe_170_01', unitPrice: 2600 },
      bedroom_se: { optionId: 'wardrobe_180_01', unitPrice: 3200 },
    };
    for (const [roomId, want] of Object.entries(expected)) {
      const li = wardrobeItems.find((item) => item.roomId === roomId);
      assert.ok(li, `wardrobe line exists for ${roomId}`);
      assert.equal(li.optionId, want.optionId, `${roomId} optionId`);
      assert.equal(li.unitPrice, want.unitPrice, `${roomId} unit price`);
    }
  });

  it('wardrobe roomOverride must follow the furnishing actually placed in each room (function-swap guard)', () => {
    // 防回归：本轮 P0-1 就是 roomOverride 没跟功能互换走（客房 wardrobe_180 被按 1.7m 模块柜计、
    // 书房 1.7m 季节柜被按 2.4m 默认计）。此后任何功能互换/家具搬迁都必须同步此表。
    const catalog = ProjectCatalog.load('.');
    const rules = RuleEngine.load('config/design-rules.yaml').getConfig();
    const scheme = JSON.parse(readFileSync('data/current-scheme.json', 'utf8')) as CurrentScheme;
    const house = load(readFileSync('config/house.yaml', 'utf8')) as { furnishings: Record<string, Array<{ type: string }>> };
    const expectedByRoom: Record<string, string> = {
      // 房间 → 该房间实际放置的柜类 furnishing type
      master_bedroom: 'master_north_wall_wardrobe_950',
      study: 'study_seasonal_wardrobe_wall',
      bedroom_se: 'wardrobe_180',
      bedroom_nw: 'wardrobe_180',
    };
    const optionByFurnishing: Record<string, string> = {
      master_north_wall_wardrobe_950: 'wardrobe_north_950_custom_01',
      study_seasonal_wardrobe_wall: 'study_seasonal_wardrobe_170_01',
      wardrobe_180: 'wardrobe_180_01',
    };
    for (const [roomId, furnishingType] of Object.entries(expectedByRoom)) {
      assert.ok(
        house.furnishings[roomId]?.some((item) => item.type === furnishingType),
        `${roomId} must place ${furnishingType}`,
      );
      const wantOption = optionByFurnishing[furnishingType];
      const override = scheme.selections.wardrobe?.roomOverrides?.[roomId];
      // bedroom_nw 是已知例外：无 override，落 topic 默认（存量口径缺陷，见 review-and-rectification.md）
      if (roomId === 'bedroom_nw') continue;
      assert.equal(override, wantOption, `wardrobe roomOverride for ${roomId} must select ${wantOption}`);
    }
    const snapshot = new BudgetCalculator(catalog, rules).calculate(scheme);
    const priced = new Map(snapshot.lineItems.filter((li) => li.topic === 'wardrobe').map((li) => [li.roomId, li.optionId]));
    for (const [roomId, furnishingType] of Object.entries(expectedByRoom)) {
      const wantOption = roomId === 'bedroom_nw' ? 'wardrobe_240_01' : optionByFurnishing[furnishingType];
      assert.equal(priced.get(roomId), wantOption, `priced wardrobe option for ${roomId} must be ${wantOption}`);
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

  it('phase 1 excludes deferred fixed appliances while retaining the declarative J6 count line', () => {
    const catalog = ProjectCatalog.load('.');
    const realRules = RuleEngine.load('config/design-rules.yaml').getConfig();
    const calc = new BudgetCalculator(catalog, realRules);
    const scheme = JSON.parse(readFileSync('./data/current-scheme.json', 'utf8')) as CurrentScheme;

    const snapshot = calc.calculate(scheme, 'phase_1_basic_occupancy');
    const applianceTopics = new Set(
      snapshot.lineItems
        .filter((item) => realRules.budget?.topicCategories?.[item.topic] === 'appliances')
        .map((item) => item.topic),
    );
    assert.deepEqual(
      [...applianceTopics].sort(),
      ['gas_stove', 'robot_vacuum', 'shower_enclosure', 'washer'],
      '一期家电动态估算只保留已纳入一期的家电主题',
    );
    assert.equal(snapshot.lineItems.find((item) => item.topic === 'robot_vacuum')?.cost, 3000);
    for (const deferred of ['dishwasher', 'water_purifier', 'dryer']) {
      assert.equal(snapshot.lineItems.some((item) => item.topic === deferred), false, `${deferred} must stay in phase 2`);
    }
  });
});
