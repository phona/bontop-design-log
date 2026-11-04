/**
 * 高亮态的分层簿记（issue #66，2026-11-04）。
 *
 * 背景：3D 高亮靠改材质 emissive（房间/墙/管线，highlightObjects / highlightObject）或
 * 合批实例色（电气点位，highlightPoints 的 BatchedMesh.setColorAt）实现。这两处状态是
 * **跨系统共享**的：审批包高亮（App.highlightApprovalPackage，跳转场景 6000ms）、
 * StateSync 的 highlight_object（MEP 协调路线，1200ms）、点位级高亮可以同时亮同一个
 * 材质；灯具外观（InteriorLightingSystem.applyAppearance 的 material.emissive.copy）
 * 与家具碰撞检查（AnalysisTools.checkFurnitureCollisions 的 setHex(0xff0000)）更是不
 * 经过高亮簿记的直接写入方。旧实现按「递增令牌 + 首次捕获原色」只防住了**同一路径内**
 * 的连点竞态，跨路径/跨系统仍互相覆盖，典型死法两种：
 *   ① 后到的高亮把先到者留下的橙色当原色捕获 → 到期写回橙色 → 材质永久卡橙；
 *   ② 窗口内外来系统改了 emissive → 高亮到期时把捕获的原色写回 → 人家的当前值被静默吞掉
 *      （灯具变色被复原、碰撞红色被擦掉，而灯具/碰撞系统自己并不知道）。
 * 「去 3D 看这包」把窗口从 1200ms 拉到 6000ms 只是放大了碰撞面，根因是共享可变状态
 * 没有归属簿记。
 *
 * 方案评估（2026-11-04）：候选两条——
 *   (a) 长窗口高亮改走独立渲染通道（另起 overlay/outline，不与材质态混用）；
 *   (b) 引用计数/分层令牌：同一突变目标上多个高亮按层叠加，到期逐层回落。
 * 选 (b)。理由：独立通道要新拉一套渲染管线（本仓按需渲染 + renderQueued 门控、玻璃
 * 禁 transmission 等性能铁律都在渲染主链上，叠加通道的可见性/深度/性能面全是新的未知），
 * 且它同样需要为自己的 overlay 解决分层问题，并没有消掉簿记需求；而两类失效全是簿记
 * 失效（捕获时机、恢复归属），在本模块一次修掉，四条高亮路径（highlightObjects、
 * highlightObject、highlightPoints 合批/未合批）共用一套纪律，视觉语言不变。
 *
 * 三条纪律（全部有回归测试钉住，见 HouseScene.test.ts「高亮分层叠加」组）：
 *   ① 捕获一次：层栈 0→1 时捕获真实原色，后续 acquire 只压层不捕获——绝不把别人
 *      留下的橙当原色；
 *   ② 叠加不覆盖：任一层到期只回落到下一个仍活跃的层；层栈空才谈恢复。短窗口到期
 *      不会掐断长窗口（6000ms 包高亮窗口内的 1200ms 系统高亮到期后仍然亮着）；
 *   ③ 外来写入让笔：恢复前校验当前值仍等于本方最后写入的颜色（按槽的实际存储精度
 *      比较——合批实例色经 three BatchedMesh 的 Float32Array 往返，容差 1e-6）；
 *      被没走高亮簿记的系统改过就 leave-as-is——恢复动作不覆盖人家的当前值。
 */
import * as THREE from 'three';

/** 四条高亮路径共用的橙色（0xffaa00）。 */
export const HIGHLIGHT_EMISSIVE = 0xffaa00;

/**
 * 白色 = three BatchedMesh 颜色纹理懒初始化时的真实默认原色（_initColorsTexture 以
 * 全 1 白色填充，且 SceneBatcher 从不 setColorAt，真实批次的实例色恒从白起步）。
 * 实例色读不到时（getColorAt 抛 TypeError / 返回 null）原色按白色兜底。
 */
const DEFAULT_INSTANCE_COLOR = new THREE.Color(1, 1, 1);

/**
 * 一个突变目标的读写槽：材质实例（emissive）或合批实例（setColorAt 实例色）。
 * get() 返回 null = 读不到当前值（实例未激活/纹理未初始化）——**不是**某个具体颜色：
 * 调用方按「无法证明被改写，仍持有笔」处理，保持旧的恢复行为。
 */
export interface ColorSlot {
  get(): THREE.Color | null;
  set(color: THREE.Color): void;
}

