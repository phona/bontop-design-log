# 法式奶油风公开素材升级设计（Blender 决策渲染真实感 v1）

日期：2026-08-14
状态：待审定
触发：业主确认路线——弃酷家乐（非 AI native，订阅+学习成本不划算）与 Twinmotion（同因），改用 CC0 公开素材升级 Blender 决策渲染；明确"不需要多漂亮，只需要欧美简约法式奶油风"

## 背景与定位

- **决策系统定位不变**：Blender 管线是 tradeoff 排除法工具（A/B 相对差异可信），不是实物预览器。本 spec 只提升"风格可读性"到决策可用，不追照片级。
- **风格目标**：法式奶油风 = 奶油色调 + 人字拼 + 柔光 + 羊羔绒/亚麻柔软肌理 + 白漆木/浅木家具 + 少装饰。它是"色板+光线+肌理"驱动的风格，恰好是 CC0 免费资产最好做的一类。
- **现状**：Cycles 管线已通（v5：HDRi 外景、真透射玻璃、配置化场景、程序化木纹）。短板仅剩家具为体块色块、布艺无肌理。
- **架构铁律合规**：model-geometry.yaml / house.yaml / materials.yaml 仍是唯一权威源；家具摆位读 house.yaml x/z/rotation，选材读 current-scheme.json。资产文件（模型/贴图）是**下游美术资产**，只增不改配置语义，禁止在资产里硬编码位置。

## 风格要素拆解与素材验证（已查证，全部 CC0）

| 要素 | 现状 | 素材来源（已验证库存） |
|---|---|---|
| 奶油色墙 #f7f5ef | ✅ 已渲 | — |
| 人字拼木地板 | ✅ wood_texture.py 已支持 herringbone | materials.yaml `floor_tile_herringbone_01` |
| 3000K 暖光+柔影 | ✅ 已渲 | — |
| 纱帘柔光 | ✅ 真半透明已渲 | — |
| 羊羔绒 boucle 沙发面料 | 🔶 待接线 | Poly Haven `wool_boucle`（12K 卷绒）、`curly_teddy_natural`（米色卷毛绒） |
| 亚麻纱帘肌理 | 🔶 待接线 | Poly Haven `rough_linen` |
| 白皮革床头 | 🔶 待接线 | Poly Haven `leather_white` |
| 白漆木家具（奶油风标配） | 🔶 待挑选 | Poly Haven Painted Wooden 系列（sofa/cabinet/nightstand/chair/table/bench/shelves，风格天然统一） |
| 床+床品 | 🔶 待挑选 | BlenderKit 免费层 |
| 浅木餐桌椅 | 🔶 待挑选 | Poly Haven `Wooden Table` / `Dining Chair 02` |
| 法式石膏线（墙面线条） | ⚪ 可选 | 几何生成（本 spec 标可选，见"明确不做"外的条件） |

## 目标 / 非目标

**目标**：
- 客厅+主卧两机位渲染图"一眼法式奶油风"：奶油色+人字拼+暖光+真实主角家具（沙发/床/餐桌椅/电视柜）+柔软肌理
- 家具资产归一化管线可复用：新家具入库 = 下载 → 归一化 → 登记一行 YAML
- 布艺材质按 fixture 类型映射接线（boucle→沙发、linen→纱帘、白皮革→床头）
- A/B 能力保留：floor 选材切 `floor_tile_herringbone_01` 即出人字拼对比图（管线已支持，本次顺带产出）

**非目标**：
- 不做厨卫电器精细模型（冰箱/灶台/烟机/水槽/洁具保持体块，不在两决策机位视野中心）
- 不做全屋配饰（绿植/摆件/挂画/书）——v1 只要风格骨架
- 不做法式石膏线 v1（列为 v2 可选；业主 DEC-011 已定"直铺+线条/灯光承担法式骨架"，若指墙面石膏线则 v2 再议）
- 不做 Twinmotion/酷家乐同级资产广度
- 不改 three.js 端任何东西（本 spec 纯 Blender 下游）

## 技术方案

### 1. 家具资产归一化管线 `scripts/blender/asset_pipeline.py`

每件资产走固定三步，产物入库 `assets/furniture/<fixture_type>/`：

1. **下载**：BlenderKit（.blend）/ Poly Haven（.glb/.fbx），记录来源 URL 与 license（CC0）到 `assets/furniture/SOURCES.md`
2. **归一化**（脚本批处理）：
   - 缩放：资产包围盒 XY footprint → `FURNITURE_DIMS[fixture_type].width/depth`（等比，Z 随动）
   - 归位：pivot 移到 footprint 中心、贴地（min z = 0）、面向 +Y（与 house.yaml rotation 语义一致：rotation=0 朝北）
   - 材质：保留原贴图；命名材质前缀 `fixture_type:`
   - 导出单体 `.glb` 到 `assets/furniture/<fixture_type>/model.glb`
3. **登记**：`config/fixture-assets.yaml` 加一行

```yaml
sofa_3seat:
  model: assets/furniture/sofa_3seat/model.glb
  source: polyhaven/painted_wooden_sofa
  material_override:
    fabric: { type: texture, id: wool_boucle, tint: '#f2ede4' }
bed_180:
  model: assets/furniture/bed_180/model.glb
  source: blenderkit/xxx
```

