# 和萃 701 室内设计全控项目

> **核心原则**：所有数据本地化、版本化、可审计。AI驱动创意，Python驱动计算与归档，业主只做决策与验收。
>
> **当前效果预览主线**：Web + GPT。Web/CLI GLB 导出与比较保持 active；Blender 渲染主线已暂停，源码冷归档见 `scripts/archive/blender-pipeline/README.md`，不再提供默认 npm 或 wrapper 入口。

## 项目信息

| 项目         | 数据                                |
| ------------ | ----------------------------------- |
| 楼盘         | 和萃                                |
| 预测建筑面积 | **119.38㎡**                        |
| **套内面积** | **94.76㎡（业主确认）**             |
| 层高         | **原顶（结构板底）约 2.8m；室内净高 2.8m**（唯一口径，权威 `config/house.yaml:7` `floor_height: 2.8`。2026-10-20 更正：原文写的「结构 3.0m」无现场依据——邻户图结构板底 +2830 佐证实际约 2.83m，见 `docs/mep-construction-guidance.md:76`；量房实测后以实测回写 `config/house.yaml`） |
| 户型         | 四房两厅两卫                        |
| 楼层         | **7楼**                             |
| 建筑类型     | **板楼**                            |
| 单元位置     | **西户（左侧户）**                  |
| 朝向         | 南北通透                            |
| 城市         | 南宁                                |

## 目录结构

```
interior-design-project/
├── README.md
├── config/                    # 结构化配置
│   ├── house.yaml             # 户型基础数据
│   ├── layout/                # 概念方案与定稿布局
│   ├── materials.yaml         # 材料规格库
│   ├── design-rules.yaml      # 设计规则
│   └── budget/                # 预算基线
│       └── base.json          # 基线预算
├── budget/                    # 预算变更与支付
│   ├── payments/              # 付款凭证
│   └── changes/               # 变更记录
├── survey/                    # 现场量房数据
│   ├── photos/
│   └── videos/
├── cad/                       # 图纸归档
│   ├── original/              # 开发商/物业竣工图
│   ├── survey/                # 量房复核图
│   └── design/                # 设计师深化图纸
├── contracts/                 # 合同归档
│   ├── design_service/
│   ├── construction/
│   └── material/
├── renders/                   # 渲染与漫游
│   ├── blender/
│   └── web/
├── docs/                      # 文档
│   ├── README.md              #   文档索引（16 个根文档的角色/状态/权威指向）
│   ├── designer_brief.md
│   ├── acceptance_checklist.md
│   ├── material_selection_log.md
│   ├── decisions/             # 决策日志（18 个主题文件 + README 索引）
│   │   ├── README.md          #   索引 + 模板 + 待决策事项
│   │   ├── 01-control-budget.md
│   │   └── …
│   ├── design-iterations/     # 迭代记录（INDEX.yaml 为机读索引）
│   │   ├── INDEX.yaml         #   65 条：主题/状态/引用数/权威去处
│   │   ├── archive/           #   20 个已归档轮次
│   │   └── <44 个现役轮次目录>/
│   ├── renders/               # 渲染架构留档
│   ├── standards/             # 起夜路径照明标准
│   └── hvac/                  # 暖通专题文档（6 个）
├── scripts/                   # Python工具脚本
└── schedule/                  # 进度计划
```

## 当前状态

- [x] 项目目录初始化完成
- [x] 获取物业合同分户图并识别为结构化数据
- [x] 获取第三方设计图并确定为套内布局底图
- [ ] 获取物业竣工原DWG（承重墙、梁位、水电）
- [ ] 现场量房并录入精确尺寸
- [x] 从概念方案中选定最终布局
- [x] 建立 CAD 驱动户型提取流程（`scripts/cad/parse_cad.py`），解析中文房间标签（`SH-文字标注`），3D 交互采用对象优先模型。
- [ ] 设计师深化与施工图
- [ ] 招投标与合同签订
- [ ] 施工与变更审计
- [ ] 竣工验收

## 快速开始

