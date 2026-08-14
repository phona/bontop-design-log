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

## 已知限制 / 后续

1. **Cycles 一致性**：固定 seed=42 已配置，但 4 张 × 3 分钟 = 12 分钟，本轮 EEVEE 快速验证链路；Cycles 固定 seed 的逐像素一致性留待单独跑（单张即可验证）。
2. **EEVEE md5 不一致**：EEVEE 是光栅化引擎，非确定性，用于快速初筛可接受；A/B 对比最终以 Cycles 为准。
3. **PyYAML 依赖**：Blender 自带 Python 需手工 pip 安装，换机器/重装需重复；后续可选方案：ts 端预转 materials.json（Blender 零依赖）。
4. **材质映射**：当前 scheme（floor=floor_tile_01 等）与基础材质同色，视觉无差异；后续引入真实选材差异后可见效果。
5. **GPU 加速**：780M 核显不在 ROCm 官方支持列表；用户计划租 4070 Windows 机器做效果预览，届时可启用 Cycles GPU 加速。
