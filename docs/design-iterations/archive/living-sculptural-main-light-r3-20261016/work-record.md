# 客厅侧架垂吊主灯 R3

## 复盘状态

R2虽然总下垂300mm，但用户最新仰视截图仍把灯读成吸顶灯。复盘确认其主要原因是Ø900×70mm薄平盘占据底部轮廓，铜弧位于盘上方，吊杆落在盘顶后被盘体遮挡。本轮保留R2失败截图和决定，不覆盖旧证据；改的是轮廓和连接关系，不再只调弧长或盘径。

R3首轮R8仰视探针确认钟形灯体和外侧弧已可见，但直线吊杆仍有大段落在灯体投影内；侧壳与发光体共面出现闪烁。按同一根因继续做结构修复，而非调相机或灯位：吊杆改为“顶盘外折—沿锥壳外侧下行—侧壳落点”的两段支撑；housing侧壳相对漫射体外偏4mm避免z-fighting。R8截图、runtime和审查保留为中间证据。

## R3模型提案

- 客厅锚点、1.0×1.0m最大平面包络、乳白宽面主光和单条暖铜结构保留；主灯仍不随餐桌定位。
- 总下垂取已批准250–350mm范围上限350mm；乳白灯体改为上口Ø900mm、下口Ø720mm、深200mm的收口钟形体，底面y=2.45m。
- 三根暖铜支撑杆从顶盘斜向外折，再沿钟形灯体侧面外侧下行到下缘以上60mm处，仰视可读为结构支撑；单条30mm铜弧从下侧端脚连接，沿南侧外凸并在底部轮廓外显露。
- 侧壳与乳白灯体保留4mm径向间距，避免重合表面闪烁，并保持锥形灯体侧面连续可读。
- 所有几何值是审图用模型参数，不是已选SKU或施工图。实际承重、侧架连接、风口和检修仍待厂家/现场核对。

## 差异审计

- **R2退出当前造型**：薄圆盘Ø900×70mm、弧架全部在盘上方、吊杆落盘顶的组合不再作为当前模型；R2源码和截图仍留在R2目录及历史DEC中。
- **R3新增造型**：加深并向下收口的灯体、外露两段式侧支撑杆、4mm分离的侧壳、侧壳吊点和沿灯体外侧显露的暖铜弧。变化目的是让垂吊关系能在仰视图中直接读出，并避免共面表面闪烁。
- **保留**：现有电气坐标/高度、回路/双控/MEP、吊顶/HVAC、餐桌与餐吊位置、3000K/Ra≥90/宽面漫射照明目标、流明冲突、轨道灯淘汰依据。
- **删除/替换了什么**：仅替换当前灯具造型参数；没有删除商品候选、价格口径、旧版截图、审查结论或任何空间/电气对象。
- **静默失效条件**：真实灯具结构若没有侧吊点，3D杆件会“看起来吊住但实物无连接”；若实际光源配光不足或不均匀，外形模型无法显示；现场梁位、风口、视线、承重与检修仍不会由渲染自动报警。

## 实现与验证

R3改动涉及共享灯具几何、灯具类型/schema和`config/render/lighting.yaml`；浏览器与GLB/export仍共用`shared/render/SculpturalDomeGeometry.ts`。

| 命令 | 结果 |
|---|---|
| `npm run generate:project-render-facts` | PASS，生成15个灯具事实 |
| `npm run typecheck` | PASS |
| `npm run verify:lighting-config` | PASS，1个详细灯具配置 |
| `npm run verify:all` | PASS，17/17 verifiers，0 failed |
| `npm run gate:visual` | CLEAR；ceiling `50c1c81f9ec8`、electrical `f2b49b7bcdb3`、plumbing `7f1513d14f27`、materials `64176f576326` |

没有运行测试套件；以上是本轮类型、配置、全项目验证和视觉门禁结果。

## 最终证据与审查

R8为中间探针；对应审美/功能PASS只适用于R8旧几何，保存在`review-manifest-r8-intermediate.json`。R9五视图探针显示支撑仍被锥壳遮住、整体仍像浅盘；R9没有独立双审，且当前R3 manifest内的source hash仍绑定R8，因此R9只作为诊断证据，不能标为最终review。该失败触发R4深钟形与外置连接脚修正，R3保持`incomplete`并由R4替代；R3旧决定、R8/R9图像和审查均保留。实际施工/商品review仍为site_pending。细节见`review-manifest.json`及R4目录。

- R8中间证据：`tmp/screenshots/living-main-light/living_main_light_after_r3_underside_v001.png`及同目录closeup/side/context/top-down；runtime/snapshot保留在`evidence/`根目录。
- R9诊断证据：`evidence/r9/`与`tmp/screenshots/living-main-light/living_main_light_after_r3_*_v002.png`；同机位帮助定位侧撑仍进入灯壳和大圆面占主轮廓，后由R4处理。