```bash
# 查看户型数据
cat config/house.yaml

# 从 CAD 设计图提取户型布局
python -m pip install -r scripts/requirements.txt
python scripts/cad/parse_cad.py

# 查看提取后的结构化布局
cat config/layout/model-geometry.yaml

# 查看当前预算
cat config/budget/base.json

# 查看文档地图（16 个根文档的角色/状态/权威指向）
cat docs/README.md

# 查看待决策事项（决策日志入口：索引 + 模板 + 待决）
cat docs/decisions/README.md

# 查某条决策（反查编号）
grep -rn "DEC-2026-10-08-R01" docs/decisions/
```

### 日照模拟

点击右下角“日照”按钮打开面板：日期/时刻滑杆实时驱动太阳位置与光影（真实天文算法，南宁经纬度），季节预设（冬至/夏至/春分/秋分）、延时播放、俯视日照时长热力图（冬至默认）。分析数据：`GET /api/analysis/sunlight?date=MM-DD`。配置见 `config/environment.yaml`。

### 湿度风险评估

点击“湿度”按钮：各房间按结露/发霉风险等级着色（绿低/黄中/红高），高风险重点表面（回南天地面、朝北外墙、热桥角部）以脉冲标记显示，点击房间查看因子拆解。回南天窗口（02-15~04-15）内冷表面因子自动生效，日照面板会显示提示条。分析数据：`GET /api/analysis/humidity?date=MM-DD`。湿度因子声明见 `config/environment.yaml` 的 `humidity:` 段。

### 吊顶分区高亮与算量（DEC-2026-10-08-C01）

机电组点“吊顶分区”按钮：按 `config/ceiling.yaml` 的逐分区声明上色——**每个分区一个颜色**（同工艺同一色相带，按分区 id 哈希取点，新增/删除分区不打乱已有颜色），图例按工艺分组并给出净面积/展开面积/延长米（窗帘盒）/板块数（铝扣板），点图例某行可隔离该分区。hover 任一分区即在“机电信息”里看到工艺、净面积、展开面积与板块数。

算量与 3D 严格同源（同一个函数 `shared/ceiling-takeoff.ts`，几何口径与 `CeilingZoneBuilder` 一致）：

```bash
npm run takeoff:ceiling            # 分区表 + 工艺小计 + 显形项（重叠/未归类/不计量）
npm run takeoff:ceiling -- --json  # 机器可读
```

当前声明快照：19 个实心分区，净 **45.130㎡** / 展开 **77.053㎡**；石膏板吊顶 10 区 23.222㎡、铝扣板 3 区 16.366㎡（185 块 300×300）、窗帘盒 5 区 4.463㎡（**17.85 延长米**）、隐藏晾衣架吊顶 1 区 1.080㎡。查询出口：`GET /api/ceiling/takeoff`；木工人工量已从"房间面积近似（142.92㎡）"改为分区实算。显形项（平面重叠、未归类、未计量分区）见 `computeCeilingTakeoff()` 的 `overlaps` / `unclassifiedZoneIds` / `excludedIds`，未裁定前不当作 resolved。

计价口径（DEC-2026-10-08-C02）：木工人工分两行——**板面**（石膏板+铝扣板+晾衣架吊顶）40 元/㎡ × 40.667㎡，**窗帘盒**按延长米 17.85m 单列，费率待报价（数量已显形在预算快照的 `pendingLabor`，取到报价后只填 `config/budget/base.json` 的 `rate`，不改代码）。

多家报价切换（DEC-2026-10-08-C03）：`config/ceiling-quotes.yaml` 一卡一家，卡里**只写单价和含项范围、禁止自带面积**（量永远来自 takeoff）。`GET /api/ceiling/quotes` 并排看全部候选（逐行 subtotal、总额、与生效卡差额、可比性标记）；`POST /api/ceiling/quotes/active` 切换——只改写 `active:` 一行（留 `.bak`，Git diff 只有一行）。没写 `scope_note` 的候选会标 `comparable: false`；`per_unit: null` 的行数量显形、总额不编；配置文件坏掉时预算自动回落 `base.json` 费率，不冻结。

### 涂漆（墙顶面独立选择）一键高亮与成本核算（DEC-2026-10-08-C05、DEC-2026-10-15-P17）

