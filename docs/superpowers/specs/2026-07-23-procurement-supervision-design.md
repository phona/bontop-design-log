# 和萃 701 — 采购监理系统

> 本文档设计一套**采购决策支持机制**，不是固定方案。系统支持清包/半包两种模式的数据模型，最终走哪条路由你做决定。
>
> 核心原则：**提供 tradeoff，不做选择。**
>
> Phase 1（可视化增强）见 `2026-07-23-visualization-design.md`
> Phase 3（点位系统）见 `2026-07-23-electrical-plumbing-ceiling-design.md`

---

## 一、设计原则

| 原则 | 说明 |
|------|------|
| 不锁死采购模式 | 清包/半包/全包切换只是配置，代码不假设 |
| 生命周期驱动 | 每种材料都知道自己「现在该干嘛」 |
| Tradeoff 优先 | 任何建议附带「选A vs 选B」的对比数据 |
| 验收可执行 | 每步施工都有可操作的检查项 |
| 数据来源可溯 | 每条建议标注来源（经验/规范/价格） |

---

## 二、材料生命周期引擎

### 2.1 生命周期定义

每种材料经过以下阶段，系统跟踪状态：

```
选型 → 算量 → 采购 → 进场 → 施工 → 验收 → 维护
```

系统不假设谁负责每个阶段，只记录当前状态和需要的决策点。

### 2.2 状态机

```yaml
# config/procurement-state.yaml 示例
materials:
  - id: floor_tile_01
    name: "客厅地砖"
    stage: selection          # selection | quantity | purchased | delivered | installed | accepted | maintenance
    selected_brand: null      # 用户选型前为 null
    quantity_m2: null         # 算量前为 null
    unit_price: null          # 询价前为 null
    acceptance_checklist: []  # 动态生成
    tradeoffs: []             # 关联的 tradeoff 分析
```

### 2.3 算量接口

从 `model-geometry.yaml` 自动读取房间面积，结合铺贴配置（方向/损耗率）生成材料用量：

```
floor_tile_01:
  room: living_dining
  area: 35.2sqm              # 从几何引擎自动算
  waste_rate: 1.05            # 直铺 1.05，人字铺 1.15
  total_needed: 36.96sqm
  note: "人字铺损耗更高，但效果更好"
```

---

## 三、Tradeoff 分析引擎

### 3.1 数据模型

每次决策点提供对比数据：

```yaml
tradeoffs:
  - topic: "瓷砖铺贴谁来做"
    options:
      - label: "装修公司包"
        cost: 4500            # 工费
        risk: "可能偷工减料，需盯"
        time: 3天
        acceptance_items:
          - "空鼓率 < 5%"
          - "缝隙均匀 2mm"
          - "平整度 2m 靠尺 < 2mm"
      - label: "自己找师傅"
        cost: 3000
        risk: "手艺不可控，需自己盯+验收"
        time: 4天
        acceptance_items:      # 同验收项，但需要自己懂
          - "同上"
        tips: "推荐在小区群里问邻居用过的师傅"
```

### 3.2 自动生成时机

| 触发条件 | 输出 |
|----------|------|
| 材料进入 `selection` 阶段 | 推荐品牌+价位区间 |
| 材料进入 `quantity` 阶段 | 算量结果+损耗分析 |
| 材料进入 `purchased` 阶段 | 到货验收 checklist |
| 材料进入 `installed` 阶段 | 施工验收 checklist |
| 两个选择互相影响 | 联动 tradeoff（如：选了人字铺 → 损耗+10% → 多买 3㎡ → 预算+600） |

---

## 四、验收知识库

### 4.1 数据来源

已有：
- `docs/acceptance_checklist.md` — 整体验收清单
- `config/pitfalls.yaml` — 避坑知识库

新增：
- `config/acceptance.yaml` — 按工种/材料的验收条目

### 4.2 验收条目格式

```yaml
- id: check_tile_hollow
  phase: tile_installation
  category: 瓷砖
  item: "空鼓检查"
  method: "用空鼓锤轻敲每块砖的四角+中心"
  standard: "单片空鼓率 < 15%，整面墙 < 5%"
  severity: critical
  picture_url: "/references/tile-hollow-test.jpg"
```

---

## 五、与现有系统的关系

| 现有 | 本系统 |
|------|--------|
| materials.yaml（选型+价格） | → 拓展 lifecycle 阶段跟踪 |
| budget-calculator（算账） | → 每个 tradeoff 附带成本对比 |
| pitfall-engine（避坑） | → 验收条目 + 施工坑点 |
| what-if 模拟 | → tradeoff 分析是 what-if 的应用场景 |
| MCP 工具 | → 新增 get_procurement_status, run_tradeoff, get_acceptance_list |

---

## 六、不变的原则

- **改配置不改代码**：采购模型变化只改 YAML
- **不锁定模式**：清包/半包只是配置参数，切换不影响已有数据
- **AI 只建议不决定**：所有 tradeoff 输出对比数据，不替你做选择
- **验收可执行**：每条验收项都有具体方法和标准
