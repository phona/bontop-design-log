# Blender 渲染管线 · 阶段1 最小化验收记录

> **PAUSED / HISTORICAL — 2026-09-01**：以下命令与路径仅记录历史验收，不是当前入口。Blender 源码冷归档见 `scripts/archive/blender-pipeline/README.md`；当前默认效果预览为 Web + GPT，Web/CLI GLB 保持 active。

日期：2026-08-14
范围：最小化跑通"配置 → 批量渲染"链路（决策用 A/B 质感图）。

## 验收结论

**✅ 链路跑通。** 一条命令从 `render-config.json` 批量渲染 2 机位 × 2 场景 = 4 张图，命名含版本号，Cycles 固定 seed 保证 A/B 一致性。

## 命令

```bash
bash scripts/run-blender.sh --glb <house.glb> --config scripts/blender/render-config.json \
  --engine EEVEE --out-dir <renders_dir> --version v1 --config-dir .
```

- 前置：`npx tsx scripts/blender/gen-render-config.ts` 生成配置（场景常量 + 机位清单）
- 依赖：Blender 自带 Python 需 `pip install pyyaml`（`materials_from_yaml.py` 用）
- 注意：wrapper 根据 Blender 可执行文件和 `BLENDER_HOST` 选择 Linux/Windows，并在 WSL 调 Windows Blender 时自动转换项目路径。

## 输出

| 文件 | 内容 |
|---|---|
| `v1__living_sofa_glass__blue_hour.png` | 客厅全景 · 蓝调时刻 |
| `v1__living_sofa_glass__night.png` | 客厅全景 · 夜晚 |
| `v1__master_bed_looking_glass__blue_hour.png` | 主卧看南窗 · 蓝调时刻 |
| `v1__master_bed_looking_glass__night.png` | 主卧看南窗 · 夜晚 |

## 采样验证（蓝调时刻·客厅）

- 玻璃区 (176,186,207)：蓝色透出 ✅
- 天花板 (152,150,148)：中性不蓝 ✅
- 中部 (176,187,207)：玻璃蓝延续 ✅

## 资源使用实测（2026-08-14）

- **EEVEE**：渲染时 GPU 100%（核显 780M 光栅化），正常且证明核显能流畅跑交互预览。
- **Cycles**：CPU 稳定 100%（16 线程全满，PowerShell 计数器实测 217 采样点）。用户感知的"利用率低"多为观察时机问题——Cycles 有较长场景构建/加载期（导入 glb+建材质），此阶段 CPU 不高，真正渲染采样时才吃满。
- **780M HIP 实测**（2026-08-14）：`AMD Radeon 780M Graphics` 被 Blender 5.2 识别为 HIP 设备且可启用（`cycles.device=GPU`）。但单张 1080p@256 采样耗时约 4 分钟，与 CPU 相当、无加速收益——核显算力限制。管线已实现 HIP/OptiX/CUDA 自动探测（set_engine），在 NVIDIA 独显（4070）上将自动走 OptiX 加速；本机 HIP 可用但不更快。

## v3 决策渲染观感（2026-08-14，4090D 云服务器）

**结论：Cycles 批量渲染观感达标。** 4 张图（2 机位×2 场景）每张 28~55 秒（4090D OptiX），已存 `renders/blender/output/cycles-v3/`。

v1（首版 Cycles）效果差的根因与修复：
1. **遮光帘挡死玻璃**：GLB 里 `curtain_living_south:blackout` 全宽 6.2m 不透明布 → 渲染时隐藏 `:blackout`（视同拉开）
2. **纱帘不透**：Cycles 下 Principled alpha 基本失效 → `new_sheer_transparent`（Transparent BSDF 混合，85% 透）
3. **窗外天黑**：太阳地平线下 HOSEK_WILKIE 近黑 → 场景自定义天光色 `world_color/world_strength`（蓝调 #3a5a8f@0.35 / 夜晚 #060a14@0.06），两场景拉开差异
4. **主卧相机怼墙**（南窗中心 x=1.5 但 target x=2.8）→ 改西北角全景机位 (0.7,1.6,5.9)→(3.2,1.0,9.5)，床+窗入画
5. **夜景过暗** → Cycles 曝光 0.3→0.5