### 2. 摆位接线 `dress_scene.py` 扩展

- glb 导入后，对 `classify() == 'furniture'` 的**体块组**（objectId `furniture:<room>:<type>:<index>`）：
  1. 读 objectId 拆出 room/type/index → 查 house.yaml furnishings 得 x/z/rotation
  2. `config/fixture-assets.yaml` 有该 type → 隐藏体块，原位导入资产 glb，应用 rotation
  3. 无登记 → 体块照常（兜底，管线不炸）
- 体块组隐藏用 `hide_render`（不动 glb 源数据，与 blackout 处理同模式）

### 3. 布艺材质接线 `materials_from_yaml.py` 扩展

`material_override` 按类型处理：
- `type: texture`：从 `assets/textures/<id>/` 下载（Poly Haven API，diffuse+rough+normal 1K 足够决策用），构建贴图材质；`tint` 乘色统一到奶油色系
- `type: solid`：直接 Principled 赋色
- 贴图下载脚本 `scripts/blender/fetch_texture.py`（API 直链，带文件大小校验——v5 已踩过 Poly Haven 截断坑）

### 4. 人字拼 A/B（顺带）

- 切 current-scheme.json floor → `floor_tile_herringbone_01` 渲一套，与直铺 v5 同机位对比，喂 DEC-011 门店终审前的 3D 关
- 人字拼贴图已由 wood_texture.py 生成（S 周期无缝 wrap），无需新代码

## 分步任务

| # | 任务 | 产出 | 工时 |
|---|---|---|---|
| 1 | asset_pipeline.py 归一化管线 + fixture-assets.yaml schema | 管线脚本 + 空登记文件 | 2h |
| 2 | 沙发（Painted Wooden Sofa + wool_boucle）全链路打通 | 客厅图出现 boucle 奶油沙发 | 2h |
| 3 | 床+床品（BlenderKit 挑奶油系） | 主卧图出现真实床 | 2h |
| 4 | 餐桌椅 + 电视柜（浅木/白漆木） | 客厅图完整 | 2h |
| 5 | 布艺三件套接线（boucle/linen/leather_white） | 沙发/纱帘/床头有肌理 | 2h |
| 6 | 人字拼 A/B 两套渲染 | DEC-011 3D 对比图 | 1h |
| 7 | 验收文档更新 | pipeline-acceptance.md 增 v6 节 | 0.5h |
| 合计 | | | **~12h** |

## 验收标准

1. **风格可读**：客厅/主卧两机位图，奶油色调+人字拼+暖光+真实沙发/床+纱帘外景，一眼法式奶油风（业主目检）
2. **几何一致**：资产摆位与 house.yaml 一致（沙发中心 (11,7)、床 (3.2,7.88)），rotation 正确；与 three.js 走查一致
3. **配置驱动**：换 fixture-assets.yaml 一行 → 重渲即换家具；改 current-scheme floor → 直铺/人字拼切换，全程不改代码
4. **可复现**：同配置两次渲染一致（Cycles seed=42 已有）；资产文件入 git LFS 或 SOURCES.md 记录 URL 可重下
5. **管线兜底**：删除任一资产文件，渲染回退体块不报错

## 风险与对策

| 风险 | 概率 | 对策 |
|---|---|---|
| Painted Wooden 系列尺寸/比例不合 FURNITURE_DIMS（如沙发实际 2.0m vs 需 2.8m） | 中 | 归一化等比缩放可接受±15% 形变；超差则换 BlenderKit 款 |
| BlenderKit 免费层奶油系床品少 | 中 | Sketchfab CC-BY 备选（需署名，SOURCES.md 记录）；或 Painted Wooden Nightstand 拼床架+程序化床垫 |
| 资产贴图带非奶油色（深色木/艳色布） | 高 | material_override tint 统一压奶油色 |
| Poly Haven 下载截断（已踩过） | 已知 | fetch_texture.py 强制校验文件大小与 magic bytes |
| 床品布料软塌感做不出 | 高（v1 接受） | v1 接受"硬板床+奶白床品色"，软塌靠 v2 布料模拟或直接忽略——决策不影响 |

## 明确不做

- 厨卫电器/洁具精细模型、全屋配饰（绿植/摆件/挂画）
- 法式石膏线 v1（v2 可选）
- 布料物理模拟、真实褶皱
- 衣柜精细模型（主卧机位看不到衣柜正面，体块保留）
- 任何 three.js 端改动、任何 model-geometry/house.yaml 语义改动
- Twinmotion/酷家乐任何形式的使用或兼容

## 开放问题（审定前确认）

1. 风格参考：业主是否有具体参考图定调（羊羔绒 vs 科技布沙发？白漆木 vs 浅橡木？）——影响任务 2/4 的挑选方向
2. 衣柜是否在视野内需要精细（当前主卧机位衣柜在相机背后，默认不做）
3. fixture-assets.yaml 放 `config/` 还是 `assets/`——倾向 config/（声明式登记），资产文件本体放 assets/
