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
