# scripts / 工具脚本

本项目所有自动化工具脚本放在这里。

## 脚本规划

| 脚本名 | 状态 | 用途 | 输入 | 输出 |
|--------|------|------|------|------|
| `parse_cad.py` | 已可用 | 解析 CAD 图纸，提取 2D/3D 户型布局 | `cad/design/01_floor_plan/floor_plan_design_*.dxf` | `model-geometry-from-cad.yaml`（默认）/ `config/layout/model-geometry.yaml`（`--force`） |
| `calc_budget.py` | 规划中 | 根据工程量计算预算 | `config/house.yaml`、`config/materials.yaml` | `config/budget/base.json` 更新 |
| `compare_quote.py` | 规划中 | 对比多家施工队报价 | `budget/quotes/*.xlsx` | `budget/quote_comparison.md` |
| `track_progress.py` | 规划中 | 跟踪施工进度与付款 | `contracts/*.yaml`、`budget/payments/` | `schedule/progress.json` |
| `render_batch.py` | 规划中 | 批量驱动 Blender 渲染 | `config/layout/final.yaml` | `renders/blender/output/` |
| `export_web.py` | 规划中 | 导出 Three.js 漫游数据 | `renders/blender/project.blend` | `renders/web/` |
| `audit_check.py` | 规划中 | 检查变更与预算一致性 | `budget/changes/*.json` | 审计报告 |

> 注：旧脚本 `floorplan_to_dxf.py`、`generate_dxf.py`、`slice_floorplan.py` 及 `recognition_schema.json` 已删除。合同扫描图直接作为原始依据，套内布局以设计图 DXF 为准。

## `parse_cad.py`

Extracts the 2D/3D house layout from `cad/design/01_floor_plan/floor_plan_design_*.dxf`.

The parser reads the Chinese room labels on layer `SH-文字标注` (e.g., `主卧`, `次卧`) and maps them to project IDs.

```bash
python -m pip install -r requirements.txt
python scripts/parse_cad.py
```

By default, `parse_cad.py` writes the extracted layout to `model-geometry-from-cad.yaml` in the repo root. To overwrite the authoritative `config/layout/model-geometry.yaml`, run:

```bash
python scripts/parse_cad.py --force
# or
python scripts/parse_cad.py --output config/layout/model-geometry.yaml --force
```

Output log: `scripts/logs/cad-extraction-report.json`.

## 运行环境

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## 开发规范

1. 每个脚本必须能独立运行，并支持 `--help`。
2. 所有输出写入指定目录，不直接覆盖源文件。
3. 脚本变更需记录到 `audit/audit.log`。