interface HighlightLayer {
  readonly color: THREE.Color;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * 颜色相等按 **Float32 容差**判定，不是严格 ===（2026-11-04 codex 审查 blocking 修）：
 * 合批实例色的真实存储精度就是 Float32——three r166 的 BatchedMesh.setColorAt 把颜色
 * `color.toArray` 写进 _colorsTexture 的 Float32Array（_initColorsTexture 以全 1 白色
 * 填充），getColorAt 再 `color.fromArray` 读回：0.4019777798321958 → 0.4019777774810791。
 * 严格比较下**没有任何外来写入时 holdsPen() 也返回 false** → release 跳过恢复并清空
 * 原色 → 一次高亮到期后合批实例仍为橙色；且再次高亮会把残留的橙色当原色捕获（越污染
 * 越错）。容差 1e-6：Float32 在 [0,1] 区间最大舍入误差约 6e-8，留两个数量级余量；
 * 材质 emissive 侧是真双精度，容差对它无害（外来写入 0xff0000 vs 本方 0xffaa00 差异
 * 远大于此，让笔判定不受影响）。
 */
const COLOR_EPSILON = 1e-6;

const colorsEqual = (a: THREE.Color, b: THREE.Color): boolean =>
  Math.abs(a.r - b.r) <= COLOR_EPSILON
  && Math.abs(a.g - b.g) <= COLOR_EPSILON
  && Math.abs(a.b - b.b) <= COLOR_EPSILON;

/**
 * 一个突变目标（一个材质实例 / 一个合批实例）上的高亮层栈。
 * 每个 acquire = 压一层（一次 durationMs 后自动释放）；层栈即引用计数。
 */
export class HighlightLayers {
  /** 层栈 0→1 时捕获的真实原色；层栈空即清空（下次现场变化重新捕获）。 */
  private original: THREE.Color | null = null;
  /** 本方最后一次写进目标的值——「是否还持有笔」的基准。 */
  private lastWritten: THREE.Color | null = null;
  private readonly layers: HighlightLayer[] = [];

  constructor(
    private readonly slot: ColorSlot,
    private readonly onChange?: () => void,
    private readonly onEmpty?: () => void,
  ) {}

  acquire(color: THREE.Color, durationMs: number): void {
    const first = this.layers.length === 0;
    if (first) {
      // 纪律①：只有首层捕获原色。读不到（合批实例纹理未初始化）按白色兜底。
      this.original = (this.slot.get() ?? DEFAULT_INSTANCE_COLOR).clone();
    }
    // 闭包自引用本层：到期时按身份从栈里摘除（同层只会触发一次）
    const layer: HighlightLayer = {
      color: color.clone(),
      timer: setTimeout(() => this.release(layer), durationMs),
    };
    this.layers.push(layer);
    // 首层必然落色（同时取得笔）；后续层只有仍持有笔才落色——外来系统持笔时
    // 本层只挂钟不画，绝不覆盖人家的值。
    if (first || this.holdsPen()) this.paint(color);
  }

  private release(layer: HighlightLayer): void {
    const index = this.layers.indexOf(layer);
    if (index < 0) return; // 过期/重复触发：本层已不在栈里（dispose 清过或同层已释放）
    this.layers.splice(index, 1);
    if (this.layers.length > 0) {
      // 纪律②：叠加——回落到下一个仍活跃的层（同色时是无害重写，异色时是真正接管）。
      // 只有仍持有笔才写；笔丢了（外来系统改过）就静静等本栈空。
      if (this.holdsPen()) this.paint(this.layers[this.layers.length - 1].color);
      return;
    }
    // 纪律③：层栈空，仍持有笔才恢复原色；笔已被外来系统拿走就 leave-as-is。
    if (this.original && this.holdsPen()) {
      this.slot.set(this.original);
      // 共享引用即可：随后两者一起清空，没有别处再写它们
      this.lastWritten = this.original;
      this.onChange?.();
    }
    this.original = null;
    this.lastWritten = null;
    this.onEmpty?.();
  }

  private paint(color: THREE.Color): void {
    this.slot.set(color);
    this.lastWritten = color.clone();
    this.onChange?.();
  }

  /** 当前值仍等于本方最后写入的颜色 = 还持有笔。读不到（null）= 无法证明被改写，按持有笔处理。 */
  private holdsPen(): boolean {
    if (!this.lastWritten) return false;
    const current = this.slot.get();
    if (!current) return true;
    return colorsEqual(current, this.lastWritten);
  }

  /**
   * 场景整体拆除：清掉所有未触发定时器。不再写任何材质/实例色——都在销毁中，
   * 无所谓恢复（恢复反而可能写进已 dispose 的批次纹理）。
   */
  dispose(): void {
    for (const layer of this.layers) clearTimeout(layer.timer);
    this.layers.length = 0;
    this.original = null;
    this.lastWritten = null;
  }
}

/**
 * 全场景高亮簿记：材质实例与合批实例两张 WeakMap（实例维度各自成栈），外加一张
 * 强引用 Set 只为 dispose 时能遍历到所有活栈（层栈空即从 Set 移除，不泄漏）。
 */
export class HighlightStack {
  private readonly materialLayers = new WeakMap<THREE.Material, HighlightLayers>();
  private readonly instanceLayers = new WeakMap<THREE.BatchedMesh, Map<number, HighlightLayers>>();
  private readonly live = new Set<HighlightLayers>();

