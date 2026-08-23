# 材质评审模式设计（渲染决策可信度修复 v6）

日期：2026-08-14
状态：已批准（业主确认：色号决策做到"缩小候选+看协调"级，最终色号门店实物终审 DEC-011）
触发：业主反馈 v5 渲染"完全不足以做 tradeoff——地砖色号、拼法、墙面色号都无法判断"

> ⚠️ 2026-08-23 更新：本文 §3 的实体色板机制已废弃（西墙色板被电视柜墙挡死，且业主判断
> "对比只需 list 色号循环出渲染图"）。选色改用 `dress_scene.py --mat-override "wall=#hex"`
> 整场景循环渲染对比；material_review 工况本身（Standard 无调色 + 6500K 中性光）仍然有效。
> 详见 docs/render-tech-debt.md D4。

## 背景与根因诊断

v5 渲染管线在物理层面是真的（Cycles 光追、真透射、软影），但**所有产出图本质是"氛围图"，不是"材质评审图"**。三个根因：

1. **色号不可信（管线决定不可能准）**
   - 场景只有 blue_hour / night 两种（gen-render-config.ts），无中性光工况
   - 室内灯全 3000K 暖光 + 晚霞/星夜 HDRi → 暖白/米白/浅灰在 3000K 下不可区分且整体偏橙
   - `view_transform='AgX'` + exposure 0.5 → 电影级 tone map 重度去饱和压对比，#f7f5ef 渲出来不可能看起来像 #f7f5ef
   - 画面无任何色卡参照物
2. **拼法看不清（分辨率不够）**
   - 木纹贴图画布 1024px 覆盖 ~5.2m 世界（人字拼 150×900 板）→ 单板宽 ~30px、木纹带 1-3px，必然糊
   - 仅 28mm 平视全景机位，地板以掠射角占画面边缘
3. 家具是体块——由 french-cream spec（2026-08-14）另行解决，本 spec 不覆盖

## 目标 / 非目标

**目标**：
- 新增 `material_review` scenario + 特写机位：业主可从渲染图判断**地板拼法（直铺 vs 人字拼）**与**候选色号协调性**，支撑 DEC-011 门店终审前的 3D 筛选
- 画面内置候选色实体色板：候选 hex 与被评材质**同光、同镜头、同 tone transform**，眼睛直接对比
- 渲染检查自动化：`inspect_render.py` 用像素采样/ΔE/A-B diff 代替人工读图，AI 无视觉也能做第一道质检
- 氛围图（blue_hour/night）保持不变，两类图各司其职

**非目标**：
- 不做显示器校色级"从图上读色号"（业主已确认不需要；换屏/亮度即失效）
- 不改 three.js 端、不改 model-geometry/house.yaml 语义
- 不做材质库扩容（候选仍来自 materials.yaml，色板候选列表配置驱动）

## 技术方案

### 1. `material_review` scenario（gen-render-config.ts）

| 项 | 氛围图（现状） | material_review |
|---|---|---|
| view_transform | AgX | **Standard**（scenario 级新字段，缺省 AgX 兼容现有） |
| exposure | 0.5 | **0.0** |
| 灯光色温 | 3000K | **6500K**（scenario 级 `light_temp` 覆盖，透传 add_lights） |
| world | HDRi 晚霞/星夜 | 纯中性灰 `#808080`，无 HDRi（不偏色） |
| 色板 | 无 | 候选色实体色板（见 §3） |
| 贴图画布 | 1024px | **2048px**（全局参数化，见 §4） |

### 2. 机位过滤（dress_config.py + gen-render-config.ts）

- camera 增可选 `scenarios: [id]` 字段：只出指定工况（评审特写不进氛围批量，全景不进评审批量）
- `make_jobs` 过滤逻辑纯函数化，单测覆盖
- 新增 4 个 35mm 特写机位（camera 增 `lens` 字段，缺省 28mm 兼容现有）：

| 机位 id | 位置 → 目标 | 内容 |
|---|---|---|
| living_floor_closeup | [9.9, 1.4, 6.1] → [9.3, 0, 7.4] | 客厅地板 45° 特写（沙发西侧空白地板）+ 地板色板 |
| living_west_wall | [10.0, 1.5, 7.0] → [7.2, 1.4, 7.0] | 客厅西实体墙正对 + 墙面色板 |
| bedroom_floor_closeup | [1.0, 1.4, 6.6] → [1.7, 0, 7.9] | 主卧地板特写（床西侧空地）+ 地板色板 |
| bedroom_west_wall | [2.6, 1.5, 7.6] → [0.0, 1.4, 7.6] | 主卧西墙正对 + 墙面色板 |

坐标为 three.js 系（x 东 / y 上 / z 南），dress_scene 经 `to_blender` 转换；已对照 house.yaml 房间边界（living x∈[7.2,13.4] z∈[2.4,9.8]；master x∈[0,4.2] z∈[5.55,9.8]）与家具 footprint 排障。

