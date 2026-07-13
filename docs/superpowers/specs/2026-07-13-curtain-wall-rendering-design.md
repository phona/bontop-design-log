# 3D 渲染玻璃幕墙

**日期**: 2026-07-13  
**状态**: 待实现

## 问题

当前所有墙段都渲染为不透明灰白色盒子（`DEFAULT_PAINT`, `roughness: 0.85`），无法区分玻璃幕墙和普通墙体。配置数据（`house.yaml` 的 `curtain_wall_corners`、`materials.yaml` 的 `curtain_wall_01`）已记录了幕墙信息，但渲染代码完全未使用。

## 设计思路

CAD 是主数据源，配置做微调。幕墙标记在解析阶段自动完成，渲染阶段只读数据。

## 方案

### 1. 数据层：`cad-extracted.yaml` 墙段增加 `curtain` 字段

```yaml
walls:
  - x1: -5.88
    z1: 4.872
    x2: -5.854
    z2: 4.933
    curtain: true   # 玻璃幕墙
  - x1: 8.542
    z1: 4.45
    x2: 8.542
    z2: 4.21
    # 无 curtain 字段 = 普通墙体（向后兼容）
```

`curtain` 为可选字段，缺失时视为普通墙体。

### 2. 解析层：`parse_cad.py` 自动标记幕墙

在 `extract_walls()` 或新增后处理函数中，根据以下规则标记：

**幕墙范围**（由 `house.yaml` 的 `curtain_wall_corners` + 建筑轮廓推断）：
- **西墙** (x ≈ -5.88)：所有墙段 → `curtain: true`
- **北墙** (z ≈ 5.39)：所有墙段 → `curtain: true`
- **南墙** (z ≈ -4.32)：除入户花园段（x > 3.5）外 → `curtain: true`
- **东墙** (x ≈ 8.54) + 入户花园外围 → 不标记（承重墙/设备平台）

**标记逻辑**：
1. 计算建筑轮廓边界（所有墙段的 x/z 极值）
2. 对每个墙段，判断是否位于边界上
3. 如果在边界上，根据方位和位置判断是否属于幕墙范围
4. 南墙需排除入户花园区域（x > 3.5 且 z < -2）

### 3. 渲染层：`HouseScene.ts` 使用半透明玻璃材质

```typescript
const CURTAIN_WALL_COLOR = 0x88ccff;
const CURTAIN_WALL_OPACITY = 0.3;

const curtainWallMat = new THREE.MeshPhysicalMaterial({
  color: CURTAIN_WALL_COLOR,
  transparent: true,
  opacity: CURTAIN_WALL_OPACITY,
  roughness: 0.05,
  metalness: 0.1,
  side: THREE.DoubleSide,
});
```

`createWalls()` 根据 `wall.curtain` 字段选择材质：
- `curtain: true` → 半透明玻璃材质
- 否则 → 现有不透明灰白材质

### 4. 类型定义：`shared/types.ts`

```typescript
export interface WallSegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  curtain?: boolean;  // 可选，玻璃幕墙标记
}
```

## 影响范围

| 文件 | 改动 |
|------|------|
| `scripts/parse_cad.py` | 新增幕墙标记逻辑（后处理函数） |
| `config/layout/cad-extracted.yaml` | 重新生成，带 `curtain` 字段 |
| `app/src/render/HouseScene.ts` | `createWalls()` 支持玻璃材质 |
| `shared/types.ts` | `WallSegment` 增加可选 `curtain` 字段 |

## 验证

1. 重新运行 `parse_cad.py`，检查 `cad-extracted.yaml` 中幕墙墙段有 `curtain: true`
2. 3D 场景中玻璃幕墙显示为半透明浅蓝色
3. 普通墙体保持不透明灰白色
4. 东墙（书房/入户花园）保持普通墙体
5. 所有测试通过
