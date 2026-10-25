<!-- schedule-input-snapshot:{"config/acceptance.yaml":"2073ae223d39584f438e2be0fe231b0719b456b863e0c379c216681089b90e9f","config/ceiling.yaml":"9235822b1161c4cf6ab10d966b9267bb96ef3830252b4eb81d56cd88a6be27eb","config/electrical-topology.yaml":"112be80a82973e59b3dac07790042bc3d9b46086cc38268f298947be0feb5c00","config/electrical.yaml":"840e232b233805e82784217cea239290747510e0767ef609e4f4adbfd369dc4a","config/house.yaml":"82ce4110f76a2444e75c69c32fb12a0cc9af140b876b6e2c9bf4a410f0afc123","config/hvac.yaml":"4afa3203b131385f9849cd69f279a1f4a48789df6ef7847eb872fb4e2b5e9583","config/layout/model-geometry.yaml":"3e18c2cde2f433a9d8f428bda1659aac413fc46cdf739271c4793f068f8cc5d7","config/layout/overlay.yaml":"d9271c4ea1824d8bf57be73c089fab5c321c007a93cff7f781a604e90c904f44","config/mep-hvac-coordination.yaml":"18d0576261cc15d209a3895179e7350bf573f388a8742dbb37846f56abc64722","config/model-package-links.yaml":"6f351ff5231cc650de48e5ef89c8f2fa13650b81312badd9ed6c525373e04f7e","config/plumbing.yaml":"28b6213e8f1c15d433ff5a7c3064efa7248b839a8aca97e060370b4aad51cc32","docs/pending-site-data.md":"5d0dec413e4e8a62570f83a44a1949057740c8f14d32c65719ff2bc77594a8bc","schedule/phase-1/control.yaml":"3e22e4c85f7e21eb6549b8f7df382e6d8991b6e68cc22569d95bb6beba4e7d6c","schedule/phase-2/control.yaml":"2010dab825bedb8e00b7aafc43ba908378fba5422709d94d3812a122a3a5590f","schedule/phase-3/control.yaml":"e784a1e8e5295f1322d8d346abaded152b2308d85de9cd0f8a4355d4fcec943e","schedule/phase-scope.yaml":"4928a254129241b0762e6cda2831be995df30802b979bd2cf8da6eaba66f87a4","schedule/roadmap.yaml":"0a954474b7fd676d98db498973c560aa45fddb2c67fd7364b453e6d4dff9dc45"} -->
# 项目进度与阶段 Checkpoint

> 自动生成：请勿直接编辑。维护源为各阶段 control.yaml、roadmap.yaml、phase-scope.yaml、model-package-links.yaml、验收标准和已关联项目配置。  
> 项目数据指纹：`sha256:1b49bd822efdeede8ffdae9fb502dab25278eac61ec485952107a062adea3f50`（17 个输入文件）  
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
| [config/ceiling.yaml](../config/ceiling.yaml) | `9235822b1161c4cf6ab10d966b9267bb96ef3830252b4eb81d56cd88a6be27eb` |
| [config/electrical-topology.yaml](../config/electrical-topology.yaml) | `112be80a82973e59b3dac07790042bc3d9b46086cc38268f298947be0feb5c00` |
| [config/electrical.yaml](../config/electrical.yaml) | `840e232b233805e82784217cea239290747510e0767ef609e4f4adbfd369dc4a` |
| [config/house.yaml](../config/house.yaml) | `82ce4110f76a2444e75c69c32fb12a0cc9af140b876b6e2c9bf4a410f0afc123` |
| [config/hvac.yaml](../config/hvac.yaml) | `4afa3203b131385f9849cd69f279a1f4a48789df6ef7847eb872fb4e2b5e9583` |
| [config/layout/model-geometry.yaml](../config/layout/model-geometry.yaml) | `3e18c2cde2f433a9d8f428bda1659aac413fc46cdf739271c4793f068f8cc5d7` |
| [config/layout/overlay.yaml](../config/layout/overlay.yaml) | `d9271c4ea1824d8bf57be73c089fab5c321c007a93cff7f781a604e90c904f44` |
| [config/mep-hvac-coordination.yaml](../config/mep-hvac-coordination.yaml) | `18d0576261cc15d209a3895179e7350bf573f388a8742dbb37846f56abc64722` |
| [config/model-package-links.yaml](../config/model-package-links.yaml) | `6f351ff5231cc650de48e5ef89c8f2fa13650b81312badd9ed6c525373e04f7e` |
| [config/plumbing.yaml](../config/plumbing.yaml) | `28b6213e8f1c15d433ff5a7c3064efa7248b839a8aca97e060370b4aad51cc32` |
| [docs/pending-site-data.md](../docs/pending-site-data.md) | `5d0dec413e4e8a62570f83a44a1949057740c8f14d32c65719ff2bc77594a8bc` |
| [schedule/phase-1/control.yaml](../schedule/phase-1/control.yaml) | `3e22e4c85f7e21eb6549b8f7df382e6d8991b6e68cc22569d95bb6beba4e7d6c` |
| [schedule/phase-2/control.yaml](../schedule/phase-2/control.yaml) | `2010dab825bedb8e00b7aafc43ba908378fba5422709d94d3812a122a3a5590f` |
| [schedule/phase-3/control.yaml](../schedule/phase-3/control.yaml) | `e784a1e8e5295f1322d8d346abaded152b2308d85de9cd0f8a4355d4fcec943e` |
| [schedule/phase-scope.yaml](../schedule/phase-scope.yaml) | `4928a254129241b0762e6cda2831be995df30802b979bd2cf8da6eaba66f87a4` |
| [schedule/roadmap.yaml](../schedule/roadmap.yaml) | `0a954474b7fd676d98db498973c560aa45fddb2c67fd7364b453e6d4dff9dc45` |

任何输入源变化都会使此清单的输入指纹变化；验证器会报告旧视图及变化文件。已通过的现场检查还会比较自身记录的项目数据指纹和验收标准指纹，变化后转为 stale 并阻止付款放行。
