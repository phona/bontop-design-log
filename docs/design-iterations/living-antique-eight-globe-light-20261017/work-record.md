# 客厅8头古铜木色主灯 R6 预演（DEC-2026-10-17-R7）

## 当前状态

`delivery_ready`。业主已确认总高445mm（仅装100mm长杆）、8个球罩同高且水平错开，并明确8根弧臂从下面的下杯台面共面起弧、同向上拱；2026-10-17又确认“差不多了，就这样。提交吧。”接受R6作为造型预演。此接受不构成SKU、光度、承重或施工批准。

## 改动前基线

- 前一版10头灯已逐文件归档：`docs/design-iterations/living-main-light-archive-20261017/`；其活动配置没有删除，换型后仍可恢复。
- 本轮输入图：`evidence/manufacturer-reference.png`；本轮业主看到的旧灯效果：`evidence/user-context.png`。
- 首次 `npm run gate:visual` 在普通沙箱中被 tsx 临时 IPC 管道 `EPERM` 拦截；经受审查的本机 dev 服务启动后，门禁于 2026-10-17 返回 `CLEAR`（ceiling `50c1c81f9ec8`、electrical `94c988caaf0b`、plumbing `7f1513d14f27`、materials `64176f576326`）。
- 当前客户端基线在同一 agent-browser session 转为第一人称与手动夜预演后截取；`isReady()=true`。基线截图 `evidence/baseline-context-night-v001.png`；相机位置 `[9,1.7,9.5]`、看向主灯区域。

## 冻结的首版方案

- 保留 `light_living_dome` 锚点 `(10.80, 7.15, 2.80)`、回路、双控和 MEP 路由。
- 活动外观从10头球泡半吸顶改为商品图的8头复古吊灯：外径0.88m，总高0.445m，吸顶盘Ø0.13×0.035m、杆长0.10m、球罩0.15×0.14m。
- 按用户决策建8根单头弧臂，两层各4头、错位45°；未标注径向尺寸和弧线由包络拟合，标为推断。
- 取色为木纹棕、古铜棕和暖乳白；暂用程序化纯色材质，未制作商品级表面贴图。

## 改动审计

- 活动条目将移除10头灯的10个球罩/10根等长镀铬臂、Ø1.0m外包络、Ø120×25mm吸顶盘及黑色双盘 hub；这些值全部保存在上述归档，不静默删除。
- 新增8个横向Ø150×高140mm椭球球罩、8根单头弧臂、木色Ø130×35mm吸顶盘、100mm单杆和两层错高排布。
- 被本轮明确替换的是活动视觉候选，不推翻电气位置、回路、控制、MEP或照明硬约束；8×灯泡实际输出是否满足光度要求仍未核验。
- 静默失效条件：球罩不是150×140mm或真实装饰件占用更大外包络；总高箭头并非从顶面到底部；实际商品是4根双头支臂；层间具体方位与前视推断不同；商品色温/灯头/重量/安装方式与图面不同。`hubAttachment`和显式臂根坐标是两份需同步的声明，schema可拦超出中心盘的坐标，但不能替代人工确认语义。出现任一情况需更新模型和证据，不得将预演当施工图。

## R1内审修正

首版schema把 finial 最低点按球心计算，漏减了一次球半径；构造器实际把finial球心放在下盘底面以下一个半径，所以旧中心偏移 `-0.3875m` 会令实际最低点到 y=2.335m（下垂465mm），比用户选定总高多20mm。将下盘中心上移至 `-0.367m`、disc gap改为 `0.1195m` 后，尾饰最低点 y=2.3555m，低层球罩最低点 y=2.355m；schema现在按球体真实最低面校验。R1截图/runtime保留作历史但已失效，R2重新采证。

## R2同版证据

- URL：`http://localhost:5173/?v=20261017-antique8-r2`；页面标题“和萃 701 - 3D 装修设计”；`window.__APP__.isReady()=true`，`#config-error-banner`为空，`visualPreviewActive=false`。
- runtime目标 `electrical:light_living_dome`：8 globes / 8 arms / 8 sockets / 8 PointLights；外包络0.88×0.88m，总厚度0.445m；finial真实底面y=2.3555m，低层球罩底y=2.355m；AABB由声明尺寸计算为x[10.36,11.24]、y[2.355,2.80]、z[6.71,7.59]。
- R2视图：context `evidence/context-r2-v001.png`、补充近景 `evidence/context-detail-r2-v001.png`、closeup `evidence/closeup-r2-v001.png`、underside `evidence/underside-r2-v001.png`、topdown envelope `evidence/topdown-envelope-r2-v001.png`、elevation `evidence/elevation-r2-v001.png`；运行时快照 `evidence/runtime-r2.json`。
- context 机位保留既有深色边梁遮挡；closeup/topdown用于核对灯体，未隐藏场景结构。

