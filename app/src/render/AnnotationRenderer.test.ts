import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { AnnotationRenderer } from './annotations/AnnotationRenderer';

function makeCanvasContext(): CanvasRenderingContext2D {
  return {
    fillStyle: '',
    font: '',
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe('AnnotationRenderer ceiling object ids', () => {
  it('tags ceiling zone indicators and AC icons as ceiling annotations', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(makeCanvasContext());
    try {
      const scene = new THREE.Scene();
      const viewOnlyRoot = new THREE.Group();
      viewOnlyRoot.name = 'HOUSE_VIEW_ONLY';
      scene.add(viewOnlyRoot);
      const renderer = new AnnotationRenderer(scene, new THREE.PerspectiveCamera(), viewOnlyRoot);
      (renderer as any).renderCeiling([
        { id: 'ceiling_entry_foyer', room: 'entry_garden', type: 'drop', area: [10, 2, 12, 4], thickness: 0.3 },
        { id: 'ac_entry', room: 'entry_garden', type: 'ac_indoor', x: 11, z: 3, height: 2.85 },
      ]);

      const ceilingLayer = (renderer as any).layerGroups.ceiling as THREE.Group;
      expect(ceilingLayer.children.map((child) => child.userData)).toEqual([
        expect.objectContaining({
          type: 'annotation',
          category: 'ceiling',
          objectId: 'ceiling:ceiling_entry_foyer',
        }),
        expect.objectContaining({
          type: 'annotation',
          category: 'ceiling',
          objectId: 'ceiling:ac_entry',
        }),
      ]);
      expect(ceilingLayer.children.every((child) => child.userData.type !== 'lighting_fixture')).toBe(true);
      expect((renderer as any).group.parent).toBe(viewOnlyRoot);
      expect(scene.children).not.toContain((renderer as any).group);
    } finally {
      getContext.mockRestore();
    }
  });
});

// ── 点位解算 fail-closed（2026-11-09 issue #98 疗法①，Codex 第 16 轮 blocking）──
// 失效形态：planOf 解算失败且无声明坐标时回落 (0,0) → 阶段切换/异常恢复两条重建路径若漏
// 注入索引，全部标注静默聚到原点、界面无任何异常。x/z 声明已在第四阶段 S3 删光，该路径必现。
describe('AnnotationRenderer point placement fail-closed', () => {
  const makeRenderer = (): AnnotationRenderer => {
    const scene = new THREE.Scene();
    const viewOnlyRoot = new THREE.Group();
    viewOnlyRoot.name = 'HOUSE_VIEW_ONLY';
    scene.add(viewOnlyRoot);
    return new AnnotationRenderer(scene, new THREE.PerspectiveCamera(), viewOnlyRoot);
  };

  it('throws instead of returning the origin when resolution fails without declared coordinates', () => {
    // 不注入 pointWalls：等价于调用点漏 setPointWalls（宿主墙断引用同理）。
    const renderer = makeRenderer();
    expect(() => (renderer as any).planOf({
      id: 'night_wall', room: 'corridor', type: 'night_light', height: 0.3,
      wall: 'w_missing', wall_side: 'north', along: 1.2,
    })).toThrow(/拒绝回落原点/);
  });

  it('throws for a mount point whose host is absent from the injected index', () => {
    // 索引注入了但宿主不在表里（断引用 / 被阶段过滤）：night_corridor 挂
    // ld.wall_cabinet_tall，一期排除该柜——宿主表必须全量，否则这里炸。
    const renderer = makeRenderer();
    renderer.setMountHosts(new Map());
    expect(() => (renderer as any).planOf({
      id: 'night_corridor', room: 'corridor', type: 'night_light', height: 0.3,
      mount: { furniture_id: 'ld.wall_cabinet_tall', face: 'north', along: 0.25 },
    })).toThrow(/拒绝回落原点/);
  });

  it('still falls back to declared coordinates when the point carries them', () => {
    // 回落声明坐标这条老路保留（仅剩带 x/z 的点位走），但解算失败会留告警；
    // 没有坐标可回落时不允许伪造原点。
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const renderer = makeRenderer();
      expect((renderer as any).planOf({
        id: 'abs_point', room: 'kitchen', type: 'socket', height: 1.3,
        x: 1.5, z: 2.5, wall: 'w_missing', wall_side: 'north', along: 9,
      })).toEqual({ x: 1.5, z: 2.5 });
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