  constructor(private readonly onChange?: () => void) {}

  /** 材质 emissive 高亮（highlightObjects / highlightObject / 未合批点位兜底共用）。 */
  acquireMaterial(material: THREE.Material, color: THREE.Color, durationMs: number): void {
    let layers = this.materialLayers.get(material);
    if (!layers) {
      const mat = material as THREE.MeshStandardMaterial;
      layers = this.create({
        get: () => mat.emissive ?? null,
        set: (c) => { mat.emissive?.copy(c); },
      });
      this.materialLayers.set(material, layers);
    }
    this.activate(layers, color, durationMs);
  }

  /** 合批实例色高亮（highlightPoints 的 BatchedMesh 路径）。 */
  acquireInstance(batch: THREE.BatchedMesh, instanceId: number, color: THREE.Color, durationMs: number): void {
    let perInstance = this.instanceLayers.get(batch);
    if (!perInstance) {
      perInstance = new Map<number, HighlightLayers>();
      this.instanceLayers.set(batch, perInstance);
    }
    let layers = perInstance.get(instanceId);
    if (!layers) {
      layers = this.create({
        // 真 three r166：纹理未初始化时 getColorAt 直接读 null.image 抛 TypeError；
        // 实例未激活/越界返回 null。两者都返回 null（读不到），白色兜底在上层捕获原色时做。
        get: () => readBatchInstanceColor(batch, instanceId),
        set: (c) => { batch.setColorAt(instanceId, c); },
      });
      perInstance.set(instanceId, layers);
    }
    this.activate(layers, color, durationMs);
  }

  /**
   * 激活一层栈（创建或复用都走这里）：**每次激活都恢复 live 登记**（2026-11-04 codex
   * 审查 minor 修）。层栈首次到期后 onEmpty 会把它从 live 移除（live 只是 dispose 的
   * 遍历清单，层栈空即移出不泄漏），但 materialLayers / instanceLayers 仍缓存该对象；
   * 之后同一目标再次高亮复用它时若不加回 live，dispose() 就遍历不到 → 第二轮定时器在
   * dispose 后残留，到期仍写材质/实例色并触发已销毁场景的 requestRender。
   */
  private activate(layers: HighlightLayers, color: THREE.Color, durationMs: number): void {
    this.live.add(layers);
    layers.acquire(color, durationMs);
  }

  private create(slot: ColorSlot): HighlightLayers {
    const layers = new HighlightLayers(slot, this.onChange, () => this.live.delete(layers));
    return layers;
  }

  dispose(): void {
    for (const layers of this.live) layers.dispose();
    this.live.clear();
  }
}

/**
 * BatchedMesh 实例色的 fail-safe 裸读（2026-11-02 评审 P0-1 的 captureBatchInstanceColor
 * 拆成「裸读」与「白色兜底」两半，兜底移入 HighlightLayers 捕获原色处）。three r166 的
 * getColorAt 直接读 _colorsTexture.image.data，而 _colorsTexture 只在 setColorAt 首次
 * 调用时懒初始化（_initColorsTexture 以**全 1 白色**填充）；本仓 SceneBatcher 从不
 * setColorAt，真实批次的颜色纹理恒为 null——未兜底的读取第一个命中的实例就抛
 * TypeError，traverse 中断、一个实例都点不亮，异常还被 App 的「高亮失败不打断审批流」
 * catch 静默吞掉。禁止调私有 _initColorsTexture，禁止先 setColorAt 写一遍（那会多一次
 * 纹理上传且语义别扭）。
 *
 * captured 预填白色：纹理已存在但该实例从未被写过时，真 three 读到的就是懒初始化填充的
 * 白色（不是黑）——预填值与真 three 同口径（测试 mock 对无记录实例不回写，结果因此一致）。
 *
 * @returns 真实实例色；纹理未初始化 / 返回 null / 非有限值一律 null（= 读不到）。
 */
export function readBatchInstanceColor(batch: THREE.BatchedMesh, instanceId: number): THREE.Color | null {
  const captured = new THREE.Color(1, 1, 1);
  try {
    // @types/three 把返回值声明成 void，真 three r166 对未激活/越界实例返回 null；
    // 用 unknown 接住再判空，避免把「返回值」当成可用事实
    const returned: unknown = batch.getColorAt(instanceId, captured);
    if (returned !== null && returned !== undefined
      && Number.isFinite(captured.r) && Number.isFinite(captured.g) && Number.isFinite(captured.b)) {
      return captured;
    }
  } catch {
    // 颜色纹理未初始化（见上）：读不到
  }
  return null;
}
