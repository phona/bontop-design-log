# PBR 贴图来源（CC0，不入 git，可重下）

> 贴图文件在 `assets/textures/<id>/`（diff.jpg / normal.jpg / rough.jpg），被 .gitignore 排除。
> 重下脚本：`wget --no-proxy "<url>" -O assets/textures/<id>/<variant>.jpg`

## 注意下载时文件名

Poly Haven 的 normal 贴图变体名是 `nor_gl`，下载时必须重命名为 `normal.jpg`：
```bash
wget --no-proxy "<url>/xxx_nor_gl_2k.jpg" -O assets/textures/<id>/normal.jpg
```
否则 `materials_from_yaml.py` 的 `_build_pbr_textured` 找不到 normal.jpg → 回退纯色灰。

## 贴图清单

| texture_id | 来源 | diffuse URL | 用途 |
|---|---|---|---|
| herringbone_parquet | [Poly Haven](https://polyhaven.com/a/herringbone_parquet) | `.../jpg/2k/herringbone_parquet/herringbone_parquet_diff_2k.jpg` | 人字拼地板（拼法内置） |
| oak_veneer_01 | [Poly Haven](https://polyhaven.com/a/oak_veneer_01) | `.../jpg/2k/oak_veneer_01/oak_veneer_01_diff_2k.jpg` | 直铺地板（无缝木纹+砖缝） |
| wooden_floor_01 | [Poly Haven](https://polyhaven.com/a/wooden_floor_01) | `.../jpg/2k/wooden_floor_01/wooden_floor_01_diff_2k.jpg` | 备选直铺 |
| old_wooden_floor_01 | [Poly Haven](https://polyhaven.com/a/old_wooden_floor_01) | `.../jpg/2k/old_wooden_floor_01/old_wooden_floor_01_diff_2k.jpg` | 备选直铺（旧木纹） |
| wooden_planks | [Poly Haven](https://polyhaven.com/a/wooden_planks) | `.../jpg/2k/wooden_planks/wooden_planks_diff_2k.jpg` | 备选直铺（橡木纹） |
| white_planks_clean | [Poly Haven](https://polyhaven.com/a/white_planks_clean) | `.../jpg/2k/white_planks_clean/white_planks_clean_diff_2k.jpg` | 已弃用（白漆无木纹） |
| laminate_floor_02 | [Poly Haven](https://polyhaven.com/a/laminate_floor_02) | `.../jpg/2k/laminate_floor_02/laminate_floor_02_diff_2k.jpg` | 直铺地板（真扫描长板+自带缝，推荐直铺候选） |
| plank_flooring_02 | [Poly Haven](https://polyhaven.com/a/plank_flooring_02) | `.../jpg/2k/plank_flooring_02/plank_flooring_02_diff_2k.jpg` | 已弃用（窄板+钉眼，像木箱板） |
| oak_veneer_02 | [Poly Haven](https://polyhaven.com/a/oak_veneer_02) | `.../jpg/2k/oak_veneer_02/oak_veneer_02_diff_2k.jpg` | 600x1200 木纹砖用弱纹细直纹（floor_pbr_tile_612） |
| marble_01 | [Poly Haven](https://polyhaven.com/a/marble_01) | `.../jpg/2k/marble_01/marble_01_diff_2k.jpg` | 台面石纹（仅 normal+rough，保浅色石英） |
| painted_plaster_wall | [Poly Haven](https://polyhaven.com/a/painted_plaster_wall) | `.../jpg/2k/painted_plaster_wall/painted_plaster_wall_diff_2k.jpg` | 墙面乳胶漆肌理（仅 normal+rough，保色号） |
| fabric_pattern_07 | [Poly Haven](https://polyhaven.com/a/fabric_pattern_07) | `.../fabric_pattern_07_col_2_2k.jpg` | 床品 bump（保白色）+ 沙发布纹底图（2026-08-22 补下载 col_2 色号存为 diff.jpg；该资产无 Diffuse 键，色图为 col_1/2/03） |

## 下载方式

```bash
# 下载某张贴图三通道（diffuse + normal + rough）
id=oak_veneer_01
mkdir -p assets/textures/$id
wget --no-proxy --timeout=60 "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/$id/${id}_diff_2k.jpg" -O assets/textures/$id/diff.jpg
wget --no-proxy --timeout=60 "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/$id/${id}_nor_gl_2k.jpg" -O assets/textures/$id/normal.jpg
wget --no-proxy --timeout=60 "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/$id/${id}_rough_2k.jpg" -O assets/textures/$id/rough.jpg
```

> `--no-proxy` 必须加：本地代理 127.0.0.1:7890 未开时 wget 会连不上。

## 3D 家具模型（BlenderKit，需 API key）

| 模型 | 来源 | asset id | 文件 | 用途 |
|---|---|---|---|---|
| Sofa set（白布艺沙发+黑石几） | [BlenderKit](https://www.blenderkit.com/asset-gallery/127456/) | `bb772a64-bcd3-48bf-9224-12128c4377d9` | `assets/sofa_set.glb` | 客厅沙发（royalty_free） |

下载流程（需免费账号 API key）：
```bash
KEY=<blenderkit_api_key>
# 1. 拿临时下载 URL（scene_uuid 任意）
curl -H "Authorization: Token $KEY" "https://www.blenderkit.com/api/v1/downloads/578092/?scene_uuid=00000000-0000-0000-0000-000000000001"
# 2. 用返回的 filePath 下载 .glb
curl -L "<filePath>" -O assets/sofa_set.glb
```

## 3D 家具模型（Poly Haven，CC0，1k gltf+bin+textures）

`assets/furniture/<id>/` 每套含 `<id>.gltf` + `<id>.bin` + `textures/`（diff/nor_gl/arm），
重下脚本逻辑：查 `https://api.polyhaven.com/files/<id>` → `gltf["1k"].gltf.url`（主文件）
+ `gltf["1k"].gltf.include`（bin 与贴图，保持相对路径）。需带 User-Agent（API 对裸 urllib 返 403）。

| id | 用途 | 风格 |
|---|---|---|
| sofa_02 | ~~客厅三人沙发~~（弃用） | Chesterfield 弧形拉扣，DEC-026 否掉 |
| dining_chair_02 | ~~餐椅~~（弃用） | 高背拉扣厚重款，DEC-026 否掉 |
| industrial_coffee_table | ~~茶几~~（弃用） | 工业风方几，DEC-026 否掉；且带骨架绑定导致木板立起 |
| wooden_table_02 | 餐桌 | 矩形四腿实木桌（Poly Haven 无深色长餐桌，此款比例正确、色偏中，tint 压深胡桃） |
| WoodenTable_01 | ~~餐桌~~（弃用） | 实测为 0.55m 高矮凳，比例不符，v9 起停用 |
| modern_wooden_cabinet | ~~电视柜~~（弃用） | 带滑门动画/自定义 ARM 贴图，导入材质全黑且滑门跑偏，v9c 起回退程序化深胡桃体块 |
| mid_century_lounge_chair | 单人休闲椅（备选，未摆位） | 棕色皮 + 弯木壳（中古标配） |
| potted_plant_01 | 琴叶榕位绿植 | 陶盆阔叶树（替代绿方块程序植物） |

## 3D 家具模型（BlenderKit，royalty_free/CC0，.blend append 接入）

| id | BlenderKit asset | 授权 | 用途 |
|---|---|---|---|
| burrard_sofa | [Burrard Forest Green Sofa 3 Seaters](https://www.blenderkit.com/asset-gallery/1ee7fa07-0b88-4f4e-af59-a5dcd65259a8) | royalty_free（免费） | 直排三坐垫+细木腿，tint 压深棕（DEC-026 沙发款） |
| rattan_dining_chair | [Wood dining chair](https://www.blenderkit.com/asset-gallery/33ef21d4-fe67-43e4-b5f6-7d6bcd5190d4) | royalty_free（免费） | 黑细腿+藤编靠背餐椅（DEC-026 餐椅款） |
| noguchi_coffee_table | ~~茶几~~（弃用） | CC0 | 黑座玻璃圆几——体量过小、雕塑感过强像装饰边几，DEC-026 复审否掉，主茶几改程序化圆几 |
| washer | [Washing machine](https://www.blenderkit.com/asset-gallery/f3054fb0-2e9a-482a-855d-6faf0fc0992f) | royalty_free（免费） | 2026-08-23 阳台洗衣机（生活阳台西墙，0.60×0.85） |
| dryer | [Samsung Washer Dryer](https://www.blenderkit.com/asset-gallery/b8240af4-93d5-41a3-8a3d-c1e4640d80d2) | royalty_free（免费） | 2026-08-23 阳台烘干机（叠放 lift 0.88；套组含洗衣机+展柜，drop_nodes 只取烘干机 mesh） |
| dishwasher | [Dishwasher-01](https://www.blenderkit.com/asset-gallery/a67f6695-5565-4532-b57e-da9ecdb33a70) | royalty_free（免费） | 2026-08-23 厨下洗碗机（北墙地柜留位 x∈[8.5,9.1]） |
| water_heater | [Shower Water Heater](https://www.blenderkit.com/asset-gallery/c31ce5fb-3783-4cfa-9710-358a6c6119ba) | royalty_free（免费） | 2026-08-23 燃气壁挂热水器（阳台东墙暂定位 lift 1.40，#26 未定案；首下 Gas Boiler 为落地炉型已弃） |
| fridge | [Electrolux French Door Refrigerator](https://www.blenderkit.com/asset-gallery/7e12a0ce-47df-44ce-8bb8-2dc9ab50cc97) | royalty_free（免费） | 2026-08-23 东墙高柜位冰箱（渲染宽度归一化 0.68m、高 1.80m） |
| gas_stove | ~~Build In Gas Stove 75x51~~（弃用） | royalty_free | 2026-08-23 原始 75×51cm 规格匹配开孔，但 append→摆位四元数复合后成为 51cm 高立块（EEVEE v35b），继续使用程序化嵌入式灶具 |
| range_hood | ~~Whirlpool Range Hood~~（弃用） | royalty_free | 2026-08-23 筛选结果为 13cm 顶吸薄板，无竖向烟管；与东墙壁挂烟机不符，继续使用程序化壁挂烟机 |

下载流程（API key 放环境变量，**不入库**）：
```bash
KEY=<blenderkit_api_key>
# 1. 资产详情拿 files[].id（fileType=blend；付费资产下不了，挑 isFree=true）
curl -H "Authorization: Token $KEY" -H "Accept: application/json" "https://www.blenderkit.com/api/v1/assets/<uuid>/"
# 2. 拿临时下载 URL，再下 .blend
curl -H "Authorization: Token $KEY" "https://www.blenderkit.com/api/v1/downloads/<file_id>/?scene_uuid=00000000-0000-0000-0000-000000000001"
curl -L "<filePath>" -o assets/furniture/<id>/<id>.blend
```
> 注意：BlenderKit 多为 .blend（Zstandard 压缩），dress_scene.py 走 `bpy.data.libraries.load` append；
> Cara/Cesca 餐椅为付费资产（401），选品时先查 isFree。

> Blender `import_scene.gltf` 直接读 .gltf（相对引用 bin/textures 同目录解析）。

## HDRi 外景（Poly Haven tonemapped JPG，伪装 .hdr）

| 文件 | 来源 | 说明 |
|---|---|---|
| `hdri/the_sky_is_on_fire_1k.hdr` | [Poly Haven](https://polyhaven.com/a/the_sky_is_on_fire) | 蓝调日落海景（实为 tonemapped JPG） |
| `hdri/kloppenheim_02_1k.hdr` | [Poly Haven](https://polyhaven.com/a/kloppenheim_02) | 夜晚星空（实为 tonemapped JPG） |
| `hdri/kloofendal_48d_partly_cloudy_1k.hdr` | [Poly Haven](https://polyhaven.com/a/kloofendal_48d_partly_cloudy) | **真 Radiance HDR**，白天多云带太阳，daylight 工况外景+环境光 |

> Poly Haven 真 .hdr 直链可用（`.../HDRIs/hdr/1k/<id>_1k.hdr`）；旧两张是 8-bit JPG 冒充，
> 仅夜景/蓝调用（氛围为主，精度要求低）。
