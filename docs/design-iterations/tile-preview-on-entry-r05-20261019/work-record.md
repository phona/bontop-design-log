# Work Record — tile preview on entry R05, 2026-10-19

## Frozen scope

- Owner feedback: “怎么进来还是东西向”。
- Apply the R04 default 0° north-south floor preview on first entry, so slider and scene agree.
- Keep formal floor selection, paint, curtains and geometry unchanged; default initialization applies only floor textures.

## Changes

- `setupMaterialPreviewPanel()` applies the initial floor preview after the official scheme and panel state are ready.
- `applyMaterialPreviewState()` now tracks whether paint preview is active; startup applies only floor and `floor_region` material overrides, without calling `setPaintColor()`.
- Archive restore exits preview first to prevent an old preview `floorId` from masking the restored selection.
- No floor/paint materials, scheme data, curtains or geometry were changed.

## Decision audit

- **推翻了什么**：推翻R04中“slider默认0但正式场景仍保持东西向直到手动触发预演”的隐含行为；R04方向映射、R03窗帘open和正式scheme不变继续有效。
- **删除了什么**：没有删除历史对象、材料、决定或证据。
- **静默失效条件**：若首屏只初始化slider而不apply floor preview，场景会再次出现读数0/画面东西向不一致；若首屏调用整套预演并设置墙漆颜色，未来paint roomOverrides可能被压平；若恢复归档前未先退出预演，旧preview floorId可能遮住归档材料。
- **责任/触发**：业主指出进入时画面仍东西向；无现场或采购待办。

## Verification

- `npm run typecheck`: passed。
- `npm run gate:visual`: CLEAR; ceiling `7509d6377e73`, electrical `c541506a0427`, plumbing `81c5778c1239`, materials `64176f576326`.
- Browser: 首屏ready=true、slider0、previewActive=true、paintPreviewActive=false、16个floor/floor_region贴图rotation π/2；恢复正式材料后rotation=0、slider0、正式floor/paint selection与窗帘default=open不变。
- Independent aesthetic review: PASS; functional review: PASS.
- Tests: not run.

## Evidence

- `evidence/startup-page.snapshot.txt`
- `evidence/restored-page.snapshot.txt`
- `evidence/runtime-verification.json`
- `evidence/startup-north-south.png`