已知欠缺（下一阶段）：材质为纯色无纹理（地板无木纹、家具为体块），与 three.js 的 TextureFactory 程序化木纹差距大——需要把程序化纹理移植进 Blender。

## v4 木纹贴图（2026-08-14，4090D）

**地板木纹砖与 three.js 视觉一致。** `wood_texture.py` 逐行移植 TextureFactory.drawWoodPlankTextures（mulberry32 逐位复刻，同 seed 同图）：8 版面色族、AO 板缘、V 型倒角高度图（Sobel 法线）、纹带/木节、直铺+人字拼。Mapping 缩放 1/worldSize，GLB 米制 UV 直接平铺。渲染图存 `renders/blender/output/cycles-v4/`。

依赖：Blender 自带 numpy + 需 `pip install pillow`（云服务器已装；本地 Windows Blender 未装，如需本地渲染再装）。

剩余差距（下一阶段）：家具为体块色块（无真实沙发/床造型与布料质感）；人字拼方案 floor_tile_herringbone_01 换选材即可出 A/B（管线已支持，无需改代码）。

## v5 HDRi 外景（2026-08-14，4090D）

**玻璃透出真实外景。** Light Path 分离：Camera+Transmission+Singular 光线用 HDRi（透玻璃所见=真外景），其余照明用纯色（不污染室内）。蓝调=the_sky_is_on_fire（海边日落晚霞+海浪礁石），夜晚=kloppenheim_02（星空+月光+地平线城市灯光）。渲染图存 `renders/blender/output/cycles-v5/`。

**历史口径（已废弃）**：v5 曾让 scenario 携带 `blackout_state`。当前正式链路已改为 `overlay.yaml` 安装事实 + `presentation-state.json` 状态事实，经共享 `CurtainRenderProjection` 冻结；scenario 只保留 `sheer_opacity` 等材质表现参数，不再决定窗帘开合。

**坑记录**：Poly Haven 下载必须校验文件大小——截断的 .hdr 在 Blender 加载为 0×0 并以品红色渲染（极易误判为"HDRi 颜色不对"）。wget 比 curl 稳。

剩余断点：glb 手工从 three.js app 导出，未自动化（配置→渲染链路还差"配置→glb"）。

## v6 材质评审模式（2026-08-14，3080Ti 云）

**业主反馈 v5 不足以做 tradeoff**：色号不可信（AgX + 3000K 暖光污染）、拼法看不清（1024px 贴图 + 仅平视机位）、墙面没装饰。新增 `material_review` scenario + 4 个 35mm 特写机位 + 16 块候选色板 + `inspect_render.py` 自动质检。

| 项 | 氛围图（v5） | material_review（v6） |
|---|---|---|
| view_transform | AgX | Standard（无调色） |
| 灯光色温 | 3000K | 6500K（scenario `light_temp` 覆盖） |
| world | HDRi | 纯灰 #808080 |
| 色板 | 无 | 16 块候选 hex 受场景光渲染 |
| 贴图 | 1024px 程序化 | 2048px 程序化 → v7 换 PBR 真扫描 |
| 质检 | 人工目检 | inspect_render.py ΔE/diff/指纹 |

**坑记录**：
1. **Blender 5.0 中文 locale 节点名翻译**：`nodes.get('Principled BSDF')` 返回 None（实际名 '原理化 BSDF'）→ 全部改用 `_find_node(nt, bl_idname)` 按 `bl_idname` 查找（语言无关）。`Material Output` → '材质输出' 同理。**5.2 英文 locale 无此问题，但代码须兼容 5.0**。
2. **Brick 纹理输入顺序 5.0 与预期不同**：`[0]Vector [1]Color1 [2]Color2 [3]Mortar [4]Scale [5]MortarSize`（颜色在前数值在后），无 Offset 输入 → offset 是 node 属性 `brick.offset = 0.0`（直铺关错缝）。
3. **OptiX kernel 加载失败**（`OPTIX_ERROR_INTERNAL_COMPILER_ERROR`）→ set_engine 改 CUDA 优先（`('CUDA','OPTIX','HIP')`），3080Ti CUDA 稳定。
4. **卧室灯少太暗**：客厅 4 盏灯够亮，主卧仅 1-2 盏 → 加 per-camera `fill_light`（5×5m 200W area light 挂天花板），仅卧室机位启用。
5. **exposure -1.0 过暗**：试过 -1.0 压过曝 → 地板色板 ΔE 全炸（43-53）→ 回 0.0 + bedroom 补光 = 14/16 通过。
6. **Poly Haven 下载需 `--no-proxy`**：本地 wget 默认走 127.0.0.1:7890 代理，未开时返回 0 字节文件。
7. **`inspect_render.py` ΔE 采样**：用 three.js 算色板屏幕坐标 → inspect 区域采样 → ΔE76 对比。色板受场景光衰减，预期 ΔE < 25（非 0），超差 = 管线 bug。

