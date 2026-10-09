# scripts / 工具脚本

本目录按职责分层保存项目自动化脚本。当前默认效果预览路线为 **Web + GPT**；Web/CLI GLB 构建、导出、检查和比较仍是 active 主线。Blender 管线已暂停并冷归档，不再提供顶层 wrapper、bundle 或默认 npm 入口。

## Active 目录结构

```text
scripts/
├── cad/                         # CAD 参考提取
├── project/                     # Web/API/共享 project facts 投影
├── verify/
│   ├── layout/                  # topology/layout
│   ├── placement/               # furniture/point placement
│   ├── data/                    # cross-file consistency
│   ├── rules/                   # declarative rule checks
│   ├── collision/               # collision coverage checks
│   ├── mep/                     # MEP lint
│   ├── electrical/              # electrical lint
│   └── project/                 # 共享 facts/lighting 校验
├── render/
│   ├── glb/                     # CLI GLB build/export/inspect/compare
│   ├── capture/                 # browser floor-plan capture and watcher
│   └── diagrams/                # top-down and MEP/HVAC diagrams
└── archive/blender-pipeline/    # PAUSED/HISTORICAL Blender 冷归档
```

## 正式入口

| 用途 | 入口 |
|---|---|
| CAD 提取 | `python scripts/cad/parse_cad.py` |
| 全量门禁（15 个 verifier 全跑 + 汇总退出码） | `npm run verify:all`；`--json` 出结构化信封，`--only <name>` 单跑，`--fail-fast` 复现旧短路行为 |
| 家具、点位、规则、碰撞校验 | `npm run verify:furniture`、`verify:consistency`、`verify:rules`、`verify:collision` |
| 共享 project facts/灯光校验 | `npm run verify:project-render-facts`、`npm run verify:lighting-config` |
| 空间声明/拓扑/安装校验 | `npm run verify:spatial` |
| 防穿模（实体互撞/净距） | `npm run verify:penetration` |
| GLB 导出/比较 | `npm run export:glb`、`npm run compare:glb` |
| Floor-plan capture | `python scripts/render/capture/capture_floor_plan_screenshot.py` |
| Floor-plan watcher | `python scripts/render/capture/watch_floor_plan_and_compare.py` |
| 俯视图/MEP 图 | `python scripts/render/diagrams/draw-topdown.py`、`draw-mep-hvac-plan.py` |

`npm run verify:all` 由 `scripts/verify/verify-all.ts` 编排：依次跑完全部 15 个 verifier 再汇总退出码（0 ⇔ 全过，历史「N 步全过」证据仍有效），不再因单点红灯中止。支持 `--json` 的 verifier 会在信封里带上 `report`，不支持的标 `structured:false` 并附原始文本——不假装全部已结构化。

`verify:spatial` 与 `verify:penetration` 共用 `shared/penetration/scene.ts` 的场景采集与规则实现：前者管声明完整性、墙线拓扑、运行时权威性与安装语义，后者只管实体互撞与净距（规则登记表 `config/anti-penetration.yaml`）。两者都纳入 `verify:all`。

`project-render-facts` 与 lighting 配置同时服务 Web/API/共享场景，因此仍属 active 主线：生成快照为 `data/project-render-facts.json`，实现位于 `scripts/project/` 与 `scripts/verify/project/`，并继续包含在 `verify:all`。

## Blender 冷归档

Blender runtime、wrapper、bundle、相机工具、`verify-render-bundle` 和相关测试位于 `scripts/archive/blender-pipeline/`。归档是 dirty/untracked 最终源码快照，不承诺从归档路径直接渲染，也没有 `archive:blender:*` npm alias。恢复前必须阅读其 `README.md` 和 `MANIFEST.json`，在独立副本中重建历史路径并验证，禁止覆盖当前 dirty 工作区。

大型 `assets/`、`hdri/`、`renders/`、`tmp/` 保持原位；缓存、`node_modules` 与 generated binaries 不进入归档。

## CAD

`parse_cad.py` 从 `cad/design/01_floor_plan/floor_plan_design_*.dxf` 提取布局。默认输出仓库根目录的 `model-geometry-from-cad.yaml`，不会覆盖权威的 `config/layout/model-geometry.yaml`；只有显式传入 `--output ... --force` 才允许覆盖。

```bash
python -m pip install -r scripts/requirements.txt
python scripts/cad/parse_cad.py
python scripts/cad/parse_cad.py --output config/layout/model-geometry.yaml --force
```

输出日志仍为 `scripts/logs/cad-extraction-report.json`。CAD 测试位于 `tests/scripts/cad/parse_cad_test.py`。

## 开发规范

1. 每个 active 正式脚本应支持独立运行和 `--help`（适用时）。
2. 输出写入脚本约定目录，不直接覆盖源文件。
3. 迁移只调整路径和必要 import，不顺便重构逻辑。
4. 修改几何、电气、家具或碰撞时，遵守根目录 `AGENTS.md` 的验证规则。
5. Blender 规则只在明确恢复冷归档时适用。
