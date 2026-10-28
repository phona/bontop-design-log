import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { BudgetCalculator, autoActualBucket, loadMasonryTakeoff, loadPaintScopeAreaByRoom } from '../../server/budget-calculator.js';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { loadPaintScopeInputs } from '../../server/paint-cost-comparison.js';
import { RuleEngine } from '../../server/rule-engine.js';
import type { CurrentScheme, DesignOption, DesignRulesConfig, FurnishingsYaml } from '../../shared/types.js';
import { parseOverlay } from '../../server/overlay-merge.js';

/**
 * 阶段 5 口径下的 labor 反推：actual − 已取证材料款 − 人工录入。
 * 用于断言「actual 不含 candidateActual」这个不变量，避免在 fixture 里写死金额。
 */
function laborOf(cat: { actual: number; verifiedActual?: number; candidateActual?: number; manualActual?: number }): number {
  return cat.actual - (cat.verifiedActual ?? 0) - (cat.manualActual ?? 0);
}

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
      { topic: 'wall', quantityField: 'masonryTileArea' },
      { topic: 'paint', quantityField: 'paintWallArea' },
      { topic: 'hvac' },
    ],
  },
  risks: [],
  constraints: [],
};

describe('BudgetCalculator', () => {
  it('keeps a ceiling-only paint selection in the budget area map', () => {
    const baseCatalog = ProjectCatalog.load('.');
    const catalog = Object.create(baseCatalog) as ProjectCatalog;
    catalog.getRooms = () => baseCatalog.getRooms().map((room) => ({ ...room, wall_finish: 'unpainted' }));
    const inputs = loadPaintScopeInputs();

    const ceilingOnly = loadPaintScopeAreaByRoom(catalog, {
      ...inputs,
      regions: [],
      sillRegions: [],
    });

    assert.equal(ceilingOnly.get('main_corridor'), 3.75);
    assert.ok(Math.abs([...ceilingOnly.values()].reduce((sum, area) => sum + area, 0) - 111.297) < 0.01); // 2026-10-25 DEC-2026-10-25-R01 重算：客餐厅 +1.725、东南房 +2.19 后 107.382→111.297
  });

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
    // 这里独立复算同一口径（不调生产函数 loadMasonryTakeoff），两边各自算才算交叉验证。
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

    // DEC-2026-10-13 阶段 2 第二半：floor 算量的唯一出口是 shared/masonry-takeoff.ts。
    // 独立复算（上面的 shoelace + 几何包含）与生产实现必须给出同一个 extra，否则就是两套口径。
    const takeoff = loadMasonryTakeoff(catalog);
    assert.ok(Math.abs(takeoff.floorRegionExtraSqm - extra) < 1e-6,
      `生产 takeoff 的 floorRegionExtraSqm ${takeoff.floorRegionExtraSqm} 必须等于独立复算 ${extra}`);

    // 新口径：room base dry 116.1874 + wet 7.936 + floor_region extra 3.75 = 127.8734㎡（2026-10-25 DEC-2026-10-25-R01 重算：客餐厅 +1.725、东南房 +2.19 干，原 112.2724 / 7.936 / 120.2084）；
    // 内部开放洗漱区1.125㎡只从湿区转入干区，不改变总面积。
    // 与旧口径 125.26㎡ 的差是**生活阳台 1.92㎡**：它既不在 dry_room_ids 也不在 wet_room_ids
    // （control.yaml 记其「湿区小砖、按间包干口径未裁」），因此不再默认计费，转进
    // `pendingQuantity` 显形——「不计费」必须看得见，否则就是静默归零。
    const floorQuantity = takeoff.dryFloorSqm + takeoff.wetFloorSqm;
    assert.equal(Math.round(floorQuantity * 100) / 100, 127.87, 'floor 算量 = 干区 121.0624 + 湿区 6.811（R01 重算）');
    assert.ok(Math.abs(floorQuantity - (129.7934 - 1.92)) < 1e-6,
      `新口径必须恰好比旧口径少生活阳台 1.92㎡（${floorQuantity} vs 129.7934；旧口径随 R01 重算几何 +3.915 由 125.8784 增至 129.7934）`);
    assert.ok(takeoff.unpriced.some(item => item.id === 'balcony' && Math.abs((item.quantity ?? 0) - 1.92) < 1e-6),
      '生活阳台地面必须进 unpriced 显形清单');

    // 房间集对账：干/湿区清单里的每一间都必须在 floor 的 applyRooms 内。
    // applyRooms 现在是「二次闸门」而不是数量来源；若某间铺地房被它漏掉，墙砖/地砖会静默消失。
    const floorRoomIds = new Set([
      ...(load(readFileSync('config/tile-comparison.yaml', 'utf8')) as { dry_room_ids: string[]; wet_room_ids: string[] }).dry_room_ids,
      ...(load(readFileSync('config/tile-comparison.yaml', 'utf8')) as { dry_room_ids: string[]; wet_room_ids: string[] }).wet_room_ids,
    ]);
    for (const roomId of floorRoomIds) {
      assert.ok(floorApplyRooms.includes(roomId), `干/湿区房 ${roomId} 必须在 floor.applyRooms 内，否则静默漏计`);
    }

    const calc = new BudgetCalculator(catalog, projectRules);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        floor: { default: 'floor_tile_01', roomOverrides: {} },
        wall: { default: 'wall_tile_01', roomOverrides: {} },
        paint: { default: 'latex_paint_01', roomOverrides: {} },
        hvac: { default: 'A2', roomOverrides: {} },
      },
    };
    const snapshot = calc.calculate(scheme);
    const masonry = snapshot.categories.find(category => category.key === 'masonry');
    assert.ok(masonry);
    // 阶段 5 口径变更：actual 不再含 candidateActual，所以 laborAdded 不能再用
    // `actual - autoActual` 算（那会是负数）。本 fixture 材料款全未取证 →
    // actual 就是纯人工，直接用 actual。
    const laborAdded = masonry.actual;
    // 阶段 3：瓦工人工按三个 area 分别计价，单价来自 config/masonry-labor.yaml 的费率卡
    // （按本方案的选型规格取行），量来自 shared/masonry-takeoff.ts：
    //   floor           干区地面（本方案选 floor_tile_01 = 800×800 → 卡上 40 元/㎡）
    //   wet_floor_tile  湿区地面（同一选型 → 40 元/㎡）
    //   wall_tile       墙砖+防水台（wall_tile_01 = 300×600 → 卡上 50 元/㎡）
    const masonryTakeoff = loadMasonryTakeoff(catalog);
    const expectedLabor = Math.round(40 * masonryTakeoff.dryFloorSqm)
      + Math.round(40 * masonryTakeoff.wetFloorSqm)
      + Math.round(50 * masonryTakeoff.totalTileSqm);
    assert.equal(laborAdded, expectedLabor,
      `瓦工人工必须按费率卡解析价 × takeoff 量逐行计价（实际 ${laborAdded}）`);
    assert.notEqual(laborAdded, Math.round(45 * areaFromBoundingBoxes));
    // ±658 双轨的根治判据：材料侧逐行数量之和必须**等于**人工侧的算量。
    // 旧口径材料侧只加 applyRooms 房间（121.510㎡）、人工侧另加 extra（125.260㎡），
    // 差 3.75㎡ 正是主走廊——DEC-2026-10-09-P16 裁定「走廊需要铺砖」，结果人工收了钱、主材没收。
    const floorLineQuantity = snapshot.lineItems
      .filter(item => item.topic === 'floor')
      .reduce((sum, item) => sum + item.quantity, 0);
    assert.ok(Math.abs(floorLineQuantity - floorQuantity) < 1e-6,
      `材料侧 floor 数量 ${floorLineQuantity} 必须等于人工侧算量 ${floorQuantity}（含主走廊 extra 单列的 roomId:null 行）`);
    assert.ok(snapshot.lineItems.some(item => item.topic === 'floor' && item.roomId === null),
      '主走廊 extra 必须单列一行 roomId:null，不摊进任何房间、也不静默丢弃');
  });

  // DEC-2026-10-09-P16 负例①：显式把 `excluded` 设成 false 救不回「整块落在已计费房间内」的双计。
  // 旧 P12 口径下 corridor_floor 靠 `costed` 手工 opt-in，标志一多写/漏写就是双计或漏计；
  // 新口径下它落在 study 内，任何标志都改不动这个结论——双计路径从根上消失。
  // 2026-10-13 阶段 2 第二半：入口从 loadExtraFloorRegionArea 换成 loadMasonryTakeoff
  // （shared/masonry-takeoff.ts 是地面算量唯一实现），缝仍是「注入 elements」。
  it('DEC-2026-10-09-P16 负例①：excluded:false 救不回落在已计费房间内的双计', () => {
    const catalog = ProjectCatalog.load('.');
    const elements = parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8')).elements ?? [];
    const base = loadMasonryTakeoff(catalog);
    const forced = loadMasonryTakeoff(catalog, elements.map((element: any) =>
      element.id === 'corridor_floor' ? { ...element, excluded: false } : element));
    assert.ok(Math.abs(forced.floorRegionExtraSqm - base.floorRegionExtraSqm) < 1e-6,
      `corridor_floor 标 excluded:false 也不该进 extra（base ${base.floorRegionExtraSqm} → forced ${forced.floorRegionExtraSqm}）`);
    assert.ok(Math.abs(forced.floorRegionSkippedInsideRoomSqm - base.floorRegionSkippedInsideRoomSqm) < 1e-6,
      '显式 excluded:false 不改变它被几何跳过的事实（仍走 skippedInsideRoom，6.75㎡ 已由 study 房间 footprint 算过）');
    assert.ok(Math.abs(forced.floorRegionExcludedSqm - base.floorRegionExcludedSqm) < 1e-6,
      'excluded:false 更不该把它算成「有意排除」');
    // 对照组：同一块地只要不再落在任何已计费房间内（把轮廓整体搬出户型），就必须进 extra——
    // 证明「跳过」确实是几何驱动，不是把这条 region 悄悄吞掉。
    const moved = loadMasonryTakeoff(catalog, elements.map((element: any) => (element.id === 'corridor_floor'
      ? { ...element, excluded: false, points: (element.points as Array<{ x: number; z: number }>).map((p) => ({ ...p, x: p.x + 50, z: p.z + 50 })) }
      : element)));
    assert.ok(Math.abs(moved.floorRegionExtraSqm - (base.floorRegionExtraSqm + 6.75)) < 1e-6,
      `搬出户型后 corridor_floor 必须计入（base ${base.floorRegionExtraSqm} → ${moved.floorRegionExtraSqm}）`);
    assert.ok(Math.abs(moved.floorRegionSkippedInsideRoomSqm - (base.floorRegionSkippedInsideRoomSqm - 6.75)) < 1e-6,
      '对照组里它应从 skippedInsideRoom 挪到 extra，两档此消彼长');
  });

  // DEC-2026-10-09-P16 负例②：一条不在任何房间内的 region 标 `excluded: true` 就退出算量。
  // 这是新口径唯一允许的例外口子，且必须留档到 excludedSqm——「有意不算」和「漏算」要能区分。
  it('DEC-2026-10-09-P16 负例②：不在任何房间内的 region 标 excluded:true 即退出', () => {
    const catalog = ProjectCatalog.load('.');
    const elements = parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8')).elements ?? [];
    const base = loadMasonryTakeoff(catalog);
    const marked = loadMasonryTakeoff(catalog, elements.map((element: any) =>
      element.id === 'main_corridor_floor' ? { ...element, excluded: true } : element));
    assert.ok(Math.abs(marked.floorRegionExtraSqm) < 1e-6,
      `主走廊标 excluded:true 后 extra 必须归零（${marked.floorRegionExtraSqm}），它是唯一默认计入的 region`);
    assert.ok(Math.abs(marked.floorRegionExcludedSqm - (base.floorRegionExcludedSqm + 3.75)) < 1e-6,
      `排除面积要留档（${base.floorRegionExcludedSqm} → ${marked.floorRegionExcludedSqm}）`);
    assert.ok(Math.abs(marked.floorRegionSkippedInsideRoomSqm - base.floorRegionSkippedInsideRoomSqm) < 1e-6,
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
    // 2026-10-13 阶段 3：单价来自 config/hvac.yaml 的 commercial.price_cny（DEC-2026-10-04-R1
    // 成交 36,000），不再是 shared/houseData.ts 里 A2 的 invented 29,000。
    assert.equal(hvacCategory.autoActual, 36000);
  });

  it('calculates per-room floor topic', () => {
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
        hvac: { default: 'A2', roomOverrides: {} },
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
        hvac: { default: 'A2', roomOverrides: {} },
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
        hvac: { default: 'A2', roomOverrides: {} },
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
    assert.equal(hvacCategory.autoActual, 36000);
    const hvacItem = snapshot.lineItems.find((li) => li.topic === 'hvac');
    assert.ok(hvacItem);
    assert.equal(hvacItem.unitPrice, 36000);
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
        hvac: { default: 'A2', roomOverrides: {} },
        floor: { default: 'floor_tile_01', roomOverrides: {} },
        wall: { default: 'wall_tile_01', roomOverrides: {} },
        paint: { default: 'latex_paint_01', roomOverrides: {} },
      },
    };
    const snapshot = calc.calculate(scheme);

    const masonry = snapshot.categories.find((c) => c.key === 'masonry');
    assert.ok(masonry);
    // 阶段 5 口径变更：actual 只计已取证款 + 人工，不再含 candidateActual。
    // 本 fixture 选 floor_tile_01，masonry 的材料款全是候选价 → actual = 纯人工。
    // 断言从「actual > autoActual」改为「actual === 人工，且 candidateActual 单独显形」。
    const laborAdded = masonry.actual - (masonry.verifiedActual ?? 0);
    assert.ok(laborAdded > 0, `masonry 应有人工费进 actual（实际 ${masonry.actual}）`);
    assert.ok((masonry.candidateActual ?? 0) > 0, 'masonry 的候选价应单独显形，不混进 actual');
    assert.equal(masonry.actual, laborAdded, 'actual 应等于已取证材料款 + 人工，本 fixture 已取证材料款为 0');

    const painting = snapshot.categories.find((c) => c.key === 'painting');
    assert.ok(painting);
    // 阶段 5 口径变更：painting 的候选材料款不进 actual，actual = 纯人工。
    // 注意本文件顶部的 rulesConfig fixture 里 paint 行项仍用旧字段名 `paintWallArea`，
    // 因此这个 fixture 下 painting 的材料行为 0（生产 config 用 paintScopeArea，材料额 1,567）。
    // 故此处只断言口径不变量，不断言具体金额——具体金额由 paint-scope.test.ts 用真实 config 钉。
    assert.ok(painting.actual > 0, `painting 应有人工费进 actual（实际 ${painting.actual}）`);
    assert.equal(
      painting.actual,
      (painting.verifiedActual ?? 0) + (painting.manualActual ?? 0) + laborOf(painting),
      '阶段 5 口径：actual = 已取证材料款 + 人工录入 + 人工，不含 candidateActual',
    );
    assert.equal(
      (painting.verifiedActual ?? 0) + (painting.candidateActual ?? 0),
      painting.autoActual,
      '阶段 1 门控不变量对 painting 成立',
    );

    const hvac = snapshot.categories.find((c) => c.key === 'hvac');
    assert.ok(hvac);
  });

  it('carpentry labor is measured from ceiling zones, not room areas', () => {
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
    const carpentry = snapshot.categories.find((c) => c.key === 'carpentry');
    assert.ok(carpentry);
    // area: 'ceiling_zones' → shared/ceiling-takeoff.ts 的吊顶板面净面积（总净面积 46.385 − 窗帘盒 4.463 = 41.922㎡，R01 重算：门厅吊顶区 1.0584→2.561）× 40 元/㎡。
    // 旧口径按房间面积合计 142.92㎡（¥5,717），把无吊顶平顶/电梯井/入户花园都计了费。
    // 注意：人工费进 cat.actual（不是 autoActual），与 computeLabor 既有口径一致。
    assert.ok(
      Math.abs(carpentry.actual - Math.round(40 * (46.385 - 4.463))) <= 2,
      `carpentry 板面人工应为 ~1677（40 元/㎡ × 41.922㎡），实际 ${carpentry.actual}`
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
        hvac: { default: 'A2', roomOverrides: {} },
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
        hvac: { default: 'A2', roomOverrides: {} },
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
        hvac: { default: 'A2', roomOverrides: {} },
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
      // 阶段 5 口径变更前：actual = manual + verified + candidate（>= manual + autoActual）。
      // 阶段 5 后：actual = manual + verified（**不含 candidate**）。
      // 不变量改成「manual + verified <= actual」与「verified + candidate === autoActual」。
      assert.ok(
        cat.actual >= cat.manualActual + (cat.verifiedActual ?? 0),
        `actual 应 >= manualActual + verifiedActual for ${cat.key}（人工加在已取证材料款之上）`
      );
      assert.equal(
        (cat.verifiedActual ?? 0) + (cat.candidateActual ?? 0),
        cat.autoActual,
        `verifiedActual + candidateActual === autoActual for ${cat.key}（阶段 1 门控不变量）`
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
    // 阶段 3：预算数（base.json，未随合同上调）与成交价分列——36,000 是实际，29,000 是旧分配额，
    // 差额 7,000 正好由 status='over' 显形，不再被 invented 29,000 一口价盖住。
    assert.equal(hvac.actual, 36000);
    assert.equal(hvac.status, 'over');
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

  // DEC-2026-10-13 阶段 2 第二半改写：原断言是「entry_garden 的显式 override 能重新计费」。
  // 新架构下 floor 的**数量**来自 shared/masonry-takeoff.ts 的干/湿区房间表，
  // entry_garden 两表都不列（DEC-041：开发商已铺），所以它没有可计费的量——
  // override 只决定「用哪个 option」，不能无中生有造出面积。要给它计费是 config 决定
  // （把它加进 config/tile-comparison.yaml 的 dry_room_ids），不是 scheme 决定。
  // 这正是本次根治的目标：数量的归属只有一处，方案层只能选材、不能改量。
  it('DEC-041: entry_garden 没有声明的地面量，override 只能选材不能造量', () => {
    const catalog = ProjectCatalog.load('.');
    const realRules = RuleEngine.load('config/design-rules.yaml').getConfig();
    const calc = new BudgetCalculator(catalog, realRules);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: { floor: { default: 'floor_pbr_tile_612', roomOverrides: { entry_garden: 'floor_tile_01' } } },
    };
    const snapshot = calc.calculate(scheme);
    const entryItem = snapshot.lineItems.find((li) => li.topic === 'floor' && li.roomId === 'entry_garden');
    // override 仍被尊重（行存在、option 是覆盖值），但数量为 0 → 不计费
    assert.ok(entryItem, 'explicit override bypasses applyRooms skip');
    assert.equal(entryItem?.optionId, 'floor_tile_01');
    assert.equal(entryItem?.quantity, 0);
    assert.equal(entryItem?.cost, 0);
    // 且它必须在显形清单里留名，不是被静默吞掉
    const masonry = snapshot.categories.find((c) => c.key === 'masonry');
    assert.ok(masonry?.pendingQuantity?.some((item) => item.id === 'entry_garden'),
      'entry_garden 必须进 pendingQuantity 显形');
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

  // DEC-2026-10-13「预算计算架构根治」阶段 2 第二半：masonry 科目锚点（改前 → 改后）。
  // 治的两条根因：① `wetWallArea = (宽+深)×2×高×0.7` 那个 0.7 全库无依据；
  // ② 地面材料侧与人工侧各算一遍（121.510㎡ vs 125.260㎡，差 3.75㎡ 正是主走廊）。
  it('阶段 2 第二半：masonry 锚点——墙砖声明实算、地面材料/人工同一出口', () => {
    const catalog = ProjectCatalog.load('.');
    const realRules = RuleEngine.load('config/design-rules.yaml').getConfig();
    const scheme = JSON.parse(readFileSync('data/current-scheme.json', 'utf8')) as CurrentScheme;
    const masonryTakeoff = loadMasonryTakeoff(catalog);
    const snapshot = new BudgetCalculator(catalog, realRules).calculate(scheme);
    const masonry = snapshot.categories.find((c) => c.key === 'masonry');
    assert.ok(masonry);

    // 墙砖：拍系数 65.6992㎡ → overlay 声明实算 37.0186㎡（wall_region 21.5505 + sill_region 15.4681；
    // 2026-10-23 DEC-2026-10-23-R04 前为 36.7236 = 21.2555 + 15.4681）。
    // 按 wall_tile_01 的 70 元/㎡（12 元/片 ÷ 0.18 ㎡/片 × 1.05 损耗）从 4,598.94 降到 2,591.30。
    const wallQuantity = snapshot.lineItems.filter((li) => li.topic === 'wall').reduce((sum, li) => sum + li.quantity, 0);
    assert.ok(Math.abs(wallQuantity - 37.01859934708643) < 1e-6,
      `墙砖量必须等于 overlay 声明实算 37.0186㎡（wall 21.5505 + sill 15.4681），实际 ${wallQuantity}`);
    const wallCost = snapshot.lineItems.filter((li) => li.topic === 'wall').reduce((sum, li) => sum + li.cost, 0);
    assert.ok(Math.abs(wallCost - 2591.30195429605) < 1e-6,
      `墙砖主材必须从 4,598.944 降到 2,591.302（37.0186㎡ × 70 元/㎡），实际 ${wallCost}`);
    // 客厅落地幕墙防水台（living_dining，sill_region front+top 1.86㎡）现在也进预算了——
    // 旧口径 wall.applyRooms 只有厨卫+阳台，这 1.86㎡ 被静默丢掉。
    const livingWall = snapshot.lineItems.find((li) => li.topic === 'wall' && li.roomId === 'living_dining');
    assert.ok(livingWall && Math.abs(livingWall.quantity - 1.86) < 1e-6, '客厅防水台贴砖 1.86㎡ 必须计费');
    for (const [roomId, quantity] of [
      ['master_bedroom', 3.2130496735],
      ['study', 0.9],
      ['bedroom_nw', 0.9],
      ['bedroom_se', 0.9],
    ] as const) {
      const sillWall = snapshot.lineItems.find((li) => li.topic === 'wall' && li.roomId === roomId);
      assert.ok(sillWall && Math.abs(sillWall.quantity - quantity) < 1e-6,
        `${roomId} 防水台贴砖 ${quantity}㎡ 必须计费`);
    }

    // 地面：材料侧逐行之和 == 人工侧算量 == 127.8734㎡（干区房 116.1874 + 湿区房 7.936 + 主走廊 extra 3.75；R01 交付态 123.9584）。
    const floorQuantity = snapshot.lineItems.filter((li) => li.topic === 'floor').reduce((sum, li) => sum + li.quantity, 0);
    assert.ok(Math.abs(floorQuantity - 127.8734) < 1e-6,
      `floor 算量必须是 127.8734㎡（R01 重算后客餐厅 +1.725、东南房 +2.19，实际 ${floorQuantity}`);
    const guestFloorLines = snapshot.lineItems.filter((li) => li.topic === 'floor' && li.roomId === 'guest_bath');
    assert.deepEqual(guestFloorLines.map((li) => [li.optionId, Number(li.quantity.toFixed(3))]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))), [
      ['floor_tile_deco_small', 2.235], // R04：客卫 3.15→3.36㎡，小花砖区 2.025→2.235
      ['floor_tile_kt_200x1200_01', 1.125],
    ]);
    // 阶段 3 起人工按三行计价，单价取费率卡里**匹配当前选型规格**的行：
    //   floor           干区合计 121.0624㎡ × 75（master 120.279 + R01 重算客餐厅 −1.4066 + 东南房 +2.19）
    //   wall_tile       贴砖 37.0186㎡ × 50（选型 wall_tile_01 300×600；R04 后 36.7236→37.0186）
    //   wet_floor_tile  湿区 6.811㎡ 待报价（客卫小花砖余区 + 主卫；R04 客卫 +0.21）
    // 旧口径是一行 45 元/㎡ × 123.34 = 5,550（R04 后地面总量 127.09）。
    // 阶段 5 口径变更：actual = 已取证材料款 + 人工。本 fixture 材料款全未取证 →
    // actual 就是纯人工，不再用 `actual - autoActual`（那会是负数）。
    assert.equal(masonry.actual, 9080 + 1851,
      '瓦工人工 = round(75 × 121.0624) + round(50 × 37.0186)，湿区待报价不进 actual（R01 重算：干区 +3.915）');
    assert.deepEqual(masonry.pendingLabor, [
      { area: 'wet_floor_tile', quantity: masonryTakeoff.wetFloorSqm, unit: '元/㎡', reason: 'rate 待报价' },
    ]);
    // 材料侧：开放洗漱区1.125㎡从花砖转木纹砖，主材候选金额净减100.688；墙砖范围不变。
    assert.ok(Math.abs(masonry.autoActual - 19252.301154296052) < 1e-6, // R01 重算后实算（客餐厅 +1.725、东南房 +2.19 干区地面材料）
      `masonry.autoActual 应反映客卫1.125㎡面层拆分，实际 ${masonry.autoActual}`);
    // 合计 actual：stage-5旧基准65,608需重算：DEC-2026-10-16-TILE-01低反坎墙砖人工+295，
    // 本次开放洗漱区木纹砖人工+84，R04 前锚点65,987。材料候选金额不进actual，不能抵消人工。
    // 阶段 5 口径变更：actual 不再含 candidateActual。本 fixture 材料款全未取证 →
    // actual = 纯人工 = round(75×121.0624) + round(50×37.0186) = 9,080 + 1,851 = 10,931（DEC-2026-10-25-R01 重算）。
    assert.ok(Math.abs(masonry.actual - 10931) < 1e-6,
      `masonry.actual 应为10,931（纯人工），实际 ${masonry.actual}`);
    assert.ok(Math.abs(masonry.candidateActual! - 19252.301154296052) < 1e-6,
      `masonry.candidateActual 应为19,252.301（材料全额转入候选档，R01 重算干区 +3.915），实际 ${masonry.candidateActual}`);
  });

  // DEC-2026-10-13 阶段 2 第二半：橱柜/台面锚点。
  // 治的是 `linearKitchen = 深×0.8`（算出 1.92 而 house.yaml 柜体段实计 4.36m），
  // 以及随之而来的量纲错配：cabinet_board_01 是 ㎡ 单价（800 元/㎡**投影面积**，
  // control.yaml 原话「柜体800/㎡投影」）却被喂了延米数。
  it('阶段 2 第二半：kitchen_cabinet 锚点——柜体走投影面积、台面走延米且含桥段', () => {
    const catalog = ProjectCatalog.load('.');
    const realRules = RuleEngine.load('config/design-rules.yaml').getConfig();
    const scheme = JSON.parse(readFileSync('data/current-scheme.json', 'utf8')) as CurrentScheme;
    const snapshot = new BudgetCalculator(catalog, realRules).calculate(scheme);

    const cabinetItem = snapshot.lineItems.find((li) => li.topic === 'cabinet');
    assert.ok(cabinetItem, 'cabinet 行必须存在');
    // 2026-10-14 冰箱搬位试版先尝试 2.05m，shadow 检查见开态叠扇重叠 0.09m 后缩至1.95m：
    // 投影面积 = (1.28 + 1.68 + 1.95) × 0.86 = 4.91 × 0.86 = 4.2226㎡。
    // 旧基线4.36m/3.7496㎡与中间试值5.01m/4.3086㎡保留在 DEC-2026-10-14-R01 审计中。
    assert.ok(Math.abs(cabinetItem.quantity - 4.2226) < 1e-9,
      `柜体量必须是投影面积 4.2226㎡（4.91m × 0.86m），实际 ${cabinetItem.quantity}`);
    assert.equal(cabinetItem.unitPrice, 800);
    assert.ok(Math.abs(cabinetItem.cost - 3546.984) < 1e-6,
      `柜体候选价按 4.2226㎡ × 800 元/㎡并计损耗后为 3,546.984，实际 ${cabinetItem.cost}`);

    const countertopItem = snapshot.lineItems.find((li) => li.topic === 'countertop');
    assert.ok(countertopItem, 'countertop 行必须存在');
    // 延米 = 柜体段 4.91 + 连续台面桥 0.60 = 5.51m（桥段 house.yaml 注明「只是连续台面，不生成柜体」）
    assert.ok(Math.abs(countertopItem.quantity - 5.51) < 1e-9,
      `台面量必须是 5.51 延米（4.91 柜体段 + 0.60 台面桥），实际 ${countertopItem.quantity}`);
    assert.equal(countertopItem.unitPrice, 400);
    assert.ok(Math.abs(countertopItem.cost - 2248.08) < 1e-6,
      `台面候选价按 5.51 延米 × 400 元/延米并计损耗后为 2,248.08，实际 ${countertopItem.cost}`);

    const kitchenCabinet = snapshot.categories.find((c) => c.key === 'kitchen_cabinet');
    assert.ok(kitchenCabinet);
    // 2.05m 中间试算5,908.104 → 消除长虹门碰撞后的1.95m候选价5,795.064；不是已批准金额。
    assert.ok(Math.abs(kitchenCabinet.autoActual - 5795.064) < 1e-6,
      `kitchen_cabinet.autoActual 应反映本轮柜体与台面量及其损耗候选价 5,795.064，实际 ${kitchenCabinet.autoActual}`);
    // 阶段 5 口径变更：该科目没有 labor 行，材料款全是候选价 →
    // actual = 0（已取证一分钱没有），autoActual 仍是材料全额 5,795.064，
    // candidateActual 单独显形。旧断言「actual === autoActual」已不成立。
    assert.equal(kitchenCabinet.actual, 0, '阶段 5 后该科目 actual = 0（无 labor、材料全未取证）');
    assert.ok(Math.abs(kitchenCabinet.candidateActual! - 5795.064) < 1e-6,
      `kitchen_cabinet.candidateActual 应为 5,795.064，实际 ${kitchenCabinet.candidateActual}`);
    assert.equal(kitchenCabinet.status, 'unpriced', '全未取证科目应标 unpriced 而非 ok');
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

  // === 候选价门控（2026-10-13 阶段 1：纯加法，零行为变化）===
  // 背景：data/current-scheme.json 当前选中的 41 条材料里 39 条是 candidate /
  // pending_verification（到店未确认），它们全额进 totalActual，而快照里没有任何字段
  // 能让消费者看出这件事——catalog.getDataPrecision() 早就统计得出这个数并经 MCP
  // get_data_confidence 暴露，/api/budget 却按全款计。阶段 1 只让问题显形：
  // verifiedActual / candidateActual 两份之和恒等于 autoActual，actual 口径不动
  // （口径变更是阶段 5，须配 baseline 前后对照）。
  it('候选价门控：verifiedActual + candidateActual === autoActual，且候选价显形', () => {
    const catalog = ProjectCatalog.load('.');
    const rules = RuleEngine.load('config/design-rules.yaml').getConfig();
    const scheme = JSON.parse(readFileSync('data/current-scheme.json', 'utf8')) as CurrentScheme;
    const snapshot = new BudgetCalculator(catalog, rules).calculate(scheme);

    for (const cat of snapshot.categories) {
      assert.equal(typeof cat.verifiedActual, 'number', `${cat.key} 必须显式给出 verifiedActual，不能是 undefined 漏掉`);
      assert.equal(typeof cat.candidateActual, 'number', `${cat.key} 必须显式给出 candidateActual，不能是 undefined 漏掉`);
      assert.equal(
        cat.verifiedActual! + cat.candidateActual!,
        cat.autoActual,
        `${cat.key}: verifiedActual + candidateActual 必须等于 autoActual`,
      );
    }
    // 人工（computeLabor）与人工录入（manualActual）都不进这两档：瓦工、漆工只进 actual。
    // 阶段 5 前 actual 含 candidateActual，所以「actual > 两份之和」。
    // 阶段 5 后 actual = 已取证材料款 + 人工，不变量变成：
    //   actual − verified − manual === 人工 > 0（对有人工的科目）
    for (const key of ['masonry', 'painting']) {
      const cat = snapshot.categories.find((c) => c.key === key);
      assert.ok(cat, `${key} 科目必须存在`);
      const labor = cat.actual - (cat.verifiedActual ?? 0) - (cat.manualActual ?? 0);
      assert.ok(labor > 0, `${key} 必须有人工费进 actual（labor=${labor}）`);
      // 直接判据：actual 不得大于「已取证材料款 + 人工」。
      // 若 candidateActual 混进 actual，actual 会虚高到 verified + candidate + labor。
      // 用 labor 的上界反推：labor 不可能超过该科目 budget（人工不会超过整包预算）。
      assert.ok(
        labor <= (cat.budget ?? 0) + 1,
        `${key} 的 labor 不应超过科目预算，疑似 candidateActual 混入 actual（labor=${labor}, budget=${cat.budget}）`,
      );
    }

    const verifiedTotal = snapshot.categories.reduce((sum, c) => sum + (c.verifiedActual ?? 0), 0);
    const candidateTotal = snapshot.categories.reduce((sum, c) => sum + (c.candidateActual ?? 0), 0);
    const autoTotal = snapshot.categories.reduce((sum, c) => sum + c.autoActual, 0);
    assert.equal(verifiedTotal + candidateTotal, autoTotal, '两份之和回到 autoActual 合计');
    assert.ok(candidateTotal > 0, `候选价必须显形（当前 candidateActual 合计 ${candidateTotal}，若为 0 说明未取证全额入账的老问题又隐身了）`);
    // 2026-10-13 阶段 1 的 baseline 是 145626.63013333332；阶段 2 第二半（删除
    // wetWallArea / linearKitchen 拍系数、地面材料侧与人工侧共用出口）后实测
    // 146208.46361048135。阶段 3（瓦工费率改成合法报价卡 + hvac 读 config/hvac.yaml）后
    // 实测 157870.46361048135，差额 +11,662 = 瓦工人工 +4,662 + hvac +7,000。
    // **当前实测 66,310**：65,922 + R01 重算净 +388（客餐厅 +1.725、东南房 +2.19 与门厅吊顶区 1.0584→2.561 传导至漆工/木工/瓦工人工与材料）；
    // actual 不含candidateActual材料款，只保留已取证款、人工/人工录入与其他明确来源。
    assert.equal(snapshot.totalActual, 66337, '现行 totalActual 锚点（已含 R01 重算；DEC-2026-10-28-R05 窗帘盒归位后涂装计价面积 +1.100㎡、人工 +¥27.50，66310→66337）');
    assert.ok(candidateTotal > 90000, `候选价应仍在 92,696 量级（当前 ${candidateTotal}），不得被静默清零`);
  });

  it('候选价门控：hvac 的 36000 归「已取证」，因为合同已成交', () => {
    // 阶段 3：hvac 选项不再由 project-catalog.ts 硬编码构造，改读 config/hvac.yaml 的
    // commercial 块（shared/hvac-plants 的 hvacPlanOptions），data.status 由
    // commercial.status 透传 = contracted（DEC-2026-10-04-R1）→ 归 verified。
    // 这同时是 SYNTHETIC_UNVERIFIED_TOPICS 可以清空 hvac 的证据：合成选项也带 status 了。
    // 两条入口都要覆盖：project design-rules 的 hvac 是 calcMode:'fixed'，
    // 而本文件顶部 rulesConfig 的 hvac 无 calcMode 且 topic.perRoom=false → 走非 perRoom 分支。
    const catalog = ProjectCatalog.load('.');
    const projectRules = RuleEngine.load('config/design-rules.yaml').getConfig();
    const scheme = JSON.parse(readFileSync('data/current-scheme.json', 'utf8')) as CurrentScheme;

    for (const rules of [projectRules, rulesConfig]) {
      const snapshot = new BudgetCalculator(catalog, rules).calculate(scheme);
      const hvac = snapshot.categories.find((c) => c.key === 'hvac');
      assert.ok(hvac);
      assert.equal(hvac.autoActual, 36000, '阶段 3：hvac 单价 = config/hvac.yaml 的成交价');
      assert.notEqual(hvac.candidateActual, undefined, 'hvac 必须被显式归类，不能是 undefined');
      assert.equal(hvac.verifiedActual, 36000, 'commercial.status = contracted → 已取证');
      assert.equal(hvac.candidateActual, 0, '合同已成交，不得再算进候选');
    }
  });

  it('候选价门控：autoActualBucket 按 status 分类，合成选项与未登记 topic 显式处置', () => {
    const catalog = ProjectCatalog.load('.');
    const option = (id: string, status: unknown): DesignOption => ({
      id,
      topicId: 't',
      name: id,
      description: '',
      price_per_unit: 0,
      coverage_per_unit: 1,
      loss_rate: 1,
      data: status === undefined ? {} : { status },
    });

    // 已取证的 6 个 status（与 BudgetCategory.verifiedActual 的注释同名单）
    for (const status of ['measured', 'confirmed', 'quoted_sheet', 'contracted', 'provided_by_developer', 'user_budget_confirmed']) {
      assert.equal(autoActualBucket(option('x', status), 'any_topic'), 'verified', `${status} 属已取证`);
    }
    // 其余一律归候选。rejected 也归候选而不是剔除：选型里出现它本身就是异常，宁可显形。
    for (const status of ['candidate', 'pending_verification', 'estimated', 'owner_reported', 'rejected']) {
      assert.equal(autoActualBucket(option('x', status), 'any_topic'), 'candidate', `${status} 属未取证`);
    }
    // 两个 price 0 的真实条目：归位必须按 status 判，不能因为价格是 0 就混过去
    const wardrobe = catalog.getOption('wardrobe', 'wardrobe_north_950_custom_01');
    assert.equal(wardrobe?.price_per_unit, 0);
    assert.equal(autoActualBucket(wardrobe, 'wardrobe'), 'candidate', '主卧 950 定制衣柜 price 0 / candidate → 候选（待现场/厂家核价）');
    const entryDoor = catalog.getOption('entry_door', 'entry_door_01');
    assert.equal(entryDoor?.price_per_unit, 0);
    assert.equal(autoActualBucket(entryDoor, 'entry_door'), 'verified', '入户门开发商已装 / provided_by_developer → 已取证（无需采购）');
    // hvac：合成选项也带 status（config/hvac.yaml 的 commercial.status = contracted）→ 已取证。
    // 阶段 3 起 SYNTHETIC_UNVERIFIED_TOPICS 已清空（不再需要白名单兜）。
    assert.equal(autoActualBucket(catalog.getOption('hvac', 'A2'), 'hvac'), 'verified', 'hvac 合同已成交 → 已取证');
    // 未登记的 status-less 合成选项必须抛错：不允许静默掉进任何一档
    assert.throws(() => autoActualBucket(option('ghost', undefined), 'ghost_topic'), /没有 data\.status/);
  });
});

/**
 * 2026-10-14 阶段 4：清除「取不到值时静默发明」的类别 1 兜底。
 *
 * 这一组测试钉住的是**失败方式**而不是数值：过去这些字段缺失时会各自兜底
 * （price 0 / coverage 1 / loss 1.0 / 房间 bbox 面积 / budget>0 但 actual=0 显示 ok），
 * 每一种都能算出一个"看起来正常"的钱数，所以全绿也发现不了。现在必须抛错。
 */
describe('BudgetCalculator 类别 1 兜底已改 fail-closed', () => {
  const schemeWith = (topic: string, optionId: string): CurrentScheme => ({
    updatedAt: new Date().toISOString(),
    selections: { [topic]: { default: optionId, roomOverrides: {} } },
  });

  /** 造一个缺计价字段的 option（materials.yaml 里这四条是 calc_mode: fixed，休眠中）。 */
  const optionMissing = (field: 'price_per_unit' | 'coverage_per_unit' | 'loss_rate'): DesignOption => ({
    id: 'probe_option',
    topicId: 'floor',
    name: 'probe',
    description: '',
    price_per_unit: 70,
    coverage_per_unit: 0.24,
    loss_rate: 1.05,
    data: { status: 'candidate' },
    ...(field === 'price_per_unit' ? { price_per_unit: undefined as unknown as number } : {}),
    ...(field === 'coverage_per_unit' ? { coverage_per_unit: undefined as unknown as number } : {}),
    ...(field === 'loss_rate' ? { loss_rate: undefined as unknown as number } : {}),
  });

  it('缺 price_per_unit 抛错，不按 0 元计', () => {
    const catalog = ProjectCatalog.load('.');
    const calc = new BudgetCalculator(catalog, rulesConfig);
    const original = catalog.getOption.bind(catalog);
    (catalog as unknown as { getOption: typeof catalog.getOption }).getOption = (topic, id) =>
      id === 'floor_tile_01' ? optionMissing('price_per_unit') : original(topic, id);
    assert.throws(() => calc.calculate(schemeWith('floor', 'floor_tile_01')), /缺 price_per_unit/);
  });

  it('缺 coverage_per_unit 抛错，不按 1 兜底（否则面积型材料按片数×单价计价）', () => {
    const catalog = ProjectCatalog.load('.');
    const calc = new BudgetCalculator(catalog, rulesConfig);
    const original = catalog.getOption.bind(catalog);
    (catalog as unknown as { getOption: typeof catalog.getOption }).getOption = (topic, id) =>
      id === 'floor_tile_01' ? optionMissing('coverage_per_unit') : original(topic, id);
    assert.throws(() => calc.calculate(schemeWith('floor', 'floor_tile_01')), /缺 coverage_per_unit/);
  });

  it('缺 loss_rate 抛错，不按 1.0 兜底（否则少算 8~15% 损耗）', () => {
    const catalog = ProjectCatalog.load('.');
    const calc = new BudgetCalculator(catalog, rulesConfig);
    const original = catalog.getOption.bind(catalog);
    (catalog as unknown as { getOption: typeof catalog.getOption }).getOption = (topic, id) =>
      id === 'floor_tile_01' ? optionMissing('loss_rate') : original(topic, id);
    assert.throws(() => calc.calculate(schemeWith('floor', 'floor_tile_01')), /缺 loss_rate/);
  });

  it('price_per_unit = 0 是合法声明值，不抛错（开发商已装 / 待核价）', () => {
    const catalog = ProjectCatalog.load('.');
    const calc = new BudgetCalculator(catalog, rulesConfig);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: { wardrobe: { default: 'wardrobe_north_950_custom_01', roomOverrides: { master_bedroom: 'wardrobe_north_950_custom_01' } } },
    };
    // 主卧 950 定制衣柜 price 0 / candidate：必须照常出 0 元并归入 candidateActual，
    // 不能被"缺价格"的守卫误伤——「没写价格」与「声明为 0」是两件事。
    assert.doesNotThrow(() => calc.calculate(scheme));
  });

  it('房间缺 resolved area 抛错，不退回 bbox 面积', () => {
    const catalog = ProjectCatalog.load('.');
    const calc = new BudgetCalculator(catalog, rulesConfig);
    const original = catalog.getRooms.bind(catalog);
    (catalog as unknown as { getRooms: typeof catalog.getRooms }).getRooms = () =>
      original().map((room) => (room.id === 'master_bedroom' ? { ...room, area: undefined } : room));
    assert.throws(() => calc.calculate(schemeWith('floor', 'floor_tile_01')), /缺 resolved area/);
  });

  it('无计价来源的科目标 unpriced，不再显示 ok（demolition / property_fees）', () => {
    const catalog = ProjectCatalog.load('.');
    const calc = new BudgetCalculator(catalog, rulesConfig);
    const snapshot = calc.calculate(schemeWith('floor', 'floor_tile_01'));
    const byKey = new Map(snapshot.categories.map((c) => [c.key, c]));
    // 这两个科目既无 labor 行、又无 material 自动额、也无人工录入：actual 恒 0
    // 从来不代表"不花钱"，而代表"从未定价"。旧口径 ratio=0 → 'ok'，系统性低估 ¥8,000。
    assert.equal(byKey.get('demolition')!.status, 'unpriced', 'demolition 从未定价，不能显示 ok');
    assert.equal(byKey.get('property_fees')!.status, 'unpriced', 'property_fees 从未定价，不能显示 ok');
    assert.equal(byKey.get('demolition')!.actual, 0, 'actual 仍为 0：本阶段不改金额口径');
    assert.equal(byKey.get('property_fees')!.actual, 0, 'actual 仍为 0：本阶段不改金额口径');
    // 有计价来源的科目不受影响：labor 行（waterproof）与材料自动额（masonry）照旧。
    assert.equal(byKey.get('waterproof')!.status, 'ok');
    // masonry 有 labor 行 + 材料自动额，所以照旧走 ok/near/over 三档（绝不落入 unpriced）。
    assert.ok(['ok', 'near', 'over'].includes(byKey.get('masonry')!.status),
      `masonry 有计价来源，不得标 unpriced（实际 ${byKey.get('masonry')!.status}）`);
    // contingency 保留 reserved（批准的不可预见费，不参与上述判定）。
    assert.equal(byKey.get('contingency')!.status, 'reserved');
  });
});
