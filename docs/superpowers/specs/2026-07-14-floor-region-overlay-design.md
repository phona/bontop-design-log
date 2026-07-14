# 地板覆盖层：在 Overlay 中声明 floor_region

- 日期：2026-07-14
- 状态：已确认（待实施）
- 前置：`2026-07-14-dxf-overlay-rendering-design.md`（本 spec 是该架构原则在地板层的扩展）

## 背景与问题

当前 3D 地板由 `config/layout/cad-extracted.yaml` 里的房间矩形生成，代码在 `app/src/render/HouseScene.ts:219-231`：

```ts
const floorGeo = new THREE.PlaneGeometry(r.width, r.depth);
```

每个房间得到一个独立矩形地板。由于 CAD 提取的房间矩形之间存在缝隙、走道/过渡区未被任何房间包含，下方深色基础平面（`buildBase`）显露出来，造成视觉上地板没铺满。

## 架构原则

延续前置 spec 的铁律：

> **CAD 只出几何，overlay.yaml 出一切意图。代码只读、只执行，禁止推断。**

因此：

- 不通过墙线自动计算地面多边形（属于几何推断/意图猜测）。
- 新增 `floor_region` element type，由 `config/layout/overlay.yaml` 显式声明“哪里需要补地板”。
- 合并逻辑仍只执行机械规则：保留 DXF 段为 wall、追加 overlay 元素。

## 新增 Schema

在 `config/layout/overlay.yaml` 的 `elements` 数组中新增 `floor_region` 类型：

```yaml
version: 1

suppress: []

elements:
  - id: corridor_floor
    type: floor_region
    room: living_dining          # 可选：归属房间，用于未来按房间选材料
    points:                      # 多边形顶点，按顺序围成封闭区域，至少 3 个
      - {x: 0.63, z: -1.96}
      - {x: 3.08, z: -1.96}
      - {x: 3.08, z: -1.08}
      - {x: 0.63, z: -1.08}
    reason: "客餐厅与走廊过渡区，房间矩形未覆盖"
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一标识 |
| `type` | `'floor_region'` | 是 | 元素类型 |
| `points` | `{x: number, z: number}[]` | 是 | 多边形顶点，按顺序首尾闭合，≥ 3 个 |
| `room` | string | 否 | 归属房间 ID，未来用于按房间应用不同地砖 |
| `reason` | string | 否 | 声明动机，推荐填写 |

## 数据流改动

### shared/types.ts

在 `SceneElement` 判别联合中追加 `floor_region`：

```ts
export type SceneElement =
  | { type: 'wall'; id: string; x1: number; z1: number; x2: number; z2: number }
  | { type: 'curtain_run'; id: string; points: CurtainPoint[]; height: number; closed?: boolean }
  | { type: 'wall_run'; id: string; points: OverlayPoint[]; height: number }
  | { type: 'glass_infill'; id: string; room: string; wall: Side; center_offset: number; width: number; height: number; sill: number }
  | { type: 'floor_region'; id: string; points: OverlayPoint[]; room?: string };
```

### server/overlay-merge.ts

1. 新增 `FloorRegionSchema`：
   - `id`: string，min(1)
   - `type`: z.literal('floor_region')
   - `points`: `PointSchema` 数组，min(3)
   - `room`: string，optional
   - `reason`: string，optional
   - 所有对象 `.strict()`，未知字段/类型报错。
2. 把 `FloorRegionSchema` 加入 `OverlaySchema.elements` 的 `z.discriminatedUnion`。
3. `mergeSceneElements` 无需额外逻辑：floor_region 作为元素自动追加到输出数组末尾。

### app HouseScene.ts

在 `createRoom` 生成的房间矩形地板之外，遍历 `sceneElements` 中 `type === 'floor_region'` 的条目，调用新增 `renderFloorRegion`：

```ts
private renderFloorRegion(el: Extract<SceneElement, { type: 'floor_region' }>) {
  const shape = new THREE.Shape();
  shape.moveTo(el.points[0].x, el.points[0].z);
  for (let i = 1; i < el.points.length; i++) {
    shape.lineTo(el.points[i].x, el.points[i].z);
  }
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  const mat = new THREE.MeshStandardMaterial({
    color: DEFAULT_FLOOR,
    roughness: 0.75,
    metalness: 0.05,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.006; // 略高于房间矩形地板，避免 z-fighting
  mesh.userData = { objectId: `floor_region:${el.id}`, type: 'floor_region', roomId: el.room };
  mesh.receiveShadow = true;
  this.scene.add(mesh);
  this.floorMeshes.push(mesh);
}
```

要点：

- 使用 `THREE.ShapeGeometry` 支持任意多边形。
- y 高度 `0.006` 略高于房间地板 `0.005`，避免重叠时闪烁。
- 材质复用当前 `DEFAULT_FLOOR` 颜色；未来按房间/方案选地砖时统一遍历 `this.floorMeshes` 处理。

## 防回归护栏

1. **overlay-merge 测试**：
   - `floor_region` 至少 3 个点，否则 schema 校验失败。
   - `floor_region` 未知字段报错。
   - 未声明时场景输出中不包含 `floor_region`（即不自动补地板）。
2. **parse_cad_test.py**：
   - 继续保持 walls 字段白名单（x1/z1/x2/z2），不输出 floor 相关意图字段。
3. **HouseScene 测试**：
   - 传入一个 `floor_region` 后，场景中出现对应 mesh。
   - mesh 顶点与 `points` 一致。
   - mesh 的 `userData.type` 为 `'floor_region'`。

## 初版 overlay.yaml 增补内容

根据当前截图和 `cad-extracted.yaml` 核对，至少补充以下区域：

1. 客餐厅与走廊/其它房间的过渡缝隙。
2. 入户花园与室内衔接处（如需要铺砖）。
3. 其它 CAD 房间矩形未覆盖的走道区域。

具体坐标由人工对照修复后的 `cad-extracted.yaml` 和截图测量给出。

## 不在范围内

- 不自动从墙线计算地板多边形。
- 不删除/替换现有房间矩形地板（suppress 机制保持仅用于墙段）。
- 不改动地砖材质/纹理系统（`FloorTopic`、`TextureFactory`）。
- 不引入 `floor_region` 的圆弧或布尔运算（首期仅支持简单多边形）。
