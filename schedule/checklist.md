<!-- schedule-input-snapshot:{"config/acceptance.yaml":"2073ae223d39584f438e2be0fe231b0719b456b863e0c379c216681089b90e9f","config/ceiling.yaml":"69101633aba091cc59f3db2666b43572a57f3de9b407348ce6d602268604f719","config/electrical-topology.yaml":"901e950952da0eeee5234c860bdddc6a67ff984360f0d36645eac2676cf22c51","config/electrical.yaml":"bb2db6362e93590d2011942ed42da5f338aa6a5d4bf0958b2c7b6c1e06e8bbbf","config/house.yaml":"8339729d1ac0f00960930eefdb00d58dcf4c6cac417fea55ad8473f89fbadf44","config/hvac.yaml":"2f5486fa46d6a322a69da9c9a53f072011ecb5a65d8ea3b6e67af6f839102342","config/layout/model-geometry.yaml":"c06d12c5d5dfa46d446535f2ed046ecebe354ff2acde1492145f2a591ce385c9","config/layout/overlay.yaml":"c3e4b08f604d4e20dc62dcedd6150289fee839e6491362583a551ea2827d346e","config/mep-hvac-coordination.yaml":"46fc84a896d7d1b236c8cf05c99a8ab4c29375471e09cb0e5d53484a693510b6","config/model-package-links.yaml":"443df176174fe6aadc19343894f0de876827d318df2f279cefd565a98ec8b3a8","config/plumbing.yaml":"27711aa1198f7121ce494efe052fbe8d2efae94ca0900a9094324e65f382685c","docs/pending-site-data.md":"b27d616d34ba15aa2e2c018606551332e40b866ce106d9391ea6e56fa049c988","schedule/phase-1/control.yaml":"67c4a16725a9efe787fc2ea554017d4bc018939594f87c6b8b2b3379b837590a","schedule/phase-2/control.yaml":"2010dab825bedb8e00b7aafc43ba908378fba5422709d94d3812a122a3a5590f","schedule/phase-3/control.yaml":"e784a1e8e5295f1322d8d346abaded152b2308d85de9cd0f8a4355d4fcec943e","schedule/phase-scope.yaml":"4928a254129241b0762e6cda2831be995df30802b979bd2cf8da6eaba66f87a4","schedule/roadmap.yaml":"0a954474b7fd676d98db498973c560aa45fddb2c67fd7364b453e6d4dff9dc45"} -->
# 项目进度与阶段 Checkpoint

> 自动生成：请勿直接编辑。维护源为各阶段 control.yaml、roadmap.yaml、phase-scope.yaml、model-package-links.yaml、验收标准和已关联项目配置。  
> 项目数据指纹：`sha256:59d4550216a549bb605f0a9ba963e8d12031d54beba6f8469686b70c197dc146`（17 个输入文件）  
> 当前量房待确认台账：74 个编号，详情见 [量房待填清单](../docs/pending-site-data.md)。

## 怎么用这份清单

- 先看阶段表，按“当前状态”和“启动门槛”决定是否进入下一阶段。
- 一期按 [一期施工与验收清单](phase-1/checklist.md) 的当前工作包推进；每个包展示开始条件、检查方法、通过标准、证据和关联项目数据。
- 二期、三期目前仍是提案，只能核对启动门槛；选定范围后还要把每个项目拆成施工工作包，不能把候选清单当采购或施工指令。
- 更新了项目配置或现场台账后，运行 `npm run schedule:render`。`npm run verify:schedule` 只读检查生成文件是否过期，不会替你悄悄重写。

## 阶段路线与状态

| 阶段 | 当前状态 | 当前预算口径 | 启动 / 下一步条件 | 执行清单 |
|---|---|---:|---|---|
| 一期基本入住 | planning | ¥210,000 上限 | 交房查验完成后进入PKG-000；量房、图纸会审和同口径报价须在施工放线前完成，物业手续须在施工进场前完成 | [打开清单](phase-1/checklist.md) |
| 二期功能升级 | proposed | ¥42,100—¥67,200 | 一期竣工结算完成，业主重新确认范围和预算上限 | [打开清单](phase-2/checklist.md) |
| 三期入住后软装优化 | proposed | ¥5,000—¥10,000 | 入住观察期结束，业主确认实际缺口 | [打开清单](phase-3/checklist.md) |

## 当前应推进的工作包