机电组点「涂漆区」按钮：按 `config/layout/overlay.yaml` 的 **32 段 `paint_region` 声明**透视高亮已选墙面——绿色单色、初始 opacity 0.38、检视态 0.55、`renderOrder` 100、`depthTest=false`；平面沿墙法线**朝声明房间侧外偏移 0.068m**，因此同一段墙上的贴砖面与双面涂漆的另一面不会共面。顶面由独立的 8 条 `paint_ceiling_region` 声明选择并单独计量；缺少顶面声明就表示该房间顶面不纳入涂装，不从墙面选择推导。两类声明可分别增删，涂漆检视态仍只高亮墙面和已选窗台，不显示顶面。

墙面、顶面与窗台各自有明确选择声明；成本核算和预算统一读取这些声明，墙面和顶面的计算不要求房间集合相同。`house.yaml#rooms[].wall_finish` 只校验墙面选择。

```bash
npx tsx --test tests/server/paint-scope.test.ts   # 32 段墙面声明 + 逐房间独立复算面积 + 成本四情景
npx tsx --test tests/server/paint-sill-scope.test.ts  # 上飘窗外露面几何（遮挡扣除/端面/守恒）
```

当前声明快照：**8 间房、48 段声明** = 32 段 `paint_region`（墙面）+ 8 段 `paint_ceiling_region`（显式顶面）+ **8 段 `paint_sill_region`（上飘窗外露面）**。顶面和墙面是独立选择；现有主走廊 3 段墙面及 1 段顶面声明均保留。2026-10-09 业主裁定「所有上飘窗都算上」：主卫那处刷**防霉漆**（单独计价，费率待现场核验与分项报价），其余 7 处按普通乳胶漆计入 `ordinaryAreaSqm`；相邻飘窗背靠背的端面按「算 0 次」由 `bayCoversCap` 剔除（内部接缝不外露）。入户花园已出范围——开发商已做好墙面，收房后视情况再定；厨房本来就在范围外（贴砖墙）。

**门窗洞按实扣除**（业主 2026-10-08 裁定）：3D 每段平面在洞口处拆成「洞口以下的左右条 + 洞口以上的通长带」，当前毛墙面 **188.375㎡** − 门洞 **20.340㎡** = 净墙面 **168.035㎡**（3D 高亮的就是这个范围）+ 独立选中的顶面 **106.974㎡** + 上飘窗 **37.198㎡**（普通漆 33.643 + 防霉漆 3.555）= 全部涂装面 **312.207㎡**；其中**按普通乳胶漆计费 308.652㎡**（防霉漆窗台单独计价，不进普通漆金额；砖漆互斥后两卫漆声明已让出防水/防溅砖带，厨房上飘窗 P09 已整块改贴砖，P11 起瓷砖与漆声明均不盖门洞）。当前三段主走廊墙面、3.75㎡顶面已纳入这些值。顶面口径 2026-10-09 修正：`paint_ceiling_region` 按房取 footprint 后**扣除整间铝扣板投影**——客卫 3.15㎡ 与主卫 4.576㎡ 的顶面整间都是铝扣板，不是涂装面（旧实现按满 footprint 计，多计 7.726㎡，已由独立复算纠正）。窗洞当前为 **0**——全部 8 樘窗都在 suppress 的玻璃幕墙/飘窗让路墙上，本就不是涂装面；`bay_sill`/`glass_infill` 增加可选 `along`，将来窗声明落到实体墙上会自动扣，缺 `along` 则告警而非静默少扣。拆洞与墙面积算法只有一个实现：`shared/paint-scope.ts`；墙面、顶面和窗台面积由显式声明分别选择与计算。

外部报价登记（DEC-2026-10-08-C07）：`config/paint-comparison.yaml` 的 `quotes[]` 收包工包料类报价，按声明的净计费面积折算总额，并给出「vs PKG-080 计划额 / vs 业主目标 / vs 自下而上涂刷模型」三方对照。当前登记：多乐士包工包料 55 元/㎡ × 308.652㎡ = **¥16,975.86**（高于计划 ¥5,475.86；与默认情景差 ¥4,039.56 = 折合 13.09 元/㎡，即基层/腻子/样品成品保护的隐含额度）。覆盖范围与遍数未确认，只对照、不与计划额划等号。

