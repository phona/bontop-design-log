# Spec 4：规则引擎 + 归档

> **目标**：通过声明式配置支持预算计算、风险提示、约束检查，并提供方案归档/对比/恢复能力。
> 
> **依赖**：Spec 1（后端数据底座）

---

## 1. 范围

### 包含

- `config/design-rules.yaml` 设计
- 开发模式热重载配置
- 对象映射规则
- 预算计算
- 风险提示（简单模板）
- 约束检查（简单模板）
- 方案归档：创建、查看、恢复、diff、删除
- App 中展示预算/风险/归档

### 不包含

- 通用表达式 DSL（后续可扩展）
- Undo 功能
- 多用户协作
- 复杂热力学/结构仿真

---

## 2. `config/design-rules.yaml`

这是项目设计知识的可执行档案，初始可为空，设计过程中逐步添加。

```yaml
version: "1.0"

objectMapping:
  - pattern: "room:*"
    topics: [floor, wall, paint]
  - pattern: "hvac:*"
    topics: [hvac]

budget:
  baseCategoriesFrom: config/budget/base.json
  topicCategories:
    floor: masonry
    wall: masonry
    paint: painting
    hvac: hvac
    # curtains: curtains  # Spec 4 之后扩展；未注册的话题不产生预算影响
  lineItems:
    - topic: floor
      quantityField: floorArea
    - topic: wall
      quantityField: wetWallArea
    - topic: paint
      quantityField: paintWallArea
    - topic: hvac

risks: []

constraints: []
```

### 2.1 空状态默认行为

- `objectMapping` 为空：使用默认映射（`room:*` → 所有话题，`hvac:*` → hvac）
- `budget.lineItems` 为空：只显示 `config/budget/base.json` 固定类目
- `budget.lineItems` 中引用了未在话题目录注册的话题：该 line item 的 actual 为 0，不报错
- `risks` 为空：风险列表为空
- `constraints` 为空：不检查约束

### 2.2 开发模式热重载

- 监听 `config/design-rules.yaml` 变化
- 重新加载 RuleEngine
- 重新计算预算和风险
- 保留 CurrentScheme 和 DecisionLog
- YAML 解析失败时保持旧配置并输出错误

---

## 3. 规则引擎

### 3.1 支持的规则模板

**风险提示：**

```yaml
risks:
  - id: platform_width
    severity: warning
    message: "{{hvac.name}} 外机摆放紧张，需现场确认"
    when:
      topic: hvac
      options: [B1, B2, E1]
```

**约束（示例）：**

```yaml
constraints:
  - id: high_airflow_hvac_requires_hood
    description: "大风量 HVAC 方案必须配大功率油烟机"
    when:
      topic: hvac
      condition: $topic in ["B1", "B2", "E1"]
    require:
      topic: range_hood   # 假设后续已注册为全局话题，选项带 airflow 字段
      minValue:
        field: airflow
        value: 22
```

> 注：`range_hood` 话题在 MVP 阶段可不注册；未注册时该约束不触发，不会误导实现。

### 3.2 条件语法（MVP 支持）

`condition` 字段只支持以下形式：

| 操作符 | 示例 | 说明 |
|--------|------|------|
| `==` | `$layout.style == "open"` | 等于 |
| `!=` | `$layout.style != "luxury"` | 不等于 |
| `>` | `$airflow > 20` | 大于 |
| `<` | `$price < 3000` | 小于 |
| `>=` | `$airflow >= 22` | 大于等于 |
| `<=` | `$price <= 5000` | 小于等于 |
| `in` | `$topic in ["A1", "A2"]` | 在列表中 |
| `not in` | `$topic not in ["E1"]` | 不在列表中 |

**变量规则：**

- `$topic`：当前规则 `when.topic` 所声明话题的已选 `optionId`（全局 default，不考虑 roomOverrides）
- `$room`：仅在按房间评估时为该房间的 `roomId`，否则为 `null`
- `$selection.<topic>`：任意话题当前全局 default 的 `optionId`
- `$option.<field>`：当前 `$topic` 对应选项对象上的属性路径（如 `$option.airflow`）
- 其他以 `$` 开头的路径表示 `ProjectCatalog` 或选项对象的属性
- 禁止使用裸单词作为隐式变量，避免与话题名冲突

右侧为字面量或列表。

### 3.3 不支持的功能

- 复杂布尔表达式（`&&`、`||`、`!`）
- 跨多个话题的联合条件
- 自定义函数
- 算术表达式

这些后续按需扩展。

---

## 4. 预算计算

### 4.1 与 `config/budget/base.json` 的对齐方式

`config/budget/base.json` 中的 17 个类目继续作为预算科目（`budget` 为计划金额，`actual` 为实际金额）。