- **PKG-000｜设计、量房与开工准备**：施工就绪保持 blocked；当前可推进预交房设计/资料准备。
- 要做：交房前可先做有据可查的初版设计预演和现场资料准备；交房后再量房、回填配置、冻结专业图纸、同范围报价并签约。预演检查通过不代表具备施工放线或采购条件。
- 等待：尚未交房，无法完成现场量房及房屋查验、墙体结构、梁底及允许打孔或穿墙条件未确认、中央空调管线、冷凝水、风口和检修口尚未完成厂家深化及三方会审、燃气厨房门的现场验收要求未确认、影响水电与中央空调施工的现场数据尚未全部实测、显式豁免或登记为阻塞；当前清单和数据状态见 docs/pending-site-data.md
- 下一检查点：SCH-000-PRE-01｜建立交房前初版设计基线（仅预演，不作施工图）（预交房可推进，不放施工）。
- 责任角色：业主、设计师、施工方、空调商。详情见 [PKG-000 现场检查点](phase-1/checklist.md#pkg-000)。

## 当前关联项目数据版本

| 数据源 | 当前 SHA-256 |
|---|---|
| [config/acceptance.yaml](../config/acceptance.yaml) | `2073ae223d39584f438e2be0fe231b0719b456b863e0c379c216681089b90e9f` |
| [config/ceiling.yaml](../config/ceiling.yaml) | `69101633aba091cc59f3db2666b43572a57f3de9b407348ce6d602268604f719` |
| [config/electrical-topology.yaml](../config/electrical-topology.yaml) | `901e950952da0eeee5234c860bdddc6a67ff984360f0d36645eac2676cf22c51` |
| [config/electrical.yaml](../config/electrical.yaml) | `bb2db6362e93590d2011942ed42da5f338aa6a5d4bf0958b2c7b6c1e06e8bbbf` |
| [config/house.yaml](../config/house.yaml) | `8339729d1ac0f00960930eefdb00d58dcf4c6cac417fea55ad8473f89fbadf44` |
| [config/hvac.yaml](../config/hvac.yaml) | `2f5486fa46d6a322a69da9c9a53f072011ecb5a65d8ea3b6e67af6f839102342` |
| [config/layout/model-geometry.yaml](../config/layout/model-geometry.yaml) | `c06d12c5d5dfa46d446535f2ed046ecebe354ff2acde1492145f2a591ce385c9` |
| [config/layout/overlay.yaml](../config/layout/overlay.yaml) | `c3e4b08f604d4e20dc62dcedd6150289fee839e6491362583a551ea2827d346e` |
| [config/mep-hvac-coordination.yaml](../config/mep-hvac-coordination.yaml) | `46fc84a896d7d1b236c8cf05c99a8ab4c29375471e09cb0e5d53484a693510b6` |
| [config/model-package-links.yaml](../config/model-package-links.yaml) | `443df176174fe6aadc19343894f0de876827d318df2f279cefd565a98ec8b3a8` |
| [config/plumbing.yaml](../config/plumbing.yaml) | `27711aa1198f7121ce494efe052fbe8d2efae94ca0900a9094324e65f382685c` |
| [docs/pending-site-data.md](../docs/pending-site-data.md) | `b27d616d34ba15aa2e2c018606551332e40b866ce106d9391ea6e56fa049c988` |
| [schedule/phase-1/control.yaml](../schedule/phase-1/control.yaml) | `67c4a16725a9efe787fc2ea554017d4bc018939594f87c6b8b2b3379b837590a` |
| [schedule/phase-2/control.yaml](../schedule/phase-2/control.yaml) | `2010dab825bedb8e00b7aafc43ba908378fba5422709d94d3812a122a3a5590f` |
| [schedule/phase-3/control.yaml](../schedule/phase-3/control.yaml) | `e784a1e8e5295f1322d8d346abaded152b2308d85de9cd0f8a4355d4fcec943e` |
| [schedule/phase-scope.yaml](../schedule/phase-scope.yaml) | `4928a254129241b0762e6cda2831be995df30802b979bd2cf8da6eaba66f87a4` |
| [schedule/roadmap.yaml](../schedule/roadmap.yaml) | `0a954474b7fd676d98db498973c560aa45fddb2c67fd7364b453e6d4dff9dc45` |

任何输入源变化都会使此清单的输入指纹变化；验证器会报告旧视图及变化文件。已通过的现场检查还会比较自身记录的项目数据指纹和验收标准指纹，变化后转为 stale 并阻止付款放行。