成本核算：`config/paint-comparison.yaml` 是唯一口径文件（遍数、底漆假设、扣减开关、人工费率、对账基准），`server/paint-cost-comparison.ts` 与 `materials.yaml` / `config/budget/base.json` / `schedule/phase-1/control.yaml` 逐项对账，算不出就 503。查询出口：`GET /api/paint/comparison`、`GET /api/budget` 的 `paintBudgetPreview`（`status: 'comparison_overlay_only'`，不进总额）。四个情景并列（面漆 1/2 遍 × 扣/不扣门窗洞），`selectedScenarioId` 恒为 null——遍数拍板前不给单一数字：默认（2 遍、扣洞）面漆 6 桶 + 底漆 3 桶，材料 ¥5,220 + 人工 ¥7,716.30 = **¥12,936.30**，高于 PKG-080 计划 ¥11,500 约 ¥1,436.30；1 遍口径 ¥11,196.30。不含基层修补、找平批刮腻子、颜色样板与成品保护（COST-080-01/02/04）。

### 防穿模校验（DEC-2026-10-09-P01）

```bash
npm run verify:penetration                       # 实体互撞/净距（人读）
npm run verify:penetration -- --json             # 机器可读，无时间戳、稳定排序
npm run verify:penetration -- --json --shadow    # 附加 OBB 对照与白名单审计（只观察，不影响退出码）
```

`verify:penetration` 只判「两块实体是否占了同一块空间」：家具穿墙（只进一侧墙厚、未过中心线也 fail-closed）、家具对宿主墙完成面的退让净距、家具穿/贴玻璃窗帘栏杆、家具进吊顶、家具互撞、玻璃栏杆互撞、家具堵门洞。声明完整性、墙线拓扑、运行时权威性、灯具宿主归 `verify:spatial`，两者不重复判同一件事（`tests/server/penetration-boundary.test.ts` 一票否定越界）。两个 CLI 共用 `shared/penetration/scene.ts` 的场景采集，几何一律来自 `buildScene()` 的 runtime mesh。

规则、严重级与豁免只有一份真相：`config/anti-penetration.yaml`。**severity 是下限**——规则按几何量自判更严则保持，配置只许加严、不许放宽；`enabled: false` 降为 info 并标注，不静默消失。豁免必须写 `reason`/`owner`/`expires`，按「规则 + 实体对」匹配且必须绑定稳定 runtime id，禁止按家具类型全局放行；到期自动复活为 error。容差仍只读 `config/spatial-validation.yaml`，配置文件里不出现第二套数字。当前结论：0 error / 8 warning（均为 `furniture_glass_clearance_insufficient`，既有净距不足）。

机电协调构件（管/管井）逐类型显式申报参与策略 `excluded`/`solid`，未申报即 fail-closed；`mb_vanity_pvc_service_chase` 的预留区口径未裁定，10 处墙/家具重叠登记为 `docs/pending-site-data.md` #55 显形债务，未裁定前不当作缺陷、也不为了绿灯改坐标。活动包络（门扇开启、抽屉、电器门）尚未覆盖，详见 `docs/penetration-lint.md`。

### 面层范围核查（DEC-2026-10-09-P06）

```bash
npm run verify:finish-scope                     # 面层声明之间是否互相压/重复/挂错房
npm run verify:finish-scope -- --json           # 机器可读，无时间戳、稳定排序
```

`verify:finish-scope` 补的是防穿模没覆盖的一类问题：**漆/砖/防水台/吊顶都是「面层声明」，各自圈一片墙或一片顶；声明互相压时不产生任何几何错误，只会让面积数字重复**——而 3D 里看不出来（漆是 inspection-only 半透明叠加层，要开开关转视角，且「压了 0.3㎡」肉眼判不了）。所以这一层专职核查，与 `verify:spatial`（声明完整性/拓扑/运行时权威性）、`verify:penetration`（实体互撞）不重复判同一件事。