- 没有对应话题的类目（如 `demolition`、`water_electric`、`waterproof`、`carpentry`、`kitchen_cabinet`、`miscellaneous`、`property_fees`、`contingency`）保持手动 `actual`，默认 0，后续可通过独立接口更新
- 有对应话题的类目，其 `actual` 由系统自动计算：
  - `masonry` ← `floor` + `wall` 选项材料费
  - `painting` ← `paint` 选项材料费
  - `hvac` ← `hvac` 选项价格（需要在 `config/budget/base.json` 中新增该类目）
  - `curtains` ← `curtains` 选项价格（Spec 4 之后扩展）
  - `doors_windows`、`sanitary`、`range_hood`、`lighting`、`smart_home` 同理，当这些话题被加入系统后映射到对应类目

映射关系由 `design-rules.yaml` 的 `budget.topicCategories` 决定。

### 4.2 总预算公式

```
总预算 = Σ (config/budget/base.json 各类目 budget)
总实际 = Σ (config/budget/base.json 各类目 actual)

类目 actual = 手动 actual（若有） + Σ 该话题选项价格

对于可按房间的话题（floor/wall/paint，curtains 后续扩展）：
  话题选项价格 = option.price_per_unit × 该房间用量 ÷ option.coverage_per_unit × option.loss_rate
  每个房间独立计算，然后求和

对于全局话题（hvac 等）：
  话题选项价格 = option.price_per_unit

字段缺失默认值：
- price_per_unit 缺失：该选项价格为 0
- coverage_per_unit 缺失：按 1 处理（即 price_per_unit 直接乘以用量）；全局话题如 HVAC 无需 coverage
- loss_rate 缺失：默认 1.0
- line item 引用未注册话题：该 line item 价格为 0

HVAC 选项的 `price_per_unit` 来自 `shared/houseData.ts` 中的数值化价格（原 `price` 字符串改为 `price_range` 仅用于展示）。
```

### 4.3 用量计算公式

| 话题 | 用量字段 | 公式 |
|------|---------|------|
| floor | `floorArea` | `room.width × room.depth` |
| wall | `wetWallArea` | `(room.width + room.depth) × 2 × room.height × 0.7` |
| paint | `paintWallArea` | `(room.width + room.depth) × 2 × room.height × 0.75` |
| curtains | `windowLength` | 取 `house.yaml` 中该房间窗户宽度之和；若无，默认 `2.0m`（Spec 4 之后扩展） |
| hvac | 无 | 按套计价 |

说明：

- 墙砖用量乘以系数 `0.7`（仅厨卫湿区贴砖，约占周长墙面的 70%）
- 乳胶漆用量乘以系数 `0.75`（扣除门窗洞口、踢脚线及顶部吊顶后约剩 75%）
- `coverage_per_unit` 和 `loss_rate` 已在 `config/materials.yaml` 中定义
- HVAC 等全局话题直接按 `price_per_unit` 计入对应类目
- MVP 阶段不做精确工程量计算，后续可细化

---

## 5. 归档方案

### 5.1 数据模型

```json
{
  "id": "archived_20260706_120030_naiyoubaizhuwo",
  "name": "奶油白主卧",
  "selections": {
    "hvac": { "default": "A2", "roomOverrides": {} },
    "floor": { "default": "floor_tile_01", "roomOverrides": {} },
    "wall": { "default": "wall_tile_01", "roomOverrides": {} },
    "paint": { "default": "latex_paint_01", "roomOverrides": {} }
  },
  "reason": "预算 12 万，A2 最稳",
  "createdAt": "2026-07-06T10:00:00Z"
}
```

### 5.2 API

#### REST API 端点一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/schemes` | 归档方案列表 |
| POST | `/api/schemes` | 归档当前方案 |
| GET | `/api/schemes/:id` | 查看归档方案 |
| POST | `/api/schemes/:id/restore` | 恢复为当前方案 |
| GET | `/api/schemes/:id/diff` | 与当前方案 diff |
| DELETE | `/api/schemes/:id` | 删除归档方案 |

#### 端点说明

