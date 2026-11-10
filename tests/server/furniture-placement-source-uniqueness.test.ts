// 定位来源唯一性守门测试（issue #98 修复项 C：「已迁移对象不能合法地退回双事实源」）。
//
// 不变量：wall/wall_side/along 定位的对象**不得**同时声明绝对 x/z——已迁移到墙锚的对象
// 把旧绝对坐标写回来，此前被 shared/furniture-placement.ts 的 wall 分支静默优先吞掉
// （mount/anchor 分支都有来源互斥，唯独 wall 分支漏配），verify 与 DXF 全绿。本文件把
// 「双声明即诊断失败」钉进测试，防止第二份坐标源重新合法。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFurniturePlacement, type PlacementItem, type WallLike } from '../../shared/furniture-placement.js';

// 手抄 config/layout/model-geometry.yaml 的 w_gbath_east_open_vanity（与
// gbath-wall-datum.test.ts 的 WALLS 同源；本测试只关心来源互斥，不重复几何一致性断言）。
const VANITY_WALL: WallLike = { x1: 7.2, z1: 3.55, x2: 7.2, z2: 4.3 };
const SEGMENTS = new Map([['w_gbath_east_open_vanity', [VANITY_WALL]]]);

/** 已迁移形态的典型条目（guest_bath 镜柜，无 x/z）。 */
const migrated: PlacementItem = {
  type: 'mirror_cabinet_gbath',
  wall: 'w_gbath_east_open_vanity',
  wall_side: 'west',
  along: 0.405,
  rotation: 270,
};

describe('furniture placement 定位来源唯一性（issue #98 修复项 C）', () => {
  it('wall+along 对象同时写回绝对 x/z：诊断失败，placement 为 null', () => {
    const resolution = resolveFurniturePlacement(
      { ...migrated, x: 7.07, z: 3.955 },
      SEGMENTS,
    );
    assert.equal(resolution.placement, null, '双来源不得解出摆位');
    assert.match(
      resolution.diagnostic ?? '',
      /wall\/wall_side\/along 与绝对 x\/z 不得同时声明/,
      `诊断必须点名来源互斥，实得：${resolution.diagnostic ?? '(无)'}`,
    );
  });

  it('只写 x 或只写 z 同样算第二来源（hasAbsolute = 任一存在）', () => {
    for (const partial of [{ x: 7.07 }, { z: 3.955 }] as const) {
      const resolution = resolveFurniturePlacement({ ...migrated, ...partial }, SEGMENTS);
      assert.equal(resolution.placement, null, `单轴写回 ${JSON.stringify(partial)} 也必须被拦`);
      assert.match(resolution.diagnostic ?? '', /不得同时声明/);
    }
  });

  it('不完整墙锚 + 绝对坐标：来源互斥优先于齐全性检查（诊断更准）', () => {
    const resolution = resolveFurniturePlacement(
      { type: 'mirror_cabinet_gbath', wall: 'w_gbath_east_open_vanity', x: 7.07 },
      SEGMENTS,
    );
    assert.equal(resolution.placement, null);
    assert.match(resolution.diagnostic ?? '', /不得同时声明/);
  });

  it('迁移后形态（仅 wall+along，无 x/z）照常解出——守门只拦双声明，不拦迁移本身', () => {
    const resolution = resolveFurniturePlacement(migrated, SEGMENTS);
    assert.equal(resolution.diagnostic, undefined, `迁移后形态必须可解，实得诊断：${resolution.diagnostic ?? ''}`);
    assert.ok(resolution.placement);
    // 手算（与 gbath-wall-datum.test.ts 同值）：中心 x = 7.20 − 0.06(半墙厚) − 0.14/2 = 7.07；
    // along 0.405 → z = 3.55 + 0.405 = 3.955。
    assert.ok(Math.abs(resolution.placement.x - 7.07) < 1e-9);
    assert.ok(Math.abs(resolution.placement.z - 3.955) < 1e-9);
  });
});
