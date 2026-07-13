# 配置驱动架构改造

**日期**: 2026-07-13  
**状态**: 待实现

## 问题

代码中 12 处硬编码列表和算法猜测，根本原因是 `house.yaml` 作为外挂配置数据源没有被充分读取。CAD 解析器和渲染器用启发式算法猜测设计意图，而不是从配置中读取。

## 核心原则

**CAD 只出几何，house.yaml 出一切意图。代码不猜，只读。**

## 数据流（改造后）

```
DXF (纯几何) → parse_cad.py → cad-extracted.yaml (只有坐标)
                                    ↓
house.yaml (权威配置) ────→ Server 合并 → Client 读取
```

## house.yaml 新增字段

### 房间级别

```yaml
rooms:
  - id: "master_bath"
    wall_finish: "tile"        # 墙面材质（paint/tile）
    needs_waterproof: true     # 是否湿区
    openings:                  # 结构化开口
      - type: "window"
        wall: "north"
        width: 0.60
        height: 1.00
        center_offset: 0.0
```

### 材料级别

```yaml
materials:
  - id: "floor_tile_01"
    topic_id: "floor"          # 直接映射到话题
```

### 幕墙边界

```yaml
curtain_walls:
  - edge: "west"               # x = min_x
  - edge: "north"              # z = max_z
  - edge: "south"              # z = min_z
    max_x: 3.5                 # 排除入户花园
```

### 房间标签格式

CAD 里所有房间标签必须标注 ID：

```
master_bedroom^J主卧^J面积18.16m²
master_bath^J卫生间^J面积4.20m²
```

代码直接读 ID，不做中文名→ID 的映射。

### 赠送区域位置

```yaml
gift_areas:
  - id: "south_balcony"
    expected_centroid:
      x: 3.19
      z: 3.06
```

## 代码改动

| 文件 | 改动 | 删除的硬编码 |
|------|------|-------------|
| `parse_cad.py` | 读 `curtain_walls`、`gift_areas.expected_centroid` | `chinese_name_to_id()` 完全删除、`mark_curtain_walls()` 边界检测、`_flood_fill_rooms()` 坐标猜测 |
| `PaintTopic.ts` | 读 `room.wall_finish` | `EXCLUDE_PAINT` 列表 |
| `WallTopic.ts` | 读 `room.wall_finish` | `WALL_ROOMS` 列表 |
| `budget-calculator.ts` | 读 `room.needs_waterproof` | 湿区列表 |
| `HouseScene.ts` | 读 `room.openings` | 开口标记硬编码 |
| `project-catalog.ts` | 读 `material.topic_id` | `MATERIAL_TOPIC_MAP` |
| `HvacTopic.ts` | 用 `catalog.getPlatform()` | `PLATFORM_ROOM_ID` |

## 影响范围

- `config/house.yaml`：加 ~20 行字段
- `config/materials.yaml`：每个材料加 `topic_id`
- `scripts/parse_cad.py`：删除 ~100 行启发式代码，加 ~50 行配置读取
- `app/src/topics/PaintTopic.ts`：改 1 行
- `app/src/topics/WallTopic.ts`：改 1 行
- `app/src/topics/HvacTopic.ts`：改 1 行
- `app/src/render/HouseScene.ts`：改 ~10 行
- `server/budget-calculator.ts`：改 ~5 行
- `server/project-catalog.ts`：改 ~5 行

## 验证

1. 所有 Topic 从配置读取房间列表，无硬编码
2. CAD 解析器不猜测房间 ID、幕墙、未标注区域
3. CAD 里所有房间标签都标注 ID（`id^J中文名^J面积` 格式）
4. 预算计算器从配置读取湿区
5. 渲染器从配置读取开口标记
6. 所有测试通过