验收：14/16 色板 ΔE 通过，无故障指纹，A/B diff 99.4% 像素变化。渲染图存 `renders/blender/output/mr-cloud/`。

## v7 PBR 真扫描贴图（2026-08-14，3080Ti 云）

**程序化木纹（wood_texture.py）肌理太假**：8 个色面随机 ±14 灰度 + 正弦波木纹带 → 4392 色，远不如真实扫描。新增 `pbr_texture` 材质类型：下载 Poly Haven CC0 PBR 扫描件（diffuse+normal+rough），替掉程序化生成。

| 贴图 | 来源 | 用途 | 颜色数（渲后） |
|---|---|---|---|
| herringbone_parquet | Poly Haven | 人字拼（拼法内置） | 20984 |
| oak_veneer_01 | Poly Haven | 直铺（无缝木纹+800mm 砖缝） | 17925 |

**混合方案（木纹砖效果）**：PBR 无缝木纹贴面 + Brick 纹理砖缝叠加 + tint 乘色 #c49a6c + coat 釉面 = 真木纹 + 方格砖缝 + 项目色号 + 瓷砖光泽。

**坑记录**：
1. **贴图文件名不匹配**：Poly Haven normal 变体名是 `nor_gl`，代码找 `normal.jpg` → 加载失败回退纯色灰 → 必须 `wget -O normal.jpg` 重命名。已记入 `assets/SOURCES.md`。
2. **white_planks_clean 是白漆木板**：木纹被白漆覆盖不可见 → 改用 `oak_veneer_01`（木纹贴面，天生无板缝）。
3. **直铺砖缝尺寸用错 150×900**：项目 floor_tile_01 实际是 **800×800mm 方砖**（spec: "800x800mm"），150×900 只是人字拼那条 → 直铺用 800×800，grout_frac 0.005（~4mm 缝）。
4. **PBR 贴图自带板缝与叠加砖缝冲突**：wooden_floor_01 等地板扫描件有自己的板缝间距（≠800mm），叠加 Brick 砖缝后两套缝不重合 → 看起来"小块长砖一块块接"而非方格 → 改用 veneer 系列（无自身板缝，砖缝是唯一分割线）。
5. **tint multiply 只能压暗**：#c49a6c 线性值 <1.0，乘色后画面变暗（mean 161→99）。不影响相对比较（A/B 同 tint），但绝对亮度偏低。
6. **法式石膏线**：add_moldings 仅读取 `overlay.yaml` 的显式 `moldings` 声明；当前未声明时不生成任何踢脚线、顶角线或挂镜线。`suppress` 只负责抑制已声明的墙段，不会反向推导装饰线；显式生成的 `molding:` 使用墙面材质。
7. **墙面漆纹**：wall solid_color 材质加 Noise bump（Scale 80, Strength 0.02）模拟橙皮纹。

贴图不入 git（.gitignore `assets/textures/*/`），来源 URL 记 `assets/SOURCES.md` 可重下。

## 已知限制 / 后续