现役规则为 **F01–F04、F06–F09**：**F01** 同一面墙同一房间（=同侧）水平+竖向区间都相交 → 该面被计两次（跨房间是双面涂漆，合法不报；裁定「砖跟漆互斥」——一片墙 either 刷漆 or 贴砖，没有「按桶吸收」的中间态）；**F02** 同一 bay 元素的同一个面被漆与砖同时声明；**F03** 同一面墙同侧两段 `paint_region` 的 along 相交；**F04** `paint_region` 的 along 端点须落在声明房间的 **boundary 多边形**上（裁定「不能悬空」——这正是「漆面悬在过道上」的几何判据，过道区没有 room）；**F06** 铝扣板矩形须整块落在声明房间内（越界会使顶面扣减口径错误）；**F07a** 瓷砖声明不得盖住门/窗洞 → error（`wall_region` 不拆洞，盖住洞会多算）；**F07b** 漆声明跨洞 → info（面积与 3D 网格已实扣）；**F08** 每个面层声明必须在 `buildScene` 产出中找到实体，顶面声明需有对应 ceiling 几何；**F09** 逐网格校验面层实体贴在所声明的墙/窗台几何上。**原 F05 已由 DEC-2026-10-15-P17 废止**：以前从“房间有墙漆”推导“顶面必须登记涂漆”，这与独立选择冲突；现在缺少 `paint_ceiling_region` 就是该房间顶面未选，不能再据墙面范围报漏顶。

房间归属一律走 boundary 多边形，不用 `x/z/width/depth` 包围盒：本户型主卧×西北次卧、客餐厅×入户花园两对房间包围盒相交而多边形不重叠。`height` 字段在 `paint_region`/`wall_region` 里的语义是**顶面标高**不是「高度」（`shared/paint-scope.ts` 的 `const top = region.height ?? wall.height ?? 2.8`），字段名有歧义但两侧一致。

规则、severity 与豁免只有一份真相：`config/finish-lint.yaml`，与 `config/anti-penetration.yaml` 同构（severity 是下限只许加严；豁免必须 `reason`/`owner`/`expires`，到期自动复活；覆盖矩阵缺一方即报错）。DEC-2026-10-09-P07 按业主裁定把 F01–F04 从 warning 全升 error，并**修声明而非加豁免**：6 处 `paint_region` 加 `bottom` 让出防水/防溅砖带（客卫开放洗漱区东墙被两条砖带夹住，拆成上下两段声明），删除 `walltile_kitchen_ent_hood_wall`（C18 后 stale 的烟机挡水砖，多计 0.45㎡ 瓷砖）。当前铝扣板矩形边界仍由 F06 校验；顶面面积由 `paint_ceiling_region` 独立计算并扣除两卫铝扣板投影。当前主走廊墙/顶选择与总量见上方本轮快照，缺少顶面选择的其他房间不会被强行补声明。

### 工程状态查询（DEC-2026-10-09-E01）

```bash
npm run state:project                # 人读：逐构件状态 + 未裁定/有冲突清单
npm run state:project -- --json      # 机器可读：每构件一条 {status, statusSource, openQuestion, conflicts}
```

回答一个问题：**每个构件确认到什么程度、卡在谁、和谁冲突。** 状态只派生不存储——权威仍在 `config/*.yaml` 的 `status`/`position_status`、`docs/pending-site-data.md` 的 55 条待决、179 条 DEC 与各 verifier 结论；本命令产出的是视图。优先级：门禁 error(`conflicted`) > config 字段 > 待决台账(`pending`) > DEC 引用(`confirmed`) > **`undeclared`（派生不出来，显形而不是默认已确认）**。规则顺序与状态词映射在 `config/state-model.yaml`，可评审。

当前快照：**164 个构件** = confirmed 73 / undeclared 68 / pending 21 / inferred 2（`tests/server/element-state.test.ts` 钉住总数与申报缺口，数字变化必须是有意的）。`sock_child_ac` 可答：「pending，卡在空调厂家深化图（#42）」。不需要 MCP——agent 读配置、跑这条命令、curl 既有 API 已足够。（2026-10-22 起 MCP 服务端已整体删除，本地 AI 直接拉文件 / 跑 CLI / curl API。）

## 核心原则

1. **没有口头变更**：任何改动必须进 Git。
2. **没有合并项报价**：施工方必须逐项报价。
3. **没有无依据决策**：每个选择有数据支撑。
4. **没有黑箱**：设计师、施工队、材料商在统一框架里工作。
5. **没有事后失忆**：任何历史决策可在 30 秒内追溯到源文件。
