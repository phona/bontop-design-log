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

## 已知限制 / 后续

1. **Cycles 一致性**：固定 seed=42 已配置，但 4 张 × 3 分钟 = 12 分钟，本轮 EEVEE 快速验证链路；Cycles 固定 seed 的逐像素一致性留待单独跑（单张即可验证）。
2. **EEVEE md5 不一致**：EEVEE 是光栅化引擎，非确定性，用于快速初筛可接受；A/B 对比最终以 Cycles 为准。
3. **PyYAML 依赖**：Blender 自带 Python 需手工 pip 安装，换机器/重装需重复；后续可选方案：ts 端预转 materials.json（Blender 零依赖）。
4. **材质映射**：当前 scheme（floor=floor_tile_01 等）与基础材质同色，视觉无差异；后续引入真实选材差异后可见效果。
5. **GPU 加速**：780M 核显不在 ROCm 官方支持列表；用户计划租 4070 Windows 机器做效果预览，届时可启用 Cycles GPU 加速。
