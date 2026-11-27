<!-- schedule-input-snapshot:{"config/acceptance.yaml":"212cc122e52879998b03907eab18b3d33d0a5970dbc75128bcbcd3c9d65d5faf","config/decision-gates.yaml":"e1066799953f6aeb74e5234d4bdc7f153cf473b95d5eedb91bcce7174ba16012","config/electrical-topology.yaml":"77a45c631cbe8bbc64fe174dc1a5ebbcf32047d1793debb82e1105f9d7f141a4","config/electrical.yaml":"a8fea1b990da1c024fd9d79cf75ce1ed5ed85aff0d99bb25f9cb287a6bd3d7ec","config/house.yaml":"76aa7f2b16f120695294c72507de7efac9f8f53f9835ef8f6ca2a6cace4786e8","config/hvac.yaml":"73a97ce5248913c761ba236554ab43e475ca4d7cf46e005a19c8b9fb7a7d6cdd","config/layout/model-geometry.yaml":"0045a905bcdf379d69bb51e4406df176cca3371ff895e3c66f105e2bf4a0c43d","config/mep-hvac-coordination.yaml":"a05665b661d8ba223c513afa79862e19b1fb794689d4bd232332f4d63f66332c","config/model-package-links.yaml":"b0bdb797b1962aad80e3f0af6bdccba8a21c51e0e9312c3b02ce2ce81760e891","config/model/envelope/ceiling.yaml":"ea7a6871a634648e35f13c85cfc371e70d96cfb3d5d4486a978ecb3791791ccb","config/model/envelope/finish-defaults.yaml":"cfb08b4fefefc71aa1525c5172cc28596b855bc6b95eb576302512314a942b4d","config/model/envelope/floor-zones.yaml":"75d5b0aa15d0cff4b2926aa4167a42a809c18dcc98dc9f29bf42fa07ffbaa786","config/model/envelope/openings.yaml":"de68a3b78a944cb2a0597949c2b105e57cbf10adf1439a6c5aada2bd127fd107","config/plumbing.yaml":"80a6fa1d981cf69d2fd23853e66f7571281c71c400195f2eb35b750f99415173","schedule/phase-1/control.yaml":"19f6ae1ad52d65bd5ac2d0b1430069a1df0a04acfcf1e657981eb6b1531d1fda","schedule/phase-2/control.yaml":"7ad86914b3f5c02cf4722a98eeeb1e80d454d02daa3361c1cefa36ab61c17b7f","schedule/phase-3/control.yaml":"fdda696d95d769bbaf6420617bb90e40053f20d1834263769c6f6ab72acc7d62","schedule/phase-scope.yaml":"ffd0fc546e888280aea2efc40ea1b0b7b645055cff291d08fbc4b4d765e97a6f","schedule/roadmap.yaml":"e0203255eae42123aa20e2faa8354636b889274cfd8d06e11858ac0674827409"} -->
# 项目进度与阶段 Checkpoint

> 自动生成：请勿直接编辑。维护源为各阶段 control.yaml、roadmap.yaml、phase-scope.yaml、model-package-links.yaml、验收标准和已关联项目配置。  
> 项目数据指纹：`sha256:4e82ff95dbd6ea7bf27d7ec96773ff03b974a49dfabfe8693b4a562d8b71d421`（19 个输入文件）  
> 当前未决断构件：40 个（每个都带 blocker，可读视图跑 npm run docs:generate-pending-view）。

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
- 责任角色：业主、拆改师傅、水电师傅、空调商。详情见 [PKG-000 现场检查点](phase-1/checklist.md#pkg-000)。

## 当前关联项目数据版本

| 数据源 | 当前 SHA-256 |
|---|---|
| [config/acceptance.yaml](../config/acceptance.yaml) | `212cc122e52879998b03907eab18b3d33d0a5970dbc75128bcbcd3c9d65d5faf` |
| [config/decision-gates.yaml](../config/decision-gates.yaml) | `e1066799953f6aeb74e5234d4bdc7f153cf473b95d5eedb91bcce7174ba16012` |
| [config/electrical-topology.yaml](../config/electrical-topology.yaml) | `77a45c631cbe8bbc64fe174dc1a5ebbcf32047d1793debb82e1105f9d7f141a4` |
| [config/electrical.yaml](../config/electrical.yaml) | `a8fea1b990da1c024fd9d79cf75ce1ed5ed85aff0d99bb25f9cb287a6bd3d7ec` |
| [config/house.yaml](../config/house.yaml) | `76aa7f2b16f120695294c72507de7efac9f8f53f9835ef8f6ca2a6cace4786e8` |
| [config/hvac.yaml](../config/hvac.yaml) | `73a97ce5248913c761ba236554ab43e475ca4d7cf46e005a19c8b9fb7a7d6cdd` |
| [config/layout/model-geometry.yaml](../config/layout/model-geometry.yaml) | `0045a905bcdf379d69bb51e4406df176cca3371ff895e3c66f105e2bf4a0c43d` |
| [config/mep-hvac-coordination.yaml](../config/mep-hvac-coordination.yaml) | `a05665b661d8ba223c513afa79862e19b1fb794689d4bd232332f4d63f66332c` |
| [config/model-package-links.yaml](../config/model-package-links.yaml) | `b0bdb797b1962aad80e3f0af6bdccba8a21c51e0e9312c3b02ce2ce81760e891` |
| [config/model/envelope/ceiling.yaml](../config/model/envelope/ceiling.yaml) | `ea7a6871a634648e35f13c85cfc371e70d96cfb3d5d4486a978ecb3791791ccb` |
| [config/model/envelope/finish-defaults.yaml](../config/model/envelope/finish-defaults.yaml) | `cfb08b4fefefc71aa1525c5172cc28596b855bc6b95eb576302512314a942b4d` |
| [config/model/envelope/floor-zones.yaml](../config/model/envelope/floor-zones.yaml) | `75d5b0aa15d0cff4b2926aa4167a42a809c18dcc98dc9f29bf42fa07ffbaa786` |
| [config/model/envelope/openings.yaml](../config/model/envelope/openings.yaml) | `de68a3b78a944cb2a0597949c2b105e57cbf10adf1439a6c5aada2bd127fd107` |
| [config/plumbing.yaml](../config/plumbing.yaml) | `80a6fa1d981cf69d2fd23853e66f7571281c71c400195f2eb35b750f99415173` |
| [schedule/phase-1/control.yaml](../schedule/phase-1/control.yaml) | `19f6ae1ad52d65bd5ac2d0b1430069a1df0a04acfcf1e657981eb6b1531d1fda` |
| [schedule/phase-2/control.yaml](../schedule/phase-2/control.yaml) | `7ad86914b3f5c02cf4722a98eeeb1e80d454d02daa3361c1cefa36ab61c17b7f` |
| [schedule/phase-3/control.yaml](../schedule/phase-3/control.yaml) | `fdda696d95d769bbaf6420617bb90e40053f20d1834263769c6f6ab72acc7d62` |
| [schedule/phase-scope.yaml](../schedule/phase-scope.yaml) | `ffd0fc546e888280aea2efc40ea1b0b7b645055cff291d08fbc4b4d765e97a6f` |
| [schedule/roadmap.yaml](../schedule/roadmap.yaml) | `e0203255eae42123aa20e2faa8354636b889274cfd8d06e11858ac0674827409` |

任何输入源变化都会使此清单的输入指纹变化；验证器会报告旧视图及变化文件。已通过的现场检查还会比较自身记录的项目数据指纹和验收标准指纹，变化后转为 stale 并阻止付款放行。