1. **Cycles 一致性**：固定 seed=42 已配置，但 4 张 × 3 分钟 = 12 分钟，本轮 EEVEE 快速验证链路；Cycles 固定 seed 的逐像素一致性留待单独跑（单张即可验证）。
2. **EEVEE md5 不一致**：EEVEE 是光栅化引擎，非确定性，用于快速初筛可接受；A/B 对比最终以 Cycles 为准。
3. **PyYAML 依赖**：Blender 自带 Python 需手工 pip 安装，换机器/重装需重复；后续可选方案：ts 端预转 materials.json（Blender 零依赖）。
4. **材质映射**：当前 scheme（floor=floor_tile_01 等）与基础材质同色，视觉无差异；后续引入真实选材差异后可见效果。
5. **GPU 加速**：780M 核显不在 ROCm 官方支持列表；用户计划租 4070 Windows 机器做效果预览，届时可启用 Cycles GPU 加速。
6. **glb 手工导出**：three.js app → 手工点导出按钮 → house.glb，未自动化。
7. **tint 压暗**：multiply 模式只压暗不提亮，浅色色板会偏暗。后续可改 mix 模式（tint_color × pct + original × (1-pct)）。
8. **版面数=1**：PBR 贴图按 800mm 平铺，每块砖木纹不同（连续纹理切割），非真实印刷砖（每块独立印花+6-8 版面交替）。决策用够，实物门店看版面数。

## v8 真实感升级：中古胡桃家具 GLB + daylight 真光照（2026-08-20，4090D 云）

触发：业主提供中古风实景参考图，要求渲染更真实、更有参考性（DEC-2026-08-20-025）。

**变更**：
1. **家具 GLB 化**（Poly Haven CC0，`assets/furniture/`）：`FURNITURE_GLB` 扩展 sofa_3seat=sofa_02（黑皮拉扣+深木框）、dining_table=WoodenTable_01、dining_chair=dining_chair_02（深棕皮）、tv_stand=modern_wooden_cabinet（深胡桃格栅）。替换旧 BlenderKit 白布艺沙发。
2. **地板渲染参数校准**：tint #c49a6c→#d4b48a（浅暖橡木去红）、coat 0.3→0.1、roughness 0.55 覆盖贴图（柔光釉，对齐 DEC-024 门店四问）。
3. **daylight 工况重写**：真 HDR 外景（kloofendal_48d_partly_cloudy 1k，**真 Radiance HDR**——旧两张"hdr"实为 8-bit JPG）+ `world_hdri_lighting` 真天空直接照明（不再 Light Path 分离）+ 西南向午后太阳（当前配置 `sun_energy: 4` / 4500K）+ 不开灯 + `view_transform: AgX` / `exposure: -0.5` + `world_strength: 0.55`；移除与 HDRI/Sun 重复叠加的 `window_portal`。`daylight_clear` 仅保留 `glass_tint: #e8f0ee` 差异，其他 daylight 光照与曝光参数一致。daylight 纱帘 0.35→0.25（减白色散射雾霾感）。

**坑记录（全是首次启用太阳/真光照暴露的存量问题）**：
1. **旧 daylight 的"亮"全靠室内灯**：lights_on=true 与"不开灯"注释自相矛盾。关灯+纯天光后画面死黑 → 真天空照明 + 曝光补偿才是正路。
2. **Cycles 玻璃挡死直射光**：Principled transmission 不算焦散 → 太阳/HDRI 直射 100% 被玻璃挡住（太阳隔离测试=室内全黑实锤）。修复=建筑可视化标准做法 `_glass_shadow_passthrough`：shadow ray 走 Transparent BSDF。**注意 MixShader Fac=0→输入1、Fac=1→输入2**，首次接线接反导致"相机看玻璃全透明（玻璃隐形）+ 阴影光线走真玻璃（太阳照挡）"。
3. **add_sun 方向从未验证过**：旧工况 sun_direction 全 null，add_sun 是死代码路径。Blender 日光灯 -Z 须指向光线行进方向（= sun_dir 反向），原代码对齐 sun_dir 本身=光线射向天空。
4. **内外光比不可兼得**：照明强度 1.5 下窗外必然过曝成白墙。修复=双 Background 分控（照明强/窗外可见弱），窗外可见光线=相机+透射+单次反射三类求和（漏掉透射=透玻璃看外景仍过曝）。

**渲染成本**：4090D CUDA，1920×1080 Cycles 约 20-40s/张（本地 780M 核显 15min+ 不出图）。云渲染流程：rsync 项目 → 远端 Blender 5.2 headless → rsync 回 PNG。