## R3对业主造型反馈的修正

- 业主反馈截图保存为 `evidence/user-feedback-r2-underside.png`。原因定位：R2代码把灯座轴线沿径向横放，灯臂端点停在球罩侧面；图上因此像白球被侧面插接。R2还让两层灯臂都从同一高度起弧，中心件是平圆盘加细直杆，进一步产生占位模型感。
- R3修正：8个灯座改为球罩上方竖直古铜色阶纹件，灯臂接到灯座底部；上层臂从上盘起弧，下层臂从下杯起弧，两层统一向外上扬。下杯改为浅碗形，中心连接件和尾饰改为车削轮廓；吸顶木盘增加轻微收边。
- 保持8头、每臂单头、两层各4头、445mm总下垂、Ø880mm外包络、灯位和电气接口不变。球心仍以相同0.365m半径、45°层间错位构造；参考只有正视图，因此完整3D方位仍是未证实的预演假设，不冒充厂家实物结构。
- R3 URL：`http://localhost:5173/?v=20261017-antique8-r3`；runtime `evidence/runtime-r3.json` 记录页面ready、无配置错误、8个球罩/灯臂/灯座/PointLights、最低点和声明包络。
- 同版截图：`evidence/context-r3-v002.png`、`evidence/closeup-r3-v002.png`、`evidence/underside-r3-v002.png`、`evidence/topdown-envelope-r3-v002.png`、`evidence/elevation-r3-v002.png`。context仍有现有边梁遮挡；elevation和closeup用于看灯头与弧臂，underside/topdown用于数8头和确认径向假设。

## R4按业主澄清统一球罩高度

- 业主说明“8个球罩同高，只在水平方向错开”。R3把首轮“分两层错高”理解为球罩垂直分层；R4明确垂直球罩偏移属于错误解释，不能继续保留。
- 八个球心统一为 `y=2.425m`（相对2.80m锚点偏移-0.375m）；两组各4头仍按0°/45°在平面错开，半径0.365m不变。因此球罩下缘仍在y=2.355m，445mm总高与finial低点不变。
- 上组臂根继续连接上盘y=2.585m，下组连接下杯y=2.4405m；“臂根有高低”不代表“灯罩有高低”。上组弧臂向灯头下垂，下组向灯头上扬，两个组均终止于同高灯座底部。
- R4 URL：`http://localhost:5173/?v=20261017-antique8-r4`；`evidence/runtime-r4.json`记录8个球心y值完全相同、8个灯座/弧臂及8个球泡光源。
- 同版截图：`evidence/context-r4-v001.png`、`evidence/closeup-r4-v001.png`、`evidence/underside-r4-v001.png`、`evidence/topdown-envelope-r4-v001.png`、`evidence/elevation-r4-v002.png`。最后的水平机位用于直观看八罩同高；俯视用于看水平错位。

## R5按业主澄清统一弧臂根平面与拱向

- 业主进一步指出“所有灯珠应该是从同一个台面往上曲”。R4虽然已经让八罩同高，但把四根臂接上盘、另四根接下杯，并分成droop/rise两种方向，根部不共面、弯线形态也不同。
- R5将8根臂根全部置于上盘同一台面：中心半径0.07m、相对锚点 `y=-0.215m`（世界y=2.585m）；两个水平组仍为0°/45°，8根都使用 `rise` 和0.10m控制点拱高。中心线t=0.25处y=2.601m，高于根平面16mm；随后下弯至同高灯座底部。
- 球罩继续统一中心y=2.425m、下缘y=2.355m；灯位、Ø880mm包络、445mm总高、电气回路及支撑盘配置不变。下杯保留作装饰，不再承接弧臂。
- R5 URL：`http://localhost:5173/?v=20261017-antique8-r5`；`evidence/runtime-r5.json`记录8个球心同高、8个根点同高、曲线采样点全部先高于根平面、8灯/臂/座计数。
- 同版截图：`evidence/context-r5-v001.png`、`evidence/closeup-r5-v001.png`、`evidence/underside-r5-v001.png`、`evidence/topdown-envelope-r5-v001.png`、`evidence/elevation-r5-v001.png`。

## R6将共面弧臂根移至下杯

