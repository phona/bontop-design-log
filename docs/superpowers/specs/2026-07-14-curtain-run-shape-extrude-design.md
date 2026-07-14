# curtain_run 连续玻璃幕墙渲染方案

## 背景

当前 `curtain_run` 在 `app/src/render/HouseScene.ts` 中通过 `expandRoundedCorners` 把拐点展开成一段段折线，再用多个 `BoxGeometry` 薄面板逐个渲染。每段面板是一个独立 mesh，带有独立 `userData.objectId`。虽然功能正确，但几何生成不是 Three.js 的惯用方式，且产生大量 mesh。

## 目标

将 `curtain_run` 渲染改为：
- **连续整块玻璃幕墙**（一个 mesh）；
- **拐点使用 Three.js 原生圆弧**（`THREE.Shape.absarc`）；
- **保留配置驱动**：`overlay.yaml` 中的 `curtain_run.points` 及可选 `radius` 字段不变；
- **移除分段交互**：不再支持逐段 hover/选中（业务上幕墙为开发商封好，无需交互）。

## 设计

### 1. 几何语义

把 `curtain_run` 视为地面上的一条**有厚度折线**（墙厚 `GLASS_THICKNESS = 0.08m`），再沿 Y 轴向上挤出 `height` 米。

关键步骤：
1. 读取 `curtain_run.points` 得到中心线折线 `P₀, P₁, …, Pₙ`；
2. 对中心线做**双侧等距偏移**（offset = `GLASS_THICKNESS / 2`），得到外侧折线 `O` 和内侧折线 `I`；
3. 在带 `radius` 的拐点处，用 `THREE.Shape.absarc` 把外侧尖角替换为圆弧，内侧尖角替换为同心圆弧；
4. 沿 `O → 末端封口 → I → 起始封口 → O` 构建闭合 `THREE.Shape`；
5. 用 `ExtrudeGeometry` 一次性挤出，得到单一 mesh；
6. 设置 `userData = { type: 'curtain_run', objectId: el.id }`（单一 objectId）。

```
      O  ─────────────── O
      |                   |
   起点封口             终点封口
      |                   |
      I  ─────────────── I

侧视图：地面 Shape 向上挤出 height
```

### 2. 圆角处理

对于内部点 `Pᵢ`（`0 < i < n`），若存在 `radius > 0`：
- 计算相邻两段方向向量 `v₁ = Pᵢ - Pᵢ₋₁`、`v₂ = Pᵢ₊₁ - Pᵢ`；
- 计算夹角 `θ = acos(v₁·v₂ / |v₁||v₂|)`；
- 圆角切点到 `Pᵢ` 的距离 `d = r / tan(θ/2)`；
- 圆心到 `Pᵢ` 的距离 `c = r / sin(θ/2)`；
- 圆心位于路径转向侧（左拐时圆心在左侧，右拐时圆心在右侧）；
- 用 `THREE.Path.absarc(center.x, center.z, r, startAngle, endAngle, clockwise)` 绘制中心线圆弧。

约束：
- 若 `d` 超过任一邻边长度，则忽略该点的 `radius`（退化为尖角），避免圆弧越过邻边；
- 首尾点的 `radius` 忽略（开放路径无意义）。

### 2.1 中心线采样与边界 Shape

实现采用**中心线采样 + 法向偏移**生成 ribbon 边界：
1. 用 `THREE.Path` 构建中心线：先 `moveTo` 起点，然后逐段 `lineTo` 或 `absarc` 经过圆角；
2. 用 `path.getPoints(divisions)` 采样中心线，得到密集点列；
3. 每个采样点按局部切线法向左右各偏移 `T/2`（`T = GLASS_THICKNESS`），得到左边界 `L` 与右边界 `R`；
4. 开放路径：沿 `L → 端封口 → R → 端封口` 闭合；
5. 闭合路径：面积较大者为 `Shape` 外边界，面积较小者为 `Path` 内洞（内洞点序反向以符合 Three.js 约定）。

> 该方案用 `absarc` 生成中心线圆弧，再用采样偏移近似 ribbon 边界，避免复杂的同心圆弧偏移计算。对玻璃幕墙 8cm 厚度、0.8m 圆角等常见尺寸，近似误差可忽略。复杂自交路径不在本次范围。

### 3. 路径闭合与开放

`curtain_run` 既可以是开放路径（如 L 形幕墙），也可以是闭合路径（如玻璃盒）。

- **开放路径**：外侧折线 `O` 与内侧折线 `I` 在两端用直线段封口，形成闭合 `Shape`；
- **闭合路径**：`O` 与 `I` 在首尾相接，不额外封口。

判定方式：配置中新增可选字段 `closed: boolean`（默认 `false`）。对于目前 4 点玻璃幕墙，可显式声明 `closed: true`。

### 4. API / Schema 变更

`shared/types.ts` 中 `CurtainRun` 新增可选字段：

```typescript
export type CurtainRun = {
  type: 'curtain_run';
  id: string;
  points: CurtainPoint[];
  height: number;
  closed?: boolean; // 是否闭合路径
};
```

`server/overlay-merge.ts` 中 zod schema 同步增加 `.strict()` 下的 `closed: z.boolean().optional()`。

`overlay.yaml` 中玻璃幕墙示例：

```yaml
- id: glass_facade
  type: curtain_run
  closed: true
  height: 3.0
  points:
    - { x: 3.75, z: -4.32 }
    - { x: -5.88, z: -4.32, radius: 0.8 }
    - { x: -5.88, z: 5.39, radius: 0.8 }
    - { x: 3.75, z: 5.39 }
```

### 5. 替代方案

**方案 A（当前方案）**：保留 `expandRoundedCorners` + 分段 `BoxGeometry`。缺点：mesh 数量多，不是 Three.js 惯用圆角方式。

**方案 B（合并几何）**：保留插值逻辑，但把分段 `BoxGeometry` 合并成单一 `BufferGeometry`。优点：一个 mesh；缺点：仍是手动插值，不是原生圆弧。

**方案 C（推荐）**：`Shape` + `absarc` + `ExtrudeGeometry`。优点：原生圆角、连续单 mesh、draw call 少；缺点：需要实现 offset 曲线，首尾闭合需配置 `closed` 字段。

## 测试策略

1. `tests/server/overlay-merge.test.ts`：
   - 验证 `closed: true` 被接受并正确传递；
   - 验证 `closed` 为非法类型时被拒绝。

2. `app/src/scene/HouseScene.test.ts`：
   - 验证 `curtain_run` 渲染后 `scene.traverse` 中仅出现 1 个 `type === 'curtain_run'` 的 mesh；
   - 验证带 `radius` 的拐点处顶点数多于尖角（圆弧插值产生更多顶点）；
   - 验证 `closed: true` 时 mesh 顶点存在且连续。

3. 类型检查：`npm run typecheck` 通过。

## 依赖

- `THREE.Shape`
- `THREE.ExtrudeGeometry`
- `THREE.Path` / `Shape.absarc`

## 影响面

- 仅 `app/src/render/HouseScene.ts` 中 `renderCurtainRun` 及相关辅助函数；
- `shared/types.ts` 和 `server/overlay-merge.ts` 增加 `closed?: boolean`；
- `config/layout/overlay.yaml` 玻璃幕墙声明增加 `closed: true`；
- 删除 `expandRoundedCorners`、`roundCorner`、`isInsideCorner`、`polygonSignedArea` 等手动圆弧辅助函数。
