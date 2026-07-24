# 和萃 701 — 采购监理系统

> 本文档设计一套**采购决策支持机制**，不是固定方案。系统支持清包/半包两种模式的数据模型，最终走哪条路由你做决定。
>
> 核心原则：**提供 tradeoff，不做选择。**
>
> Phase 1（可视化增强）见 `2026-07-23-visualization-design.md`
> Phase 3（点位系统）见 `2026-07-23-electrical-plumbing-ceiling-design.md`
>
> **标注名：** 所有房间显示名称从 `model-geometry.yaml` 的 `rooms[].name` 读取，不改代码只改配置。

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

## 二、跨 Spec 依赖

| Phase | 依赖 | 说明 |
|-------|------|------|
| Phase 1 可视化增强 | 无 | 基础渲染能力 |
| Phase 3 点位系统 | 家具坐标（Phase 1 分析工具） | 问题检测需家具位置 |
| Phase 4 采购监理 | Phase 1（可视化参考）、Phase 3（地面铺贴配置） | 算量依赖铺贴配置 |

---

## 三、材料生命周期引擎

### 3.1 生命周期定义

每种材料经过以下阶段，系统跟踪状态：

```
选型 → 算量 → 采购 → 进场 → 施工 → 验收 → 维护
```

系统不假设谁负责每个阶段，只记录当前状态和需要的决策点。

**阶段推进：** 每个阶段由用户动作触发（如：用户确认选型 → 进入算量；确认算量 → 进入采购），系统不自动推进。支持回退和跳过。

**异常状态：** 支持 `returned`（退货）、`rejected`（验收不通过）、`partial`（部分交付）等中间态。

### 3.2 状态机

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

### 3.3 算量接口

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

## 四、Tradeoff 分析引擎

### 4.1 数据模型

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

### 4.2 自动生成时机

| 触发条件 | 输出 |
|----------|------|
| 材料进入 `selection` 阶段 | 推荐品牌+价位区间 |
| 材料进入 `quantity` 阶段 | 算量结果+损耗分析 |
| 材料进入 `purchased` 阶段 | 到货验收 checklist |
| 材料进入 `installed` 阶段 | 施工验收 checklist |
| 两个选择互相影响 | 联动 tradeoff（如：选了人字铺 → 损耗+10% → 多买 3㎡ → 预算+600） |

---

## 五、验收知识库（全工种覆盖）

### 5.1 覆盖范围

验收知识库覆盖装修**全生命周期**，按工种组织，每个工种包含：
- 标准操作流程（先做什么后做什么）
- 验收检查项（每项含方法和标准）
- 常见坑点（pitfall）
- 图片/视频参考（可选）

| 工种 | 验收要点 | 系统帮不了但知识库教你的 |
|------|---------|------------------------|
| 🔨 拆改 | 拆除范围核对、梁柱状况 | 怎么判断是不是承重墙、拆完看钢筋有没有伤 |
| ⚡ 水电 | 打压测试、通断测试 | 打压表怎么看、零火线怎么测、回路怎么分配 |
| 🧱 防水 | 涂刷遍数、闭水试验 | 刷多厚算够、闭水多久、怎么去楼下看 |
| 🧱 泥瓦 | 空鼓、缝隙、平整度、坡度 | 空鼓锤怎么用、靠尺怎么看、倒水测试 |
| 🪵 木工 | 吊顶水平、晾衣架预埋 | 龙骨间距多少、加固板怎么固定 |
| 🎨 油漆 | 腻子打磨、漆膜质量 | 侧光怎么看刷痕、湿度温度要求、留罐保存方法 |
| 🔌 安装 | 面板通断、卫浴密封、门缝均匀 | 角阀怎么装不漏水、门缝留多少、地板伸缩缝 |
| 🌬 通风 | 甲醛检测 | CMA 检测怎么约、封闭多久、检测点放哪 |

### 5.2 数据结构