## v9 生活感补强（2026-08-20，业主反馈"太素"后）

**变更**：
1. **灯具实体常驻**：`add_light_fixtures` 移出 lights_on 门控，加 `emit` 参数——daylight 关灯但吊灯/吸顶灯形体可见（吊灯是风格锚点）；关灯时灯罩深色金属不发光的。
2. **绿植/茶几 GLB**：plant_fiddle=potted_plant_01（替代绿方块程序植物）、coffee_table=industrial_coffee_table（深木面+黑铁架；旧沙发套装自带黑石几随 sofa_set.glb 退役而消失，house.yaml 补 placed 茶几 (9.7,7.0)）。
3. **餐桌换型**：WoodenTable_01 实测 0.55m 高矮凳 → wooden_table_02（1.13×0.71×0.80，比例正确）；`import_furniture_glb` 支持 width/height 双约束取小，防长宽比失真拉飞高度。
4. **暖调阳光**：sun 5500K→4500K、能量 5→7。
5. **电视柜回退程序化**：modern_wooden_cabinet GLB 带滑门动画+自定义 ARM 贴图，导入材质全黑且滑门跑偏 → 回退程序化体块，`wood_dark` 改深胡桃 #503e2e（`build_furniture_materials` 同步中古胡桃定调）。

**坑记录**：
5. **glTF 导入对象 rotation_mode='QUATERNION'**：直接赋 `rotation_euler` 被静默忽略 → 所有 GLB 家具朝向全错（电视柜 90° 嵌进西墙、沙发朝向错误）。修复=赋值前 `obj.rotation_mode = 'XYZ'`。**这正是当年床 GLB"朝向修 180° 又回退"悬案的根因**（commit ce583df）。排查手段：`import_furniture_glb` 加 dims/loc 打印（保留），一眼看出轴向没翻。
6. **Poly Haven 家具挑款三坑**：标量尺寸与直觉不符（WoodenTable_01 是矮凳）、带动画的模型（滑门柜）不宜直接进管线、自定义 ARM 贴图包装方式导入即黑。挑款流程=预览图初筛 → 远程裸导入打 DIMS → 隔离小渲验材质，三步都过才进 FURNITURE_GLB。

**验证**：`npm run verify:furniture`（coffee_table 补 FURNITURE_DIMS 后警告清零）、`npm run typecheck`、`npm run test:app`（339 通过，FixtureFactory 补 coffee_table 配方）、v9c 九张指纹检测通过。

## v16 床 GLB 恢复与 WSL/Windows 路径坑（2026-08-22）

**变更**：床 GLB（`assets/bed_soft_modern.glb`，来源未登记）曾尝试进管线，**最终回退程序化床体**——headless 循环下导入姿态始终不稳（euler 平、渲染斜，未收敛），留 GUI Blender 定姿后再启用。机制保留在 `import_furniture_glb` 备用（drop_nodes/level_x/flip_axis 当前无条目引用，床启用时生效）。
资产两个坑（备查）：
1. 导出残留 2×2×2 辅助节点 `Cube` 撑爆包围盒 → `drop_nodes: ['Cube']`（按前缀匹配，导入重名会加 .NNN 后缀）。
2. 根节点 baked 30.5° X 展示倾角 → `level_x` 回正；因 block 四元数含额外 X 分量使共轭变号，代码两符号都试、取高度小者。
床头朝向与正反面在 headless 循环里难以目视迭代，若主卧机位床姿仍不对，用 Blender GUI 打开场景调 `rot_fix`/`flip_axis` 十分钟可定。

**WSL 调 Windows Blender 的路径经验**：
1. Windows Blender 对部分 Linux/WSL 路径格式支持有限；统一通过 `scripts/run-blender.sh` 调用，由 wrapper 自动转换 GLB、配置、输出和配置目录路径。
2. 仅路径参数会转换，普通业务参数（如 `--only`、`--mat-override`）保持原值；Linux Blender 使用绝对 Linux 路径。
3. app 导出 GLB：在正常桌面浏览器的页面中使用导出 UI 下载 `house.glb`；不要通过自动化浏览器截获下载。