- 业主纠正R5：“是从下面那个台子往上曲的，而不是上面那个台子”。R6将八根弧臂根点一起从上盘移到下杯台面；共面root为 `y=2.4405m`、径向半径0.058m，全部向上拱至球罩顶部灯座。
- 八个球罩仍统一中心 `y=2.425m`，两个4头组仍在水平面错45°；总高、底点、外径和电气接口不变。下杯现在是弧臂的共同支撑台，上盘保留为吊杆和中心造型组件。
- 灯座底点 `y=2.495m` 高于根平面 `y=2.4405m`；R6统一rise后弧线仍先上拱再落到灯座底部。0.10m拱高下，t=0.25中心线 `y=2.492625m`，最高点约 `y=2.51975m`。
- R6 URL：`http://localhost:5173/?v=20261017-antique8-r6`；`evidence/runtime-r6.json`确认8根root Y均为2.4405m、球心Y均为2.425m、每个t=0.25点均高于root。
- 同版截图：`evidence/context-r6-v001.png`、`evidence/closeup-r6-v001.png`、`evidence/underside-r6-v001.png`、`evidence/topdown-envelope-r6-v001.png`、`evidence/elevation-r6-v001.png`。

## DEC-2026-10-17-R7与R6预演编号对齐

- `DEC-2026-10-17-R7` 是决策日志编号，不是新的渲染轮次。该决定将共同起弧面定为下杯，并由R6参数与R6同版截图/runtime实现：根点y=2.4405m、半径0.058m，8个球心y=2.425m。
- 先前草稿把 `DEC-2026-10-17-R7` 误写成独立“R7模型轮次”，并引用了不存在的 `*-r7` 截图/runtime。这里已移除这些无效引用；最终证据仍绑定 `?v=20261017-antique8-r6` 和 `evidence/*-r6-v001.png`、`evidence/runtime-r6.json`。
- 没有删除另一版模型或有效证据；R1–R5以及旧10头灯均保留在本目录历史和 `living-main-light-archive-20261017/`。

## 验证与证据

- `npm run gate:visual`：R2–R6各轮改前/改后均 CLEAR；R6最终哈希 ceiling `50c1c81f9ec8`、electrical `94c988caaf0b`、plumbing `7f1513d14f27`、materials `64176f576326`。
- `node --import tsx scripts/verify/project/verify-lighting-config.ts`：PASS，2个详细灯具配置。
- `node --import tsx scripts/verify/project/verify-project-render-facts.ts`：PASS；数据投影包含15个电气灯具，客厅主灯造型由 render facts 提供。
- `npm run verify:all`：R4/R6为17/17 PASS；R5复跑16/17，唯一失败为既有MEP基线对账：登记52处、机器实算51处，本轮未改MEP路线/清单；R6复跑时计数恢复一致。
- `npm run typecheck`：PASS。
- `npx vitest run src/render/InteriorLightingSystem.test.ts`（从 `app/` 使用本地Vitest）：R3–R6均17/17 PASS；新增断言验证8个球心同为y=2.425m、R6根点同为y=2.4405m，且曲线先高于下杯台面再接到灯座底部。
- `node --import tsx --test tests/server/cli-glb-export.test.ts`：13/13 PASS；验证共享几何能导出8个球罩、8根弧臂、8个灯座与中心下垂件。
- 完整 `npm run test:app`（R1尾饰修正前）：501通过、56失败；失败涉及既有 Vitest DOM/mock 环境（`ResizeObserver`/`document` 不存在、Three mock 缺少 `setRGB`/texture center 等），目标灯具专测在R2通过。
- 完整 `npm run test:server`（R1尾饰修正前）：非全绿；已观察到与本轮无关的 browser-boundary、家具 penetration 登记、solar α≤0、wall-face `document` 环境失败；R2目标 GLB 导出用例通过。
- R2同版运行时详见 `evidence/runtime-r2.json`；R1截图/runtime因尾饰高度修正保留为历史，不再证明当前最低点。
- R6浏览器关闭后发现 `data/presentation-state.json` 与启动前快照不同，已从 `/tmp/bontop_living_lamp_presentation_state_r2_20261017.json` 恢复；恢复后SHA256同为`6db183e8d4b5f8804c9f02cd30c9a12e19f5ad1e4c79113f6839833c558ec891`。随后重生成并验证R6 render facts，最终gate:visual CLEAR。

## 评审边界

R2–R5评审与图像均按版本保留，不覆盖R6。R5 PASS仅适用于上盘共面根；R6独立审美/功能复核均PASS。R6完整verify:all 17/17，灯具目标单测、类型检查、GLB目标用例及gate:visual通过。弧臂根点位于浅碗侧壁内少量嵌入，形成接合；立面可有水平错位的投影重叠。业主已于2026-10-17确认R6造型预演可提交；该确认仅覆盖当前3D造型关系。仍可能静默失效的条件见“改动审计”；不代表SKU、光度、承重或施工已定。