```yaml
# config/acceptance.yaml
phases:
  - phase: demolition
    name: "拆改验收"
    items:
      - id: check_demo_wall
        item: "拆除范围核对"
        method: |
          对照拆墙图，用卷尺量拆除边界。
          重点检查：是否多拆了不该拆的墙，尤其是承重墙。
        standard: "拆除范围与图纸一致，误差 < 5cm"
        severity: critical
        knowledge: |
          **怎么判断是不是承重墙：**
          1. 看图纸——粗实线标注的墙不能动
          2. 敲一下——承重墙声音沉闷厚实
          3. 看厚度——承重墙一般 > 20cm
          4. 钢筋外露——如果看到钢筋，立刻停止

      - id: check_demo_structure
        item: "梁柱状况检查"
        method: "拆完后检查裸露的梁、柱、楼板是否有裂缝或损伤"
        standard: "无结构性裂缝，钢筋无锈蚀"
        severity: critical

  - phase: waterproofing
    name: "防水施工+闭水试验"
    items:
      - id: check_wp_coats
        item: "涂刷遍数检查"
        method: |
          墙面刷到 1.8m 高（淋浴区），地面满刷。
          每一遍干透后再刷下一遍，至少 2 遍。
        standard: "涂刷均匀，无漏刷、无堆积"
        severity: critical

      - id: check_wp_flood
        item: "闭水试验"
        method: |
          1. 堵住所有地漏，放水 3~5cm 深
          2. 标记水位线
          3. 等待 48 小时
          4. 去楼下邻居家看天花板有无渗水
        standard: "48h 后水位无明显下降，楼下无渗水"
        severity: critical
        knowledge: |
          **常见坑：**
          - 闭水前一定要通知楼下邻居，留联系方式
          - 48h 内不要放水
          - 如果发现渗水，补刷后重新做 48h 闭水

  - phase: painting
    name: "油漆验收"
    items:
      - id: check_paint_surface
        item: "漆膜质量检查"
        method: |
          用侧光（手机手电筒贴墙斜照）检查墙面。
          看是否有：刷痕、流挂、起泡、颗粒、色差。
        standard: "侧光 45° 下无明显瑕疵，颜色均匀"
        severity: major

      - id: check_paint_temp
        item: "施工环境记录"
        method: |
          刷漆时记录室内温湿度。
          低于 5°C 或湿度 > 85% 不宜施工。
        standard: "施工期间温度 ≥ 5°C，湿度 ≤ 85%"
        severity: warning
        knowledge: |
          **为什么重要：**
          - 低温：漆膜干燥慢，容易流挂
          - 高湿：漆膜发白、起泡
          - 南宁回南天绝对不能刷漆

      - id: check_paint_reserve
        item: "留罐记录"
        method: "留半罐调好的漆，用保鲜膜封口盖紧，标注色号和涂刷位置"
        standard: "每个颜色留 0.5L 以上，标注色号+房间"
        severity: info
        knowledge: |
          **为什么要留：**
          - 入住后磕碰补漆，机器调色和原漆有色差
          - 留原漆最准

  - phase: final_occupancy
    name: "入住前检测"
    items:
      - id: check_formaldehyde
        item: "甲醛检测"
        method: |
          建议找 CMA 资质机构上门检测。
          检测前封闭门窗 12 小时（关闭新风）。
          每个房间设一个检测点（中央位置，离地 1m）。
        standard: "甲醛 < 0.08mg/m³（国标 GB/T 18883）"
        severity: critical
        knowledge: |
          **什么时候测：**
          - 完工后夏季通风 1~2 个月
          - 冬季可能需要 3~6 个月
          - 有小孩/老人建议更严格标准 < 0.05mg/m³
          - 通风是最有效的方法，活性炭/绿植辅助
```

### 5.3 知识来源标注

每条验收知识标注来源：

```yaml
- item: "空鼓检查"
  source: "GB 50210-2018 建筑装饰装修工程质量验收规范"
  method: ...
```

没有国标的条目标注 `source: "装修经验"`，确保用户知道哪些是硬规范、哪些是经验建议。

---

## 六、与现有系统的关系

| 现有 | 本系统 |
|------|--------|
| materials.yaml（选型+价格） | → 拓展 lifecycle 阶段跟踪 |
| budget-calculator（算账） | → 每个 tradeoff 附带成本对比 |
| pitfall-engine（避坑） | → 验收条目 + 施工坑点 |
| what-if 模拟 | → tradeoff 分析是 what-if 的应用场景 |
| MCP 工具 | → 新增 get_procurement_status, run_tradeoff, get_acceptance_list |

---

## 七、不变的原则

- **改配置不改代码**：采购模型变化只改 YAML
- **不锁定模式**：清包/半包只是配置参数，切换不影响已有数据
- **AI 只建议不决定**：所有 tradeoff 输出对比数据，不替你做选择
- **验收可执行**：每条验收项都有具体方法和标准
