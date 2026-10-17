# 客厅南臂地插右位：强电箱侧落地候选

## 本轮输入

- 用户先指出 `mep:route:strong-power-living-sofa-r` 看起来是飞线，并确认吊顶自由垂降不合适，优先尝试强电箱侧走地。
- 项目当前尚未交房，任何新路线仍为候选，不作为施工放线依据。
- 本轮受限对象：只改右侧沙发地插支路、路线渲染的端点高度解析、MEP 依托检查；不改插座位置、回路、沙发、墙体或吊顶。

## 改前证据

- `gate:visual` 基线为 CLEAR。
- 浏览器 URL `http://127.0.0.1:5173/`；title `和萃 701 - 3D 装修设计`；`window.__APP__.isReady()=true`；配置错误横幅为空。
- 目标 `mep:route:strong-power-living-sofa-r` 的运行时路径为 `(11.00,9.65,2.70) → (11.00,9.65,0.02) → (11.00,9.35,2.55)`。最后一段 y=2.55 是 renderer 字符串端点缺省回落到 strong_power layer height 的结果；共享路由解析器/linter 使用了 endpoint y=0.02。
- 同机位改前截图和 snapshot 位于 `evidence/before.png` / `evidence/before-snapshot.txt`；有效 runtime points、segments、ready 和 camera 查询汇总在 `evidence/before-route-runtime.json`。
- `evidence/before-runtime.json` 是更早的一次页面重载中 `ready=false` 且目标组未解析的诊断查询，未作为验证证据引用；未覆盖或伪造成有效状态。

## 修改摘要

- sofa-r 新路径：强电箱点 `(13.40,3.60,y=1.65)` → 模型墙面客厅侧 `(13.34,3.60,y=1.65)` → 沿墙面保护管落地 `(13.34,3.60,y=0.02)` → 垫层南行 `(13.34,9.35,y=0.02)` → 地插 `(11.00,9.35,y=0.02)`；折线约 9.78m。`x=13.34` 按模型默认墙厚 0.12m 对应 `w_foyer_east` 客厅侧面；实际墙厚与箱体出线面待量房核实。
- `strong-power-living` 主干仍走既有吊顶/墙链；只将它的 sofa-r 旧分支描述改为由独立垫层路线接入。sofa-l、餐厅地插和 `ordinary_power_living` 回路成员不变。
- renderer 现在对字符串 endpoint 使用 resolved endpoint y，与 `mepRoutePoints`、linter 和 takeoff 的高度口径一致。sofa-r 仍显式声明 `to_height: 0.02`。
- `unsupported_span` 现在按 3D 路径长度采样水平、斜向和垂直段；贴实体墙、吊顶空腔、垫层仍可提供依托；幕墙仍不计为支撑。
- “为什么原 lint 没报飞线”：旧支持规则以平面长度采样并直接跳过平面位移 ≤0.05m 的段，纯竖直自由下引被豁免；陡斜短平面段也因按平面长度计 unsupported span 而漏报。`floor_branch_candidate` 以前只有文本意义，没有规则语义；同一轮还发现 renderer 对字符串端点回退到层默认高度，产生与 endpoint/takeoff 高度不同的可见终点。
- 净空规则现在只对实际进入 `y≤0.35m` 垫层带的 floor_branch(_candidate) 路线豁免；没有垫层点的高位误标由 `floor_branch_missing_floor_band` 报警。facts lint 与 MEP lint 共用真实吊顶 footprint / segment 相交实现；当前 `verify:mep` 与 `verify:facts` 均为 51 处、42 条路线、14 个分区，原 MEP-only 段交叉项定位为 `strong-power-master × curtain_box_master_south`。
- 原改后 runtime 曾因完成面比较错误而显示 sofa-r 两条 ceiling clearance 提醒；现已保存于 `evidence/after-runtime-pre-clearance-fix.json` 作为历史诊断，不能当作当前结果。当前 `after-runtime.json` 显示 `lintCodes=[]`，没有 `unsupported_span`，四段坐标和 y 值与最终候选一致。

## 被替换和保留内容

- 删除的在役路线定义：`from=(11.00,9.65,y=2.70)`、`via=(11.00,9.65,y=0.02)`、`to=sock_living_sofa_r`。M04/F01 历史文字和改前 runtime 证据均保留。
- 早期预演轴线 `x=13.20` 替换为 `x=13.34`：视觉复核发现 20cm 墙轴偏移仍会让竖降在近景中像开放空间线；按 `SceneBuilder` 0.12m 默认墙厚把垂直段贴到模型客厅侧墙面。单路3D长度仍为 9.78m、平面折线长度仍为 8.15m；同回路 `conduitM` union 因平面路径投影移动而由前次 32.50m 重新派生为当前 31.85m，现场墙厚和箱体出线面仍是反转条件。
- M04/F01 关于 sofa-r 从窗帘盒吊顶缘垂降的结论由 DEC-2026-10-17-R4 明确取代；F01 对普通电源主干沿东侧改道的批准继续有效。
- 没有删除地插点位、回路成员、主干坐标、采购数据或旧证据。

## 现场待核

- 箱体实际位置和底部客厅侧出线；`w_foyer_east` 不开槽，若无既有通路，须调整表面保护管方案。
- 客厅垫层厚度、其他暗埋水电、`d_bese` 门槛净距和地面完成标高。
- 上述条件未复尺前，路线维持 `inferred / proposed / construction_status: pending`。

## 验证

- `npm run gate:visual`：CLEAR；`npm run verify:all`：17/17 passed、0 failed；`npm run typecheck`：通过。
- 定向测试：`mep-hvac-lint.test.ts` + `facts-lint.test.ts` 75/75，`mep-guidance-baseline.test.ts` 6/6，`MepCoordinationRenderer.test.ts` 6/6 passed。MEP lint 当前 0 error / 133 warnings，其中 `unsupported_span` 13；survey bucket 80。其他历史全仓测试失败见最终 review manifest，属于其他既有工作流/运行时问题。
- `shared/mep-takeoff.ts` 同回路 union 复算：`ordinary_power_living` 的 `conduitM` 24.65m → 31.85m（+7.20m），2.5mm² 三芯 `wireM` 77.65m → 100.33m（+22.68m）；3D 单路长度 2.98m → 9.78m（+6.80m）。takeoff 是基于平面路径的同回路 union；两种量的口径不同，不能相互替代。复算值与前次 x=13.20 预演不同，最终证据见 `evidence/takeoff-ordinary-power-living.json`。
- 当前 close / wide / target-isolated browser runtime 与截图见 `evidence/after-runtime.json`、`after-east-side-runtime.json`、`after-target-focus-runtime.json`、`after.png`、`after-target-focus.png`、`after-east-side-full.png`、`after-plan-route.png`；运行时 ready=true、错误横幅空、目标 route lint 为空，施工状态仍 pending。
- `review-manifest.json` 汇总验证、取舍、待量房边界、当前 runtime 与独立审查；施工冻结仍被箱体出线/墙厚/垫层/门槛现场事实阻塞。
