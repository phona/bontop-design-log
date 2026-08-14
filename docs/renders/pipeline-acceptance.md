# Blender 渲染管线 · 阶段1 最小化验收记录

日期：2026-08-14
范围：最小化跑通"配置 → 批量渲染"链路（决策用 A/B 质感图）。

## 验收结论

**✅ 链路跑通。** 一条命令从 `render-config.json` 批量渲染 2 机位 × 2 场景 = 4 张图，命名含版本号，Cycles 固定 seed 保证 A/B 一致性。

## 命令

```bash
"/mnt/e/Blender Foundation/Blender 5.2/blender.exe" --background --python scripts/blender/dress_scene.py -- \
  --glb <house.glb> --config scripts/blender/render-config.json \
  --engine EEVEE --out-dir <renders_dir> --version v1 \
  --config-dir "//wsl.localhost/Ubuntu/home/tao/projects/bontop-design-log"
```

- 前置：`npx tsx scripts/blender/gen-render-config.ts` 生成配置（场景常量 + 机位清单）
- 依赖：Blender 自带 Python 需 `pip install pyyaml`（`materials_from_yaml.py` 用）
- 注意：Blender(Windows) 读 WSL 路径用正斜杠 UNC：`//wsl.localhost/...`

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

**硬编码收敛完成**：scenario 增加 exposure/blackout_state/sheer_opacity，dress_scene 全部读配置，管线代码为纯执行器（施工说明"Blender 端零手工状态"达标）。

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
6. **法式石膏线**：add_moldings 从 model-geometry.yaml 读墙体坐标 + overlay.yaml suppress 列表 → 生成 81 条（踢脚 8cm + 顶角 10cm + 挂镜 2cm@1m），仅实体墙（suppressed 跳过）。classify `molding:` → `wall` 用墙面材质。
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
