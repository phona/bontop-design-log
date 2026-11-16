// 房间相对摆位（2026-11-16 DDD 模型约束）：可搬动成品以「房间包络西北角 + 东/南
// 偏移」定位，关系属于房间聚合、不属于另一件家具（椅子不锚餐桌，用户否决）。
//
// 断言的是规则不是数据：期望位置一律由注入的房间锚点现算（西北角 + 偏移），
// 不钉任何历史坐标；等价证明（7 件解算值与原绝对坐标一致）只住 PR 记录与 git 历史。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectCatalog } from '../../server/project-catalog.js';
import {
  furnitureHostIndex,
  resolveFurniturePlacement,
  type PlacementAnchors,
  type PlacementItem,
  type RoomAnchor,
  type WallLike,
} from '../../shared/furniture-placement.js';

const NO_WALLS = new Map<string, WallLike[]>();
const NO_HOSTS = new Map();

// 合成房间锚点（living_dining 的包络量级；本测试只关心「西北角 + 偏移」的
// 解算规则，不重复几何一致性断言）。
const ROOM: RoomAnchor = { x: 10.3, z: 6.1, width: 6.2, depth: 7.4 };
const ROOMS = new Map([['living_dining', ROOM]]);
const ANCHORS: PlacementAnchors = { rooms: ROOMS };

// 房间相对形态的典型条目（dining_table，DIMS 1.4×0.8；落地）。
const ROOM_ITEM: PlacementItem = {
  type: 'dining_table',
  id: 'ld.dining_table',
  room: 'living_dining',
  room_dx: 2.6,
  room_dz: 1.05,
  support: { kind: 'floor' },
};

function northwest(room: RoomAnchor): { x: number; z: number } {
  return { x: room.x - room.width / 2, z: room.z - room.depth / 2 };
}

describe('furniture 房间相对摆位（2026-11-16 DDD 模型约束）', () => {
  it('解算位置 = 房间包络西北角 + 声明偏移（由注入锚点现算，不钉历史坐标）', () => {
    const { placement, diagnostic } = resolveFurniturePlacement(ROOM_ITEM, NO_WALLS, NO_HOSTS, ANCHORS);
    assert.equal(diagnostic, undefined, `房间相对条目必须可解，实得诊断：${diagnostic ?? ''}`);
    assert.ok(placement);
    const nw = northwest(ROOM);
    assert.ok(Math.abs(placement.x - (nw.x + 2.6)) < 1e-9, `x 应为西北角 + dx，实得 ${placement.x}`);
    assert.ok(Math.abs(placement.z - (nw.z + 1.05)) < 1e-9, `z 应为西北角 + dz，实得 ${placement.z}`);
  });

  it('房间移动：解算位置跟随房间包络平移同一增量（房间相对的传导不变量）', () => {
    const moved: RoomAnchor = { x: ROOM.x + 0.5, z: ROOM.z - 0.3, width: ROOM.width, depth: ROOM.depth };
    const movedAnchors: PlacementAnchors = { rooms: new Map([['living_dining', moved]]) };
    const before = resolveFurniturePlacement(ROOM_ITEM, NO_WALLS, NO_HOSTS, ANCHORS);
    const after = resolveFurniturePlacement(ROOM_ITEM, NO_WALLS, NO_HOSTS, movedAnchors);
    assert.ok(before.placement && after.placement);
    assert.ok(Math.abs((after.placement.x - before.placement.x) - 0.5) < 1e-9, 'x 须跟随房间东移 0.5m');
    assert.ok(Math.abs((after.placement.z - before.placement.z) - (-0.3)) < 1e-9, 'z 须跟随房间北移 0.3m');
  });

  it('房间相对 + 绝对 x/z：双来源诊断失败（禁写第二坐标源）', () => {
    const { placement, diagnostic } = resolveFurniturePlacement(
      { ...ROOM_ITEM, x: 9.8, z: 3.45 }, NO_WALLS, NO_HOSTS, ANCHORS,
    );
    assert.equal(placement, null);
    assert.match(diagnostic ?? '', /room\/room_dx\/room_dz 与绝对 x\/z 不得同时声明/);
  });

  it('房间相对 + wall：双来源诊断失败', () => {
    const { placement, diagnostic } = resolveFurniturePlacement(
      { ...ROOM_ITEM, wall: 'w_some', wall_side: 'west', along: 1 }, NO_WALLS, NO_HOSTS, ANCHORS,
    );
    assert.equal(placement, null);
    assert.match(diagnostic ?? '', /wall\/wall_side\/along 与 room\/room_dx\/room_dz 不得同时声明/);
  });

  it('缺 room_dx/room_dz：定位来源不完整，诊断失败', () => {
    for (const partial of [{ room_dx: 2.6 }, { room_dz: 1.05 }] as const) {
      const { placement, diagnostic } = resolveFurniturePlacement(
        { type: 'dining_table', id: 't', room: 'living_dining', support: { kind: 'floor' }, ...partial },
        NO_WALLS, NO_HOSTS, ANCHORS,
      );
      assert.equal(placement, null, `缺一半偏移 ${JSON.stringify(partial)} 也必须被拦`);
      assert.match(diagnostic ?? '', /须同时声明 room、room_dx、room_dz/);
    }
  });

  it('房间 id 不在解算上下文中：诊断失败，不回落绝对坐标', () => {
    const { placement, diagnostic } = resolveFurniturePlacement(
      { ...ROOM_ITEM, room: 'no_such_room' }, NO_WALLS, NO_HOSTS, ANCHORS,
    );
    assert.equal(placement, null);
    assert.match(diagnostic ?? '', /未在解算上下文中找到/);
  });

  it('调用方未传 rooms：房间相对条目诊断失败（fail-closed，不静默跳过）', () => {
    const { placement, diagnostic } = resolveFurniturePlacement(ROOM_ITEM, NO_WALLS, NO_HOSTS, undefined);
    assert.equal(placement, null);
    assert.match(diagnostic ?? '', /未在解算上下文中找到/);
  });

  it('mount/anchor 与 room 互斥（定位来源唯一）', () => {
    const mount = resolveFurniturePlacement(
      { type: 'robot_dock_gbath', id: 'gbath.robot_dock', mount: { furniture_id: 'gbath.vanity', slot: 'robot_bay' }, room: 'guest_bath', room_dx: 0.1, room_dz: 0.1, support: { kind: 'floor' } },
      NO_WALLS, NO_HOSTS, ANCHORS,
    );
    assert.equal(mount.placement, null);
    assert.match(mount.diagnostic ?? '', /mount 与 room\/room_dx\/room_dz 不得同时声明/);
    const anchor = resolveFurniturePlacement(
      { type: 'chair', id: 'c', anchor: { source: 'furniture', id: 'd', offset: { x: 0, z: 0 } }, room: 'living_dining', room_dx: 1, room_dz: 1, support: { kind: 'floor' } },
      NO_WALLS, NO_HOSTS, ANCHORS,
    );
    assert.equal(anchor.placement, null);
    assert.match(anchor.diagnostic ?? '', /anchor 与 room\/room_dx\/room_dz 不得同时声明/);
  });
});

