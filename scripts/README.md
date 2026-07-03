# scripts / 工具脚本

本项目所有自动化工具脚本放在这里。

## 脚本规划

| 脚本名 | 用途 | 输入 | 输出 |
|--------|------|------|------|
| `parse_cad.py` | 解析 CAD 图纸，提取工程量 | `cad/design/*.dwg` | `budget/quantities.json` |
| `calc_budget.py` | 根据工程量计算预算 | `config/house.yaml`、`config/materials.yaml` | `budget/base.json` 更新 |
| `compare_quote.py` | 对比多家施工队报价 | `budget/quotes/*.xlsx` | `budget/quote_comparison.md` |
| `track_progress.py` | 跟踪施工进度与付款 | `contracts/*.yaml`、`budget/payments/` | `schedule/progress.json` |
| `render_batch.py` | 批量驱动 Blender 渲染 | `config/layout/final.yaml` | `renders/blender/output/` |
| `export_web.py` | 导出 Three.js 漫游数据 | `renders/blender/project.blend` | `renders/web/` |
| `audit_check.py` | 检查变更与预算一致性 | `budget/changes/*.json` | 审计报告 |

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
