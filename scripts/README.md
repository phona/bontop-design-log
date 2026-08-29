# scripts / 工具脚本

本目录按职责分层保存项目自动化脚本。脚本只读配置并执行既有流程；本次整理不改变 Web/CLI 几何、家具坐标、轨道灯功能或 Blender 场景逻辑。

## 目录结构

```text
scripts/
├── cad/
│   └── parse_cad.py
├── verify/
│   ├── layout/       # topology/layout
│   ├── placement/    # furniture/point placement
│   ├── data/         # cross-file consistency
│   ├── rules/        # declarative rule checks
│   ├── collision/    # collision coverage checks
│   └── render/       # render facts/lighting/bundle checks
├── render/
│   ├── glb/          # CLI GLB build/export/inspect/compare
│   ├── bundle/       # render bundle build and manifest utilities
│   ├── capture/      # browser/CDP floor-plan capture and watcher
│   └── diagrams/     # top-down and MEP/HVAC diagrams
├── blender/          # Blender runtime and render support; not moved by this整理
├── archive/          # retained legacy scripts; never delete during整理
├── run-blender.sh    # top-level wrapper retained for remote/docs compatibility
└── test-run-blender.sh
```

## 正式入口

| 用途 | 入口 |
|---|---|
| CAD 提取 | `python scripts/cad/parse_cad.py` |
| 户型拓扑/布局校验 | `npm run verify:all`（内部调用 `scripts/verify/layout/`） |
| 家具、点位、规则、碰撞校验 | `npm run verify:furniture`、`verify:consistency`、`verify:rules`、`verify:collision` |
| 渲染 facts/灯光校验 | `npm run verify:project-render-facts`、`npm run verify:lighting-config` |
| GLB 导出/比较 | `npm run export:glb`、`npm run compare:glb` |
| Render bundle | `npm run build:render-bundle`、`npm run verify:render-bundle` |
| Floor-plan capture | `python scripts/render/capture/capture_floor_plan_screenshot.py` |
| Floor-plan watcher | `python scripts/render/capture/watch_floor_plan_and_compare.py` |
| 俯视图/MEP 图 | `python scripts/render/diagrams/draw-topdown.py`、`draw-mep-hvac-plan.py` |

package.json 中的命令名称保持不变；仅命令指向的正式脚本路径随目录整理更新。`scripts/blender/` 内的 runtime 文件和 bundle 中的 `scripts/blender/...` resource paths 保持不变。

## CAD

`parse_cad.py` 从 `cad/design/01_floor_plan/floor_plan_design_*.dxf` 提取布局。默认输出仓库根目录的 `model-geometry-from-cad.yaml`，不会覆盖权威的 `config/layout/model-geometry.yaml`；只有显式传入 `--output ... --force` 才允许覆盖。

```bash
python -m pip install -r scripts/requirements.txt
python scripts/cad/parse_cad.py
python scripts/cad/parse_cad.py --output config/layout/model-geometry.yaml --force
```

输出日志仍为 `scripts/logs/cad-extraction-report.json`。CAD 测试位于 `tests/scripts/cad/parse_cad_test.py`，可由 pytest 发现。

## Blender 边界

`run-blender.sh` 和 `test-run-blender.sh` 留在 `scripts/` 顶层，因为远程调用、文档和测试依赖这些稳定入口。`scripts/blender/` 是现有 Blender runtime，不随本次脚本分层移动；不要把渲染 bundle 中的资源路径改成新的目录。

## 归档与未迁移脚本

`archive/` 下已有归档保留原位，不删除。历史/临时脚本只有在全量引用确认且归档目标明确时才移动；本次对高风险脚本不强行迁移，以下仍保留在顶层供既有流程或历史参考使用：

- `capture_floorplan.py`、`capture-floorplan.ps1`、`capture-edge.ps1`、`capture-edge-png.ps1`
- `launch_and_capture.py`
- `sim-roomlayout.ts`、`sim-living-walk.ts`、`dump-living-walls.ts`
- `test-opencode-prompt.mjs`、`test-opencode-sdk.mjs`
- `generate-dressing-map.ts`、`project-render-facts-projection.ts`

这些脚本不是本次正式分层入口。后续迁移必须先同步所有 package、测试、文档、skill 和远程调用引用；不能以删除旧路径代替迁移。

## 开发规范

1. 每个正式脚本应支持独立运行和 `--help`（适用时）。
2. 输出写入脚本约定目录，不直接覆盖源文件。
3. 迁移只调整路径和必要 import，不顺便重构逻辑。
4. 脚本变更需记录到项目审计记录（当前工作树若缺少审计文件，须在交付报告中说明）。
5. 修改几何、电气、家具、碰撞或 Blender runtime 时，另行遵守根目录 `AGENTS.md` 的验证规则。