## 可复现云端渲染 bundle（正式工作流）

### 1. 从桌面浏览器手动导出 Web GLB

在**正常桌面浏览器**打开项目页面，确认 GPU/WebGL 工作正常、场景已完整加载后，使用页面的 GLB 导出 UI 下载 `house.glb`。app 保留 `exportGlbDataUrl` 及 UI 手动导出能力；请将下载文件保存到明确的位置。

CDP/headless/agent-browser 自动导出已废弃，构建器也不会尝试启动或连接浏览器。此类自动化可能干扰正常桌面浏览器的 WebGL，因此不再作为正式交付链路的一环。

### 2. 纯命令行封装和校验

```bash
npm run build:render-bundle -- \
  --glb <手动导出的-house.glb> \
  --output-dir renders/web/models/acceptance-<timestamp>
npm run verify:render-bundle -- --bundle renders/web/models/acceptance-<timestamp>
```

构建器先运行 `generate:render-config` 和 `verify:project-render-facts`，再严格检查输入 GLB 的 header/chunk/index 引用、mesh 与有限 world bbox；检查通过后**复制**（不移动）它为 bundle 内的 `house.glb`，然后写入 facts、render config 与 manifest。它不会触发浏览器、Blender 或云端渲染。

窗帘采用 active-only GLB 快照：`overlay.yaml` 定义安装，`data/presentation-state.json` 定义状态，共享投影给出 `snapshotSha256` 与 `expectedVisibleNodes`。bundle build/verify 都要求实际 GLB 窗帘节点与投影完全一致，拒绝 missing、unexpected、unknown、duplicate 和陈旧状态；Blender 只校验节点、按 layer/variant 赋材，不补客厅纱帘，也不根据 scenario 改开合。`bare_shell` 仅以 `curtainPolicy=hidden_for_bare_shell` 隐藏软装，不改变规范状态。

### 交付边界

CLI/shared GLB 是正式几何唯一来源；Blender 负责 PBR maps、材质赋值与渲染灯光。Blender 后处理仅保留显式 overlay molding、HVAC coordination/reference view-only，以及已标记 `render-only` 的软装和吊顶完成度 staging；不得用 legacy 几何旁路补建正式家具、厨卫、灯具或基础吊顶。

bundle 目录严格包含以下四个交付文件：

1. `manifest.json`：schema、HEAD revision、dirty 状态/porcelain、输入 hash（含 overlay、presentation、model geometry 与 HVAC）、artifact bytes/SHA-256、render facts/GLB 摘要、窗帘 snapshot/effective states/expected+actual nodes，以及 `manual_web_export` 和原始输入 GLB basename（不记录绝对路径）。
2. `house.glb`：从桌面 Web 场景手动导出的二进制 glTF 副本。
3. `render-config.json`：Blender 的配置化固定场景常量、相机和导出的 facts。
4. `project-render-facts.json`：从 electrical/plumbing/ceiling/HVAC/render overrides/current scheme 投影的施工 facts。

默认只接受 clean Git 工作树，避免未记录的源状态进入云端。当前开发工作树必须显式使用 `--allow-dirty`；manifest 会记录完整 `git status --porcelain=v1`，供云端任务和验收审计。构建拒绝覆盖非空目录。

`verify:render-bundle` 是无浏览器、无源文件写入的 CLI 校验。它校验 manifest schema、手动导出 metadata 与 basename、相对路径（拒绝绝对路径和 `..`）、文件存在性/真实 bytes SHA-256、facts schema、`render-config.facts` 深度一致性，以及严格 GLB header/chunk/index 引用/有限 world bbox。对 clean bundle，它还要求当前 HEAD 等于 manifest revision，并在内存中从当前输入重建两份 JSON 后逐字节比对；dirty bundle 仅执行其自包含完整性验证。

云端只应消费已通过 verifier 的四文件 bundle，先记录 `manifest.json` 再运行既有 Blender 命令。不得在云端修改 bundle 内配置或重新导出 GLB；本工作流不保证 EEVEE/Cycles 的像素级确定性，只保证已手动导出的 Web GLB、配置和施工 facts 可审计、可校验。
