<!-- schedule-input-snapshot:{"config/acceptance.yaml":"e789e04312cb9ae62d1a02eab72eb44f709075db58f09510ece4b85e57142187","config/decision-gates.yaml":"e1066799953f6aeb74e5234d4bdc7f153cf473b95d5eedb91bcce7174ba16012","config/electrical-topology.yaml":"8ea96920b06648679292bb1a08c87d29c1dbc37a658c05d95eeb992caaeebeb9","config/electrical.yaml":"a8c35cd904c7b8c36aabfa97824b86188b483f7d64d072ccbc305fb4b4f07276","config/house.yaml":"bdc3e950d5db1b3b7dfecf58293bdd923aad6ad2e1fbaa6d48f60b43ea106f80","config/hvac.yaml":"24c5559aca20e1784973e608eb5f13c3da4cbbe7dd1c1c749f3a68117292f6b7","config/layout/model-geometry.yaml":"473d81dbe5c8704db86db472a40624b4fa1a9f5abbb614385fdb4262026246ff","config/mep-hvac-coordination.yaml":"513db9b09a5b566a44cbbd30ca459c4b113dcd0a4c940c5b96d04ee16a95cf40","config/model-package-links.yaml":"963c62033e7f6717f73ee1d85b4c35fa63a65f9b3d4bfde839248fa9f81080b1","config/model/envelope/ceiling.yaml":"631a9036bde64067b9a3520a723e7ddec1a359aee1381fa260e78fe1185b9005","config/model/envelope/finish-defaults.yaml":"cfb08b4fefefc71aa1525c5172cc28596b855bc6b95eb576302512314a942b4d","config/model/envelope/floor-zones.yaml":"a2b1251d0dd6d65a093496188fa5be5c5ee514947a9756daecabbc60c9cd01f3","config/model/envelope/openings.yaml":"19fe765e675b357769e1e7d6f9a2659097e85a9d3b34dd4c0595e51882678450","config/plumbing.yaml":"0e3a1c74d47a5c298830eb6abbcdcba9c2068a6538f1979293b6d50db602cc91","schedule/phase-1/control.yaml":"f73ad83dbc7d5ef0e566d5e83a9be7812530ec338582b6091ea682d75cbf625f","schedule/phase-2/control.yaml":"f5d8c0347a1d3208e39d5d12b38d1459655c51513ef5d5b6e3a52fb3a2dc7f81","schedule/phase-3/control.yaml":"e784a1e8e5295f1322d8d346abaded152b2308d85de9cd0f8a4355d4fcec943e","schedule/phase-scope.yaml":"17d0874a87fc441c2ad66eb1abfc55d341abfc4e9e32229889998e9e227cc8b6","schedule/roadmap.yaml":"e0203255eae42123aa20e2faa8354636b889274cfd8d06e11858ac0674827409"} -->
# 项目进度与阶段 Checkpoint

> 自动生成：请勿直接编辑。维护源为各阶段 control.yaml、roadmap.yaml、phase-scope.yaml、model-package-links.yaml、验收标准和已关联项目配置。  
> 项目数据指纹：`sha256:0c4ed6513c7951ba100cec1b642fc6111087d5bc5075bb35c03de6a51a1b5ef6`（19 个输入文件）  
> 当前未决断构件：39 个（每个都带 blocker，可读视图跑 npm run docs:generate-pending-view）。

## 怎么用这份清单

- 先看阶段表，按“当前状态”和“启动门槛”决定是否进入下一阶段。
- 一期按 [一期施工与验收清单](phase-1/checklist.md) 的当前工作包推进；每个包展示开始条件、检查方法、通过标准、证据和关联项目数据。
- 二期、三期目前仍是提案，只能核对启动门槛；选定范围后还要把每个项目拆成施工工作包，不能把候选清单当采购或施工指令。
- 更新了项目配置或现场台账后，运行 `npm run schedule:render`。`npm run verify:schedule` 只读检查生成文件是否过期，不会替你悄悄重写。

## 阶段路线与状态

| 阶段 | 当前状态 | 当前预算口径 | 启动 / 下一步条件 | 执行清单 |
|---|---|---:|---|---|
| 一期基本入住 | planning | ¥210,099 上限 | 交房查验完成后进入PKG-000；量房、图纸会审和同口径报价须在施工放线前完成，物业手续须在施工进场前完成 | [打开清单](phase-1/checklist.md) |
| 二期功能升级 | proposed | ¥43,400—¥67,400 | 一期竣工结算完成，业主重新确认范围和预算上限 | [打开清单](phase-2/checklist.md) |
| 三期入住后软装优化 | proposed | ¥5,000—¥10,000 | 入住观察期结束，业主确认实际缺口 | [打开清单](phase-3/checklist.md) |

## 当前应推进的工作包

