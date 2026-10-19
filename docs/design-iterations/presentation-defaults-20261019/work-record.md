# Work Record — presentation defaults, 2026-10-19

## Frozen scope

- Owner instruction:全屋窗帘默认收起；地砖预演控件默认90°。
- Clarification:只改地砖预演默认值，不把90°写进正式选材/铺贴方案。
- Decision: `DEC-2026-10-19-R03`。

## Changes

- `data/presentation-state.json`: `default privacy → open`，`roomOverrides`仍为空；更新时间更新。
- `app/src/App.ts`: 地砖预演状态及无scheme兜底路径的初始角度 `0° → 90°`。
- 从权威窗帘状态重新生成 `data/project-render-facts.json`。九组窗帘状态为`open`，投影的`expectedVisibleNodes`为空。
- 在 `docs/decisions/14-style-furniture.md` 登记 DEC-2026-10-19-R03，并更新决策索引。核对发现 README 旧合计252与实际标题数262不符；同步校正05/06/11/12/13五行的旧数量/最新编号，以及14行新增一条后的数量。仅修正索引元数据，未改写或删除任何历史DEC正文。
- 无删除任何窗帘模型、地面区域、材料候选、研究证据或历史结论。

## Decision audit

- **推翻了什么**：此前展示默认值`privacy`被用户的新指令替换为`open`。未推翻正式地砖方向、SKU、分房材质或安装结论。
- **删除了什么**：没有删除配置对象或历史材料。生成投影按`open`语义清空九组窗帘的可见节点列表，这是预期结果。
- **静默失效条件**：没有重建`project-render-facts`时，旧server可能继续提供`privacy`；预演slider显示90°但未触发预演事件时，正式场景仍显示正式纹理。后者保持临时预演语义，不代表正式方向。
- **责任/触发**：业主已确认；无现场待办。仅在后续房间预演对比需要0°或其他角度时再调整临时控制值。

## Verification

- `npm run generate:project-render-facts`: passed。
- `npm run verify:project-render-facts`: passed; output `ProjectRenderFacts verified: electrical=17 lighting fixtures, plumbing=33, ceiling=25`。
- `npm run typecheck`: passed。
- `npm run gate:visual` before/after: CLEAR after restarting stale same-repository services; post digests ceiling `7509d6377e73`, electrical `c541506a0427`, plumbing `81c5778c1239`, materials `64176f576326`.
- Browser: `isReady=true`, config error banner empty; all nine runtime curtain states `open`; panel value `90°`; active preview textures `π/2`; restoring official materials returned texture rotation to `0`.
- Tests were not run.

## Evidence

- `evidence/final-page.snapshot.txt`
- `evidence/default-state-runtime.json`
- `evidence/preview-applied-runtime.json`
- `evidence/preview-default-90.png`
- `evidence/living-dining-south-closeup-preview-90.png`