### 3. 候选色板（scenario 级 `swatches` 字段）

```jsonc
"swatches": [
  { "hex": "#c49a6c", "mode": "floor",    "x": 8.55, "z": 7.05, "size": 0.4 },  // 地板候选A 直铺原色
  { "hex": "#c9a173", "mode": "floor",    "x": 9.06, "z": 7.29, "size": 0.4 },
  // ... 4 块沿视线垂线排列；主卧同组复制一份平移到床边空地
  { "hex": "#f7f5ef", "mode": "vertical", "x": 7.21, "z": 6.35, "size": 0.3 }   // 墙面候选 贴墙悬停
]
```

- 渲染：Principled 纯色 rough 0.9（模拟漆面漫反射），**受场景光**——同光同变换才可比，禁用 emission
- `floor` 模式：平放 y=0.002（防 z-fighting）；`vertical` 模式：面向室内立于墙前（y 中心 1.3）
- 候选列表是配置：换候选改 gen-render-config.ts 重生成 render-config.json，零代码
- 画面内不标字（Blender 文字渲染不值当），色板顺序固定，对应关系记在 pipeline-acceptance.md
- 现默认候选：地板 4（floor_tile_01 原色系 ± 明度）×2 房间 + 墙面 4（#f7f5ef 奶油系梯度）

### 4. 贴图分辨率参数化（wood_texture.py）

- `PLANK_CANVAS` 1024 → 函数/缓存级参数，全局默认 **2048**（板宽 30px→60px，木纹带可辨）
- 缓存 key 加画布尺寸（`{mid}_{pattern}_{seed}_{canvas}`），A/B 同配置仍复现（seed=42 不变）

### 5. inspect_render.py（自动质检，代替第一道人工读图）

纯 PIL/numpy，不依赖 Blender：

- `--image x.png --sample "cx,cy,w,h:#f7f5ef"`（可多组）：区域平均色 + ΔE76 报告；`--tol N` 超差退出码非 0
- `--diff a.png b.png [--region ...]`：逐区域平均差——A/B 验证"地板该变、墙不该变"
- 故障指纹自动检测：全品红（HDRi 截断坑）、全黑（灯未挂）、全白
- 用法约定：渲染后必跑，报告贴 pipeline-acceptance.md

## 分步任务

| # | 任务 | 产出 | 工时 |
|---|---|---|---|
| 1 | dress_config.py scenarios 过滤 + 单测 | 过滤逻辑 + 测试 | 0.5h |
| 2 | dress_scene.py：view_transform/light_temp/lens/swatches | 渲染端支持 | 1.5h |
| 3 | gen-render-config.ts：scenario + 4 机位 + 色板坐标 | render-config.json | 1h |
| 4 | wood_texture.py 参数化 + materials_from_yaml 透传 | 2048 贴图 | 0.5h |
| 5 | inspect_render.py | 自动质检脚本 | 1h |
| 6 | 冒烟渲染 + inspect 报告 + 业主 gate 目检 | 直铺 vs 人字拼评审图 | 0.5h+业主 |

## 验收标准

1. **业主 gate（最终裁决）**：material_review 地板特写图中，直铺 vs 人字拼拼接纹理清晰可辨，候选色板与真实地板/墙面可直接眼比协调性——业主回复"可做 DEC-011 筛选"才过关
2. **自动质检**：inspect_render.py 全部采样 ΔE 报告产出；无品红/全黑指纹；A/B diff 中墙面区域差 < 阈值、地板区域差 > 阈值
3. **氛围图回归**：blue_hour/night 全景图与 v5 视觉无破坏性变化（仅贴图 2048 化的清晰度提升）
4. **可复现**：Cycles seed=42 + 色板坐标/候选全配置驱动，同配置两次渲染一致
5. **兼容**：不带新字段的旧 scenario/camera 配置行为不变（view_transform 缺省 AgX、lens 缺省 28、swatches 缺省无）

## 风险与对策

| 风险 | 概率 | 对策 |
|---|---|---|
| 6500K 灯下 Standard 白平衡仍偏色（Cycles 无白平衡概念） | 中 | 色板与材质同光同变换，**相对比较**不受绝对偏色影响（这正是"缩小候选+看协调"不依赖校色的原因） |
| 中性灰 world 照度不足画面死黑 | 中 | lights_on 全开 + 色板受点光；冒烟时 inspect 检查亮度直方图 |
| 色板穿模/被家具挡 | 低 | 坐标已对照 footprint；冒烟渲染人工确认（业主 gate 一并看） |
| 2048 贴图生成变慢 | 低 | 一次性缓存（~秒级），可忽略 |

## 明确不做

- 显示器校色、从图读绝对色号（业主已确认不需要）
- 画面内色板文字标注（v2 需要再加）
- 日光 scenario（评审用中性灯已够；日光氛围图另议）
- 家具资产（french-cream spec 负责）