- **PKG-000｜设计、量房与开工准备**：施工就绪保持 blocked；当前可推进预交房设计/资料准备。
- 要做：交房前可先做有据可查的初版设计预演和现场资料准备；交房后再量房、回填配置、冻结专业图纸、同范围报价并签约。预演检查通过不代表具备施工放线或采购条件。
- 等待：尚未交房，无法完成现场量房及房屋查验、墙体结构、梁底及允许打孔或穿墙条件未确认、中央空调管线、冷凝水、风口和检修口尚未完成厂家深化及三方会审、燃气厨房门的现场验收要求未确认、影响水电与中央空调施工的现场数据尚未全部实测、显式豁免或登记为阻塞；当前清单和数据状态见 原量房台账（已退场）
- 下一检查点：SCH-000-PRE-01｜建立交房前初版设计基线（仅预演，不作施工图）（预交房可推进，不放施工）。
- 责任角色：业主、设计师、施工方、空调商。详情见 [PKG-000 现场检查点](phase-1/checklist.md#pkg-000)。

## 当前关联项目数据版本

| 数据源 | 当前 SHA-256 |
|---|---|
| [config/acceptance.yaml](../config/acceptance.yaml) | `e789e04312cb9ae62d1a02eab72eb44f709075db58f09510ece4b85e57142187` |
| [config/decision-gates.yaml](../config/decision-gates.yaml) | `e1066799953f6aeb74e5234d4bdc7f153cf473b95d5eedb91bcce7174ba16012` |
| [config/electrical-topology.yaml](../config/electrical-topology.yaml) | `8ea96920b06648679292bb1a08c87d29c1dbc37a658c05d95eeb992caaeebeb9` |
| [config/electrical.yaml](../config/electrical.yaml) | `a8c35cd904c7b8c36aabfa97824b86188b483f7d64d072ccbc305fb4b4f07276` |
| [config/house.yaml](../config/house.yaml) | `bdc3e950d5db1b3b7dfecf58293bdd923aad6ad2e1fbaa6d48f60b43ea106f80` |
| [config/hvac.yaml](../config/hvac.yaml) | `24c5559aca20e1784973e608eb5f13c3da4cbbe7dd1c1c749f3a68117292f6b7` |
| [config/layout/model-geometry.yaml](../config/layout/model-geometry.yaml) | `473d81dbe5c8704db86db472a40624b4fa1a9f5abbb614385fdb4262026246ff` |
| [config/mep-hvac-coordination.yaml](../config/mep-hvac-coordination.yaml) | `513db9b09a5b566a44cbbd30ca459c4b113dcd0a4c940c5b96d04ee16a95cf40` |
| [config/model-package-links.yaml](../config/model-package-links.yaml) | `963c62033e7f6717f73ee1d85b4c35fa63a65f9b3d4bfde839248fa9f81080b1` |
| [config/model/envelope/ceiling.yaml](../config/model/envelope/ceiling.yaml) | `631a9036bde64067b9a3520a723e7ddec1a359aee1381fa260e78fe1185b9005` |
| [config/model/envelope/finish-defaults.yaml](../config/model/envelope/finish-defaults.yaml) | `cfb08b4fefefc71aa1525c5172cc28596b855bc6b95eb576302512314a942b4d` |
| [config/model/envelope/floor-zones.yaml](../config/model/envelope/floor-zones.yaml) | `a2b1251d0dd6d65a093496188fa5be5c5ee514947a9756daecabbc60c9cd01f3` |
| [config/model/envelope/openings.yaml](../config/model/envelope/openings.yaml) | `19fe765e675b357769e1e7d6f9a2659097e85a9d3b34dd4c0595e51882678450` |
| [config/plumbing.yaml](../config/plumbing.yaml) | `0e3a1c74d47a5c298830eb6abbcdcba9c2068a6538f1979293b6d50db602cc91` |
| [schedule/phase-1/control.yaml](../schedule/phase-1/control.yaml) | `f73ad83dbc7d5ef0e566d5e83a9be7812530ec338582b6091ea682d75cbf625f` |
| [schedule/phase-2/control.yaml](../schedule/phase-2/control.yaml) | `f5d8c0347a1d3208e39d5d12b38d1459655c51513ef5d5b6e3a52fb3a2dc7f81` |
| [schedule/phase-3/control.yaml](../schedule/phase-3/control.yaml) | `e784a1e8e5295f1322d8d346abaded152b2308d85de9cd0f8a4355d4fcec943e` |
| [schedule/phase-scope.yaml](../schedule/phase-scope.yaml) | `17d0874a87fc441c2ad66eb1abfc55d341abfc4e9e32229889998e9e227cc8b6` |
| [schedule/roadmap.yaml](../schedule/roadmap.yaml) | `e0203255eae42123aa20e2faa8354636b889274cfd8d06e11858ac0674827409` |

任何输入源变化都会使此清单的输入指纹变化；验证器会报告旧视图及变化文件。已通过的现场检查还会比较自身记录的项目数据指纹和验收标准指纹，变化后转为 stale 并阻止付款放行。
