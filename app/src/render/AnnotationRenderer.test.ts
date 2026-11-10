import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

// ── 点位解算宽容读取（2026-11-10 issue #98「页面可显示问题并继续预览」）──
// 修前形态：planOf 解算失败且无声明坐标时 throw → load() 抛 → App.refreshInfrastructure 中断
// → 页面初始化 / 阶段切换整页失败。疗法①（PR #162）删掉 (0,0) 回落是对的（不许给假坐标），
// 但「不画」换成了「整页炸」：标注层不是施工依据，权威判定在 verify 与正式导出（那里仍
// fail-closed），页面按 issue #98 要求宽容读取——**跳过该点 + 诊断点名 + 其余照常**。
// 三条不许回退：不许回落 (0,0)、不许静默少画、不许 throw 中断建场。
describe('AnnotationRenderer 宽容读取：解算失败跳过该点并显形', () => {
  // 图标/标签走 canvas 2D（icons.ts makeSprite + createLabel）；jsdom 无 canvas 实现。
  let getContext: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(makeCanvasContext());
  });
  afterEach(() => {
    getContext.mockRestore();
  });

  const makeRenderer = (): AnnotationRenderer => {
    const scene = new THREE.Scene();
    const viewOnlyRoot = new THREE.Group();
    viewOnlyRoot.name = 'HOUSE_VIEW_ONLY';
    scene.add(viewOnlyRoot);
    return new AnnotationRenderer(scene, new THREE.PerspectiveCamera(), viewOnlyRoot);
  };

  const silenceConsole = () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const restore = () => { error.mockRestore(); warn.mockRestore(); log.mockRestore(); };
    return { error, restore };
  };

  it('skips instead of returning the origin, and names the point + index sizes in its diagnostics', () => {
    // 不注入 pointWalls：等价于调用点漏 setPointWalls（宿主墙断引用同理）。
    const { error, restore } = silenceConsole();
    try {
      const renderer = makeRenderer();
      const plan = (renderer as any).planOf({
        id: 'night_wall', room: 'corridor', type: 'night_light', height: 0.3,
        wall: 'w_missing', wall_side: 'north', along: 1.2,
      }, 'electrical');
      // 绝不回落 (0,0)：解算失败就没有坐标。
      expect(plan.kind).toBe('skipped');
      expect(plan).not.toHaveProperty('x');
      expect(plan).not.toHaveProperty('z');
      const diagnostics = renderer.getPlacementDiagnostics();
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({ category: 'electrical', pointId: 'night_wall' });
      // 原 throw 文案的点名信息保留：宿主墙 + 索引尺寸（宿主索引未注入 / 断引用的区分线索）。
      expect(diagnostics[0].reason).toMatch(/w_missing/);
      expect(diagnostics[0].reason).toMatch(/pointWalls=0 mountHosts=0/);
      // 显形：console.error 当场出声，不是静默少画。
      expect(error).toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('skips a mount point whose host is absent from the injected index and names the host', () => {
    // 索引注入了但宿主不在表里（断引用 / 被阶段过滤）：真实声明 night_corridor 挂
    // ld.wall_cabinet_tall（config/electrical.yaml:1516 → config/house.yaml:516）。
    const { restore } = silenceConsole();
    try {
      const renderer = makeRenderer();
      renderer.setMountHosts(new Map());
      const plan = (renderer as any).planOf({
        id: 'night_corridor', room: 'corridor', type: 'night_light', height: 0.3,
        mount: { furniture_id: 'ld.wall_cabinet_tall', face: 'north', along: 0.25 },
      }, 'electrical');
      expect(plan.kind).toBe('skipped');
      const [diagnostic] = renderer.getPlacementDiagnostics();
      expect(diagnostic.pointId).toBe('night_corridor');
      expect(diagnostic.reason).toMatch(/ld\.wall_cabinet_tall/);
    } finally {
      restore();
    }
  });

  it('still falls back to declared coordinates when the point carries them', () => {
    // 回落声明坐标这条老路保留（仅剩带 x/z 的绝对点位走），但解算失败会留告警；
    // 没有坐标可回落时不允许伪造原点（上一用例）。
    const { restore } = silenceConsole();
    try {
      const renderer = makeRenderer();
      expect((renderer as any).planOf({
        id: 'abs_point', room: 'kitchen', type: 'socket', height: 1.3,
        x: 1.5, z: 2.5, wall: 'w_missing', wall_side: 'north', along: 9,
      }, 'electrical')).toEqual({ kind: 'placed', x: 1.5, z: 2.5 });
      expect(renderer.getPlacementDiagnostics()).toEqual([]);
    } finally {
      restore();
    }
  });

  it('load() 不抛：断引用点位无标注、其余点位照常、诊断点名该点（页面初始化不中断）', async () => {
    const { restore } = silenceConsole();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: unknown) => {
      const url = String(input);
      const body = url.endsWith('/api/annotations/electrical')
        ? [
            // 好的沿墙点位：w_corridor 已注入 + line_datum 齐备 → 解算成功、照常画。
            { id: 'night_wall_ok', room: 'corridor', type: 'night_light', height: 0.3, wall: 'w_corridor', wall_side: 'north', along: 1 },
            // 坏点：宿主墙断引用（索引里没有 w_missing）→ 修前在这里 throw 中断 load()。
            { id: 'night_wall_broken', room: 'corridor', type: 'night_light', height: 0.3, wall: 'w_missing', wall_side: 'north', along: 1.2 },
          ]
        : [];
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    }) as typeof fetch);
    try {
      const renderer = makeRenderer();
      renderer.setPointWalls(new Map([['w_corridor', {
        segments: [{ x1: 7, z1: 5.5, x2: 9, z2: 5.5 }],
        line_datum: 'centerline',
      }]]));

      await expect(renderer.load()).resolves.toBeUndefined();

      const electricalLayer = (renderer as any).layerGroups.electrical as THREE.Group;
      expect(electricalLayer.children.map((child) => child.userData.pointId)).toEqual(['night_wall_ok']);
      expect(renderer.getPlacementDiagnostics()).toHaveLength(1);
      expect(renderer.getPlacementDiagnostics()[0]).toMatchObject({
        category: 'electrical',
        pointId: 'night_wall_broken',
      });

      // ProblemDetector 同一宽容口径：不抛、坏点不进检测器、诊断不重复登记。
      expect(() => renderer.detectProblems([], [])).not.toThrow();
      expect(renderer.getPlacementDiagnostics()).toHaveLength(1);
    } finally {
      fetchSpy.mockRestore();
      restore();
    }
  });
});
