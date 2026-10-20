# 客厅悬垂雕塑主灯 R2

## 当前状态

**项目模型造型已实现；设计迭代整体为 `incomplete`，等待现场结构、气流、视线以及候选SKU的光度与检修资料。** 本轮将业主确认的悬垂造型放进项目模型，并采集同版浏览器证据。结果不是采购定案或施工图。

## 事实与已冻结决策

- 客厅主灯锚点保持`light_living_dome` `(10.80, 7.15, h=2.80m)`，3000K、`living_base`回路；灯位不随餐桌位置变化。
- 原顶高度2.80m；北缘边吊HVAC设备带止于`z=5.55m`。声明的1m平面包络在几何层位与该设备带不重叠；真实送风射流仍待现场确认。
- 业主指出R1方案仍像吸顶灯，随后确认改为明显悬垂的雕塑灯：保留约1m尺度、乳白漫射盘、偏心立体暖铜弧及客厅灯位；本轮总下垂用300mm作为250–350mm区间中点预演。
- 最终模型参数：外包络1.00×1.00×0.30m；乳白盘Ø0.90×0.07m；三根4mm半径的渲染吊杆；暖铜弧跨0.88m、管径20mm、拱高0.18m、向南延伸0.38m。共享几何实算平面轮廓约0.90×0.94m。这些都不是商品或施工尺寸。
- 项目光学目标仍是宽面漫射、3000K、Ra≥90、客厅一般照明约100lx/U0≥0.7、餐桌约150lx。采购记录中的7,100–8,500lm与复算约9,287.5lm冲突仍未解。

## 本轮实施

- 在`config/render/lighting.yaml`声明悬挂盘、顶盘、三根吊杆、单条立体暖铜拱弧和两个弧脚。
- 通过`shared/render/SculpturalDomeGeometry.ts`统一浏览器与GLB/export几何；`shared/project-render-facts-schema.ts`校验尺寸、弧线与连接参数。
- 保持电气锚点、回路、控制、MEP终点、餐桌、餐厅吊灯、客厅吊顶和HVAC配置原样。
- 同机位预演后把盘径从0.88m微调到0.90m、弧跨从0.84m微调到0.88m；保持声明的1m包络，增强远景轮廓辨识度。

## 验证

| 命令 | 结果 | 说明 |
|---|---|---|
| `npm run generate:project-render-facts` | PASS | 生成15个灯具事实；生成文件未手改 |
| `npm run gate:visual`（改动后） | CLEAR | ceiling `50c1c81f9ec8`、electrical `f2b49b7bcdb3`、plumbing `7f1513d14f27`、materials `64176f576326` |
| `npm run typecheck` | PASS | 根包与app TypeScript检查通过 |
| `npm run verify:lighting-config` | PASS | 1个详细灯具配置通过 |
| `npm run verify:all` | PASS | 17/17 verifiers passed，0 failed；项目既有warnings仍按输出保留 |

没有运行测试套件；本轮按已授权流程执行生成、类型、配置、项目验证和视觉门禁。

## 最终证据（同一版本 `?v=20261016-r6`）

- 客厅关系：`tmp/screenshots/living-main-light/living_main_light_after_context_view_v014.png`
- 灯具近景：`tmp/screenshots/living-main-light/living_main_light_after_r2_closeup_v005.png`
- 侧向剖视：`tmp/screenshots/living-main-light/living_main_light_after_r2_side_view_v004.png`
- 俯视包络：`tmp/screenshots/living-main-light/living_main_light_after_top_down_v011.png`
- 每张图均配有`evidence/*.runtime.json`与`evidence/*.snapshot.txt`。页面ready=true、配置错误横幅为空、target为`electrical:light_living_dome`、正式预演关闭。证据会话临时用CSS隐藏`#hover-tooltip`，避免光标悬浮提示遮挡；没有修改场景几何或应用源文件。

## 审查状态

- `review-manifest.json`保存审美与功能审查的固定契约结果。
- 施工/商品审查尚未完成：模型中的吊杆和弧脚是渲染关系，不是承重构造证据。

## 未解决的现场/采购事项

1. **结构和安装**：量房提供梁位、梁底、顶板/接线盒承重；供应商提供灯体重量、底盘和吊杆固定方式。负责人：业主、量房/施工方、电工、灯具供应商；触发：候选冻结与安装图确认前。
2. **风口和视线**：现场核对风口方向、风速/射程、灯体摆动和积灰；从固定沙发位置检查电视上缘遮挡和压迫感。负责人：业主、HVAC施工方；触发：量房及安装方案阶段。
3. **光度与维护**：统一7,100–8,500lm与约9,287.5lm口径，再核3000K/Ra≥90光通量、IES/LDT或等效配光、照度/均匀度；要求厂家说明LED板、驱动器、漫射盘及连接件的维修路径和保修责任。负责人：业主、照明设计、灯具供应商；触发：SKU冻结前。

## 差异、推翻与静默失效条件

- **删除了什么**：R2用新版本替换R1在役造型；R1的1000×1000×120mm浅吸顶外形和内部比例不再作为当前灯具外观。R1决策记录、历史审查和历史截图继续保留。没有删除商品候选、页面证据、价格口径、流明冲突、轨道灯淘汰理由、餐桌吊灯或电气/家具配置。
- **推翻了什么**：推翻R1“低矮贴顶”的外观方案，因为业主看图后明确指出仍像普通吸顶灯。宽面漫射、3000K、Ra≥90、均匀度目标和既有电气接口没有被推翻。
- **新增内容何时会静默失效**：若实际候选的3000K输出/配光不足、风口射流造成摆动或积灰、梁位/顶板不支持固定、检修需要拆顶，模型的可见造型仍会显示但不适于施工；若浏览器与GLB绕过共享生成器，两个输出会分叉；若移动电气锚点却不更新拓扑和MEP，安装关系会错位。

本轮记录见[decision brief](decision-brief.yaml)、[design datum](design-datum.yaml)、[object manifest](object-manifest.yaml)、[fact table](fact-table.yaml)与[review manifest](review-manifest.json)。