describe('furniture 解算器 DIMS/support 强制（2026-11-16 DDD 模型约束）', () => {
  it('placed 条目无 DIMS（行内与目录均缺）：诊断失败，不静默跳过', () => {
    const { placement, diagnostic } = resolveFurniturePlacement(
      { type: 'no_such_type_xyz', id: 't1', x: 1, z: 1, support: { kind: 'floor' } },
      NO_WALLS, NO_HOSTS, undefined,
    );
    assert.equal(placement, null);
    assert.match(diagnostic ?? '', /no width\/depth for type "no_such_type_xyz"/);
  });

  it('placed 条目有 DIMS 但无 support：诊断失败（支撑声明必填）', () => {
    const { placement, diagnostic } = resolveFurniturePlacement(
      { type: 'dining_table', id: 't2', x: 9.8, z: 3.45 },
      NO_WALLS, NO_HOSTS, undefined,
    );
    assert.equal(placement, null);
    assert.match(diagnostic ?? '', /缺少 support 支撑声明/);
  });

  it('placed 条目 support 声明非法（拼错 kind/缺数值/空对象）：解算入口拒绝，不静默通过', () => {
    // 2026-11-16 Codex 一审 blocking：YAML 类型断言不验数据，非法声明曾在几何比较
    // 里静默通过（缺失数值 → NaN 比较恒 false；未知 kind 落在全部分支之外）。
    const typo = resolveFurniturePlacement(
      { type: 'dining_table', id: 't4', x: 9.8, z: 3.45, support: { kind: 'wal', bottom: 1.1 } } as unknown as PlacementItem,
      NO_WALLS, NO_HOSTS, undefined,
    );
    assert.equal(typo.placement, null);
    assert.match(typo.diagnostic ?? '', /未知的 support kind/);
    const noValue = resolveFurniturePlacement(
      { type: 'dining_table', id: 't5', x: 9.8, z: 3.45, support: { kind: 'wall' } } as unknown as PlacementItem,
      NO_WALLS, NO_HOSTS, undefined,
    );
    assert.equal(noValue.placement, null);
    assert.match(noValue.diagnostic ?? '', /缺必填数值 bottom/);
    const empty = resolveFurniturePlacement(
      { type: 'dining_table', id: 't6', x: 9.8, z: 3.45, support: {} } as unknown as PlacementItem,
      NO_WALLS, NO_HOSTS, undefined,
    );
    assert.equal(empty.placement, null);
    assert.match(empty.diagnostic ?? '', /未知的 support kind/);
  });

  it('count-only 条目（无 id、无定位声明）：豁免 DIMS/support，返回 null 且无诊断', () => {
    const { placement, diagnostic } = resolveFurniturePlacement(
      { type: 'dining_table', count: 2 }, NO_WALLS, NO_HOSTS, undefined,
    );
    assert.equal(placement, null);
    assert.equal(diagnostic, undefined, 'count-only 只喂预算，不得因缺 support 被判错');
  });

  it('行内 width/depth 可补 DIMS（目录缺项时不误杀）', () => {
    const { placement, diagnostic } = resolveFurniturePlacement(
      { type: 'no_such_type_xyz', id: 't3', x: 1, z: 1, width: 0.5, depth: 0.4, support: { kind: 'floor' } },
      NO_WALLS, NO_HOSTS, undefined,
    );
    assert.equal(diagnostic, undefined, `行内尺寸须补目录，实得诊断：${diagnostic ?? ''}`);
    assert.ok(placement);
  });
});

