# Evidence Notes — 客餐厅回风口成组候选（DEC-2026-10-18-R01）

**来源版本**：`runtime-query.json` 记录的 `config/hvac.yaml`、`config/ceiling.yaml`、`config/mep-hvac-coordination.yaml` 与 `data/project-render-facts.json` SHA-256。

**门禁**：2026-10-18 16:06（Asia/Shanghai），以 `VISUAL_GATE_API=http://127.0.0.1:4111 node --import tsx scripts/gate/visual-state-gate.ts` 检查，结果 CLEAR；ceiling/electrical/plumbing/materials projection 均与当前 config 一致。

**浏览器**：URL `http://127.0.0.1:5175/`；标题“和萃 701 - 3D 装修设计”；每个视角均确认 `window.__APP__.isReady() === true`、配置错误横幅为空。所有目标机位为轨道近景/室内视角，`is_overview=false`。详细相机位、对象 ID 与实时坐标见 `runtime-query.json`。

| 视角 | 证据 | 用途 |
|---|---|---|
| 客厅侧主视 | `view1-living-band-main.png` / `.snapshot.txt` | 检查整条设备带与客厅视线 |
| 客厅看餐厅 | `view2-from-living-to-dining.png` / `.snapshot.txt` | 检查餐区设备带及餐桌关系 |
| 餐厅看客厅 | `view3-from-dining-to-living.png` / `.snapshot.txt` | 检查两台机组之间的节奏 |
| 设备带干净近景 | `view4-band-clean.png` / `.snapshot.txt` | 检查下出风与回风两排、端部收口 |
| 设备带底面仰视 | `view4b-band-underside.png` / `.snapshot.txt` | 检查底面两排槽口与装饰延续 |
| HVAC 协调层近景 | `view4-band-closeup.png` / `.snapshot.txt` | 验证 HVAC 对象可见关系；含协调标记，不作为纯审美主图 |

六张 PNG 均为可读 1280×577 非空图片。旧 R03 截图仅作为改前对照，不作为本版证据。

**功能边界**：截图只能证明运行时坐标和当前预演视觉；不能证明 P-SS 的风量、外静压、短路、检修开口或施工接口。具体厂家安装图仍待提供。候选 MEP 校核结果见 `../round.yaml（review 段）`。


**当前页复核（2026-10-18 23:10 Asia/Shanghai）**：修正前端代理到 API 的地址后，重新加载实际 Three.js 场景，`isReady=true`、无配置错误；`return_dining`/`return_living` 在场景树中分别为 x=9.10/11.40。复核记录见 `current-session-runtime.json`。业主发来的截图当前选中的是未移动的 `supply_living_bottom`（x=10.30）；连续黑色装饰百叶也会弱化功能段边界，因此该截图本身不能证明回风新位置是否显眼。
