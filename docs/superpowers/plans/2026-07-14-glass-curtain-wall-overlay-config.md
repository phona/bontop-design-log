# 玻璃幕墙 Overlay 配置校准 - 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `config/layout/overlay.yaml` 的玻璃幕墙从 4 点简化版 + 圆角改为 7 点折线精确匹配 DXF 几何，并补入 5 个 suppress 区域移除被替换的外墙段。

**Architecture:** 纯配置变更。`server/overlay-merge.ts` 的 schema 已支持无 `radius` 的 curtain_run 点和 suppress 区域，无需代码改动。7 点折线用显式坐标替代 `radius` 圆角，suppress 通过中点包含检查移除 DXF 墙段。

**Tech Stack:** YAML, Node.js (zod 解析), pytest (回归)

## Global Constraints

- 仅修改 `config/layout/overlay.yaml`，不涉及代码变更
- suppress 区域只通过中点包含检查生效，不依赖几何启发式
- 入户花园（x>3.745）的墙体保持为实墙，不被 suppress 覆盖

---

### Task 1: 更新 overlay.yaml

**Files:**
- Modify: `config/layout/overlay.yaml`（全文替换）

**Interfaces:**
- Consumes: `server/overlay-merge.ts` 中的 `CurtainPointSchema`（`radius` 为可选字段）、`SuppressSchema`
- Produces: 有效的 `OverlayConfig` 对象，通过 zod strict 校验

- [ ] **Step 1: 替换整个 overlay.yaml 内容**

将当前文件内容替换为：

```yaml
# 场景覆盖层：DXF 表达不了/画错的信息在此声明。
# 铁律：这里声明什么就渲染什么；不声明的 DXF 墙永远是实墙。
# schema 见 server/overlay-merge.ts（zod strict，未知字段/类型直接报错）。
version: 1

suppress:
  - id: suppress_south_wall
    region: {x1: -1.2, z1: -4.5, x2: 3.9, z2: -4.1}
    reason: "南外墙改玻璃幕墙"
  - id: suppress_sw_corner
    region: {x1: -6.0, z1: -3.5, x2: -5.0, z2: -2.9}
    reason: "SW 圆角改玻璃幕墙"
  - id: suppress_west_wall
    region: {x1: -6.0, z1: -3.0, x2: -5.7, z2: 4.9}
    reason: "西外墙改玻璃幕墙"
  - id: suppress_nw_corner
    region: {x1: -6.0, z1: 4.8, x2: -5.0, z2: 5.5}
    reason: "NW 圆角改玻璃幕墙"
  - id: suppress_north_wall
    region: {x1: -5.5, z1: 5.2, x2: 3.9, z2: 5.5}
    reason: "北外墙改玻璃幕墙（入户花园以西）"

elements:
  # 玻璃幕墙立面：南 → S拐角 → SW斜面 → 西 → NW斜面 → 北（至入户花园西边界）。
  - id: glass_facade
    type: curtain_run
    points:
      - {x: 3.745, z: -4.323}
      - {x: -0.578, z: -4.323}
      - {x: -5.75, z: -3.17}
      - {x: -5.88, z: -2.99}
      - {x: -5.88, z: 4.872}
      - {x: -5.363, z: 5.39}
      - {x: 3.745, z: 5.39}
    height: 3.0

  # 窗洞玻璃填充（源自 house.yaml rooms[].openings 中 type=window 的条目）
  - id: living_south_glass
    type: glass_infill
    room: living_dining
    wall: south
    center_offset: 0
    width: 3.5
    height: 1.6
    sill: 0.9
```

- [ ] **Step 2: Commit**

```bash
git add config/layout/overlay.yaml
git commit -m "feat: update glass_facade to 7-point polyline with 5 suppress regions"
```

---

### Task 2: 运行验证

**Files:**
- 无文件变更（验证任务）

- [ ] **Step 1: 运行 overlay-merge 单元测试**

```bash
npm run test:server
```

预期：全部通过。`parseOverlay` 测试已验证无 `radius` 的 curtain_run 点可被解析；`mergeSceneElements` 测试已验证 suppress 逻辑。

- [ ] **Step 2: 运行 CAD 解析回归测试**

```bash
python3 -m pytest scripts/parse_cad_test.py -q
```

预期：全部通过。`test_walls_yaml_output_contains_only_geometry_fields` 守卫测试不会被 overlay.yaml 变动影响。


