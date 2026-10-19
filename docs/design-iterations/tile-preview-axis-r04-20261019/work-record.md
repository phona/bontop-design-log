# Work Record — tile preview axis R04, 2026-10-19

## Frozen scope

- Owner decision: 0°表示南北向，90°表示东西向，默认0°。
- 仅调整临时预演的UI角度语义与贴图转换；正式floor selection、room overrides和窗帘open状态不变。
- DEC-2026-10-19-R04只覆盖R03中的地砖预演角度结论，不覆盖R03窗帘决定。

## Changes

- `app/src/App.ts`: 正常初始状态和无scheme兜底从90°改为0°；将slider方向值转换为`textureRotationDeg = 90 - directionDeg`。
- `app/src/ui/MaterialPreviewPanel.ts`: 说明0°为世界Z/南北向，90°为世界X/东西向。
- 新增R04决策与本轮事实、datum、object manifest、运行时及截图证据。
- 未修改正式材料、current-scheme、render facts、几何、正式铺贴方向或窗帘状态；未删除R03或既有历史内容。

## Decision audit

- **推翻了什么**：只推翻R03的“预演默认90°、0°东西向/90°南北向”部分；R03全屋窗帘默认open与正式方案不变继续有效。
- **删除了什么**：未删除正式对象、历史证据或既有决定。
- **静默失效条件**：若只改UI文字而漏掉App角度转换，控件语义会与贴图方向相反；若只改转换而漏掉初值或兜底，首屏状态会不一致；如果预演未激活，正式场景仍使用正式纹理方向，符合临时预演语义。
- **责任/触发**：业主已确认；本轮无现场待办。后续对正式铺贴方向的改变另行立项并记录。

## Verification

- 改前 `npm run gate:visual`: CLEAR（ceiling `7509d6377e73`、electrical `c541506a0427`、plumbing `81c5778c1239`、materials `64176f576326`）。
- `npm run typecheck`: passed。
- 改后 `npm run gate:visual`: CLEAR（ceiling `7509d6377e73`、electrical `c541506a0427`、plumbing `81c5778c1239`、materials `64176f576326`）。
- Browser: ready=true、错误横幅为空；slider 0→纹理π/2（南北向），slider90→纹理0（东西向）；恢复正式材料后slider回0、previewActive=false、正式texture rotation=0，floor selection未变。
- Independent review: aesthetic PASS; functional PASS；均确认只覆盖R03中的角度约定，且没有删除历史对象或证据。
- Tests: not run.

## Evidence

- `evidence/default-page.snapshot.txt`
- `evidence/restored-page.snapshot.txt`
- `evidence/runtime-verification.json`
- `evidence/north-south-preview-0.png`
- `evidence/east-west-preview-90.png`
