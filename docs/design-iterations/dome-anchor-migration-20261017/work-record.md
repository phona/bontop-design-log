# 吸顶灯渲染锚点迁移 work-record（DEC-2026-10-17-R12）

## 性质与触发

本迭代是 **lint 驱动的一致性修复**，不是业主看图驱动的外观迭代：工作区新增的
`verify-spatial` 检查 `lighting_ceiling_mount_detached` 抓出 5 盏吸顶灯渲染实体悬离
宿主吊顶完成面 0.10–0.50m，根因是 `config/render/overrides.yaml` 残留 5 条 Blender
时代的 `anchorY_offset`（-0.25 ×4 / -0.5 ×1）。裁定与口径见
`docs/decisions/06-electrical.md` 的 DEC-2026-10-17-R12。

## 数字 delta（playbook §6）

| 灯 | 迁移前渲染锚点 | 迁移后锚点 | 宿主完成面 | electrical.height |
|---|---|---|---|---|
| light_master_dome | 2.55（offset -0.25） | **2.80**（offset 0） | 2.80 原顶平顶区 | 2.8 不变 |
| light_parent_dome | 2.55（offset -0.25） | **2.80** | 2.80 | 2.8 不变 |
| light_child_dome | 2.55（offset -0.25） | **2.80** | 2.80 | 2.8 不变 |
| light_study_dome | 2.30（offset -0.50） | **2.80** | 2.80 | 2.8 不变 |
| light_kitchen_panel | 2.55（offset -0.25） | **2.65** | 2.65 ceiling_kitchen 铝扣板 | 2.8 → **2.65** |

## 改动文件

- `config/render/overrides.yaml`：5 条 offset 归零，basis/reason 改写引 R12（旧「已审计
  Blender 基线」表述删除，删除审计在 DEC R12 正文逐条列明）。
- `config/electrical.yaml`：仅 `light_kitchen_panel` height 2.8→2.65 + note；其余 4 盏不动。
- `data/project-render-facts.json`：`npm run generate:project-render-facts` 重生成（恰好 5 行锚点变化）。
- `shared/lighting-fixtures.ts`：从 verify-spatial 上收 `CEILING_MOUNTED_LIGHT_TYPES` /
  `ceilingMountGapTolerance` / `selectCeilingHost` 纯函数（唯一实现，渲染派生同文件）。
- `scripts/verify/spatial/verify-spatial.ts`：改为调用 shared 纯函数（行为不变）。
- `tests/server/lighting-anchor-migration.test.ts`：新增 6 项守门（overrides 归零钉子、
  kitchen 宿主面一致性、4 卧室平顶区、dome bbox 顶=锚点、宿主选择机制、容差分支）。

## 验收机位与 runtime 证据（evidence/）

每机位三件套 `<view>.png + <view>.runtime.json`（相机/ready/fixtureAABB/flushDelta）+
`source-after.sha256`（源版本绑定）。done_when：**fixture bbox max.y == 宿主完成面**。

| 机位 | fixtureTopY | 宿主面 | flushDelta |
|---|---|---|---|
| master-bedroom-after | 2.8000 | 2.80 | 0.000 |
| parent-room-after | 2.8000 | 2.80 | 0.000 |
| child-room-after | 2.8000 | 2.80 | 0.000 |
| guest-room-after | 2.8000 | 2.80 | 0.000 |
| kitchen-after | 2.6500 | 2.65 | 0.000 |

机位口径：轨道模式（`maxPolarAngle = π/2−0.05`，相机需略高于灯具），截图含应用 UI
与 V6 证据（dining-waterbar-s1-em450-20261016）同风格。

## Gate 结果（2026-10-17）

- `gate:visual`：改动前 CLEAR；改 config 后按 playbook 处理 STALE（touch server/index.ts
  触发 tsx --watch 重启），重启后 **CLEAR**（electrical df24fc85fb00）。
- `generate:project-render-facts` → `verify:lighting-config` → `typecheck`：通过。
- `test:server`：1010 tests / 982 pass / **28 fail——全部既有类别**（MEP lint 套件对真实
  config 的 224 存量 error、预算/算量、computeLightState、纹理 document 环境、
  browser-boundaries 在干净 HEAD 同样 fail）；本轮新增 6 测试全过。
- `test:app`：56 fail / 503 pass——与并发会话 R11 记录的干净 HEAD 基线完全一致，无新增。
- `verify:all`：**16/17**，verify-spatial 0 error（迁移前 5 error）；唯一失败 verify-mep
  224 error 为已登记存量（P2 批次处理，另案）。
- `verify:facts`：OK（本轮 P0 已修复 2 个 dangling DEC）。

## 明确不做

灯具外观样式不变（普通 dome 半球贴顶）；MEP 存量、route_overlap 平面错距方案等见
verify:all 归零方案 P2/P3；本记录不作为采购或施工定案。