- `GET /api/schemes`：返回归档方案列表，包含 `id`、`name`、`createdAt` 等摘要字段。
- `POST /api/schemes`：传入 `name` 和可选 `reason`，将 `CurrentScheme` 复制为新的归档方案。
- `GET /api/schemes/:id`：返回指定归档方案的完整数据，包括 `selections`。
- `POST /api/schemes/:id/restore`：将指定归档方案覆盖写入 `CurrentScheme`，详见 [5.7 恢复行为](#57-恢复行为)。
- `GET /api/schemes/:id/diff`：返回归档方案与 `CurrentScheme` 的差异数组。
- `DELETE /api/schemes/:id`：删除指定归档方案。

### 5.3 ID 命名约定

为避免与 HVAC 方案 ID（A1/A2/B1 等）混淆：

- HVAC 方案 ID：`hvacSchemeId`（如 `A2`）
- 归档方案 ID：`archivedSchemeId`（如 `archived_20260706_120030_naiyoubaizhuwo`）

### 5.4 命名冲突

同名归档拒绝创建，返回 409。

### 5.5 ID 生成策略

归档方案 ID 格式：

```text
archived_<timestamp>_<slug>
```

例如：

```text
archived_20260706_120030_naiyoubaizhuwo
```

- 时间戳精确到秒，格式 `YYYYMMDD_HHMMSS`
- slug 由名称生成，算法如下：
  1. 使用 `pinyin-pro` 将中文名转为无音调拼音（如 `奶油白主卧` → `naiyoubaizhuwo`）
  2. 转小写，将非字母数字字符替换为 `-`
  3. 合并连续 `-`，去掉首尾 `-`
  4. 截断至 30 个字符
  5. 若截断后为空，使用 `archive`
- 删除后不复用编号
- 若生成的 slug 与已有归档 ID 冲突，在 slug 后追加 `-<n>`（从 2 开始自增）

### 5.6 Diff 格式

Diff 使用路径表示，支持 per-room 和 override 缺失：

```json
[
  {
    "path": "hvac.default",
    "current": "A2",
    "archived": "A1"
  },
  {
    "path": "floor.default",
    "current": "floor_tile_01",
    "archived": "floor_tile_02"
  },
  {
    "path": "floor.roomOverrides.master_bedroom",
    "current": "floor_tile_02",
    "archived": "floor_tile_01"
  },
  {
    "path": "paint.roomOverrides.guest_bedroom",
    "current": null,
    "archived": "latex_paint_02"
  }
]
```

规则：

- `path` 为 `topic.default` 或 `topic.roomOverrides.<roomId>`
- 当某一方没有 override（或 default 未设置，理论上不应发生）时，对应值用 `null`
- 只返回两边不同的项；完全相同的 path 不出现在 diff 中

### 5.7 恢复行为

恢复（`POST /api/schemes/:id/restore`）的行为定义如下：

1. **全量覆盖**：将目标归档方案的 `selections` 完整写入 `CurrentScheme`，覆盖当前所有话题/房间选择。
2. **生成 DecisionLog**：对每一个发生变化的话题或房间，在 `DecisionLog` 中追加一条记录，记录来源归档方案 `id`、变化路径、旧值和新值。
3. **更新时间戳**：将 `CurrentScheme.updatedAt` 更新为恢复操作的时间。
4. **无冲突检测**：采用 last-write-wins 策略，不检查当前方案与归档方案之间的并发修改或版本冲突。

---

## 6. MCP 工具补充

在 Spec 1 基础上增加：

- `get_budget` → `/api/budget`
- `get_risks` → `/api/risks`
- `get_archived_schemes` → `/api/schemes`
- `archive_scheme(name, reason?)` → `POST /api/schemes`
- `restore_scheme(schemeId)` → `POST /api/schemes/:id/restore`
- `run_design_check` → 触发风险/约束重新计算，返回：

```json
{
  "risks": [
    {
      "id": "platform_width",
      "severity": "warning",
      "message": "国产多联机一拖五外机摆放紧张，需现场确认",
      "topic": "hvac",
      "roomId": null
    }
  ],
  "constraintViolations": [
    {
      "id": "high_airflow_hvac_requires_hood",
      "description": "大风量 HVAC 方案必须配大功率油烟机",
      "topic": "hvac",
      "roomId": null,
      "requirement": {
        "topic": "range_hood",
        "minValue": { "field": "airflow", "value": 22 }
      }
    }
  ]
}
```

---

## 7. App 展示

### 7.1 总览菜单补充

- **预算**：显示总预算、已用预算、剩余预算、分类 breakdown
- **风险**：当前方案风险列表，按 severity 排序
- **归档**：已保存方案列表，支持恢复和 diff

### 7.2 信息面板补充

选中物体时：

- 显示切换替代方案后的预算变化
- 显示相关风险

---

## 8. 数据流

### 8.1 配置热重载

```text
用户修改 config/design-rules.yaml
  → 后端 watcher 检测变化
  → 重新加载 RuleEngine
  → 重新计算 BudgetSnapshot / RiskSnapshot
  → App 下次请求时拿到新结果
```

### 8.2 切换方案触发计算

```text
CurrentScheme 变化
  → RuleEngine 重新计算预算和风险
  → 后端返回给 App
  → UI 更新预算/风险显示
```

### 8.3 归档

```text
用户/OpenCode 调用 archive_scheme
  → 后端把 CurrentScheme 复制到 ArchivedSchemes
  → 持久化到 data/archived-schemes.json
```

---

## 9. 验收标准

- `config/design-rules.yaml` 存在，初始可为空
- 修改 `config/design-rules.yaml` 后开发模式自动热重载
- 预算计算正确
- 风险规则能命中并显示
- 约束规则能命中并显示
- 能归档当前方案
- 能查看、恢复、diff、删除归档方案
- App 总览菜单正确显示预算、风险、归档

---

## 10. 非目标

- 通用表达式 DSL
- Undo
- 多方案同时 3D 对比
- 复杂约束求解器