describe('房间相对 7 件（config 集成）：解算值 = 各自房间西北角 + 声明偏移', () => {
  const SEVEN = [
    'ld.dining_table',
    'ld.dining_chair_nw',
    'ld.dining_chair_ne',
    'ld.dining_chair_sw',
    'ld.dining_chair_se',
    'mb.low_dresser',
    'bnw.bed_150',
  ] as const;

  it('7 件全部可解，且偏移落在各自房间包络内（中心在房内）', () => {
    const catalog = ProjectCatalog.load('.');
    const rooms = new Map(catalog.getRooms().map((r) => [r.id, r]));
    const furnishings = catalog.getFurnishings();
    const wallSegments = new Map<string, WallLike[]>(
      catalog.getWalls()
        .filter((wall) => wall.id !== undefined)
        .map((wall) => [wall.id as string, wall.segments?.length ? wall.segments : [{ x1: wall.x1, z1: wall.z1, x2: wall.x2, z2: wall.z2 }]]),
    );
    const hosts = furnitureHostIndex(Object.values(furnishings).flat());
    for (const [roomId, items] of Object.entries(furnishings)) {
      for (const item of items) {
        if (!item.id || !(SEVEN as readonly string[]).includes(item.id)) continue;
        assert.ok(item.room !== undefined, `${item.id} 须为房间相对形态`);
        const room = rooms.get(item.room);
        assert.ok(room, `${item.id} 的房间 ${item.room} 须在 model-geometry.yaml 中`);
        assert.ok(item.room_dx !== undefined && item.room_dx >= 0 && item.room_dx <= room.width,
          `${item.id} 的 room_dx 须在房间宽 [0, ${room.width}] 内`);
        assert.ok(item.room_dz !== undefined && item.room_dz >= 0 && item.room_dz <= room.depth,
          `${item.id} 的 room_dz 须在房间深 [0, ${room.depth}] 内`);
        const { placement, diagnostic } = resolveFurniturePlacement(item, wallSegments, hosts, { rooms });
        assert.equal(diagnostic, undefined, `${item.id} 必须可解，实得诊断：${diagnostic ?? ''}`);
        assert.ok(placement);
        const nw = { x: room.x - room.width / 2, z: room.z - room.depth / 2 };
        assert.ok(Math.abs(placement.x - (nw.x + (item.room_dx ?? 0))) < 1e-9, `${item.id} 的 x 须 = 西北角 + room_dx`);
        assert.ok(Math.abs(placement.z - (nw.z + (item.room_dz ?? 0))) < 1e-9, `${item.id} 的 z 须 = 西北角 + room_dz`);
      }
    }
    // 7 件一个不少（防迁移漏件）。
    const found = Object.values(furnishings).flat().filter((i) => i.id !== undefined && (SEVEN as readonly string[]).includes(i.id));
    assert.equal(found.length, 7, `房间相对 7 件须齐全，实得 ${found.length} 件`);
  });
});
