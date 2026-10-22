<!-- schedule-input-snapshot:{"config/acceptance.yaml":"d63ea5272fae3c11b575df541c8fb0c473c00945c0f6916e04628b1c1e2069c7","config/ceiling.yaml":"4469b08f84abf2442eb2df64ddec205bd78da9d646480056d5683c163fa8c899","config/electrical-topology.yaml":"112be80a82973e59b3dac07790042bc3d9b46086cc38268f298947be0feb5c00","config/electrical.yaml":"5ccf809f2c1134e0c0e3c1c5afaf7c6f71c916280f0e662de88fa20f1173fca7","config/house.yaml":"52b1b8ade6969ddf9d17fbe45bb3c2ec4bafed65545225600a1735d91d788f5e","config/hvac.yaml":"ab93cb47ff04083f7d8cb8bb2a5cdcd7d2e3e62d8357aef0fb7914897e30871c","config/layout/model-geometry.yaml":"585d6a03b3ed1d4b5daf6b2cb2802878ff5d5f1eabff14e569376948bcf56b0f","config/layout/overlay.yaml":"69bd817f08391ef7cbb19f9b9cf85c1014809ea296406f3bae678a6620a47dbc","config/mep-hvac-coordination.yaml":"5090867df2224edcfafee8c66d8be50e228dda5dbde790559826e0a76dde3206","config/model-package-links.yaml":"6f351ff5231cc650de48e5ef89c8f2fa13650b81312badd9ed6c525373e04f7e","config/plumbing.yaml":"8f501540a5ea8e739c1c95171fd09c178245915270efe9a76e0a46afc130473b","docs/pending-site-data.md":"e480707ecfc9779dcba50c6dc45b1108f67df9ec5b892a5fad6023cc5e34d946","schedule/phase-1/control.yaml":"ddf017f2015c7f4d6ca9392d3c2d9f7a27e3b4c197b19e084e363f40ae1fbbc3","schedule/phase-2/control.yaml":"2010dab825bedb8e00b7aafc43ba908378fba5422709d94d3812a122a3a5590f","schedule/phase-3/control.yaml":"e784a1e8e5295f1322d8d346abaded152b2308d85de9cd0f8a4355d4fcec943e","schedule/phase-scope.yaml":"4928a254129241b0762e6cda2831be995df30802b979bd2cf8da6eaba66f87a4","schedule/roadmap.yaml":"0a954474b7fd676d98db498973c560aa45fddb2c67fd7364b453e6d4dff9dc45"} -->
# 项目进度与阶段 Checkpoint

> 自动生成：请勿直接编辑。维护源为各阶段 control.yaml、roadmap.yaml、phase-scope.yaml、model-package-links.yaml、验收标准和已关联项目配置。  
> 项目数据指纹：`sha256:578b202a4daa996ac55310bd32024aaf721628defb48ee825b86c6183dc7ac87`（17 个输入文件）  
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

- **PKG-030｜中央空调第一次安装**：先解除开工阻塞。
- 要做：在吊顶封闭前安装空调室内机、铜管、保温层、冷凝水排水管、风管和控制线，并完成压力保持、排水和检修空间检查。
- 等待：墙体结构、梁底及允许打孔或穿墙条件未确认、中央空调管线、冷凝水、风口和检修口尚未完成厂家深化及三方会审、水电与中央空调的接口未联合冻结——点位与回路、吊顶内分层标高（#41 分区口径）、穿墙孔位高度、冷凝水接入点与立管、检修口与风口均未会签、影响水电与中央空调施工的现场数据尚未全部实测、显式豁免或登记为阻塞；当前清单和数据状态见 docs/pending-site-data.md
- 下一检查点：check_hvac_weld｜铜管焊接质量（引用）。
- 责任角色：空调商、设计师、施工方、业主。详情见 [PKG-030 现场检查点](phase-1/checklist.md#pkg-030)。

## 当前关联项目数据版本

| 数据源 | 当前 SHA-256 |
|---|---|
| [config/acceptance.yaml](../config/acceptance.yaml) | `d63ea5272fae3c11b575df541c8fb0c473c00945c0f6916e04628b1c1e2069c7` |
| [config/ceiling.yaml](../config/ceiling.yaml) | `4469b08f84abf2442eb2df64ddec205bd78da9d646480056d5683c163fa8c899` |
| [config/electrical-topology.yaml](../config/electrical-topology.yaml) | `112be80a82973e59b3dac07790042bc3d9b46086cc38268f298947be0feb5c00` |
| [config/electrical.yaml](../config/electrical.yaml) | `5ccf809f2c1134e0c0e3c1c5afaf7c6f71c916280f0e662de88fa20f1173fca7` |
| [config/house.yaml](../config/house.yaml) | `52b1b8ade6969ddf9d17fbe45bb3c2ec4bafed65545225600a1735d91d788f5e` |
| [config/hvac.yaml](../config/hvac.yaml) | `ab93cb47ff04083f7d8cb8bb2a5cdcd7d2e3e62d8357aef0fb7914897e30871c` |
| [config/layout/model-geometry.yaml](../config/layout/model-geometry.yaml) | `585d6a03b3ed1d4b5daf6b2cb2802878ff5d5f1eabff14e569376948bcf56b0f` |
| [config/layout/overlay.yaml](../config/layout/overlay.yaml) | `69bd817f08391ef7cbb19f9b9cf85c1014809ea296406f3bae678a6620a47dbc` |
| [config/mep-hvac-coordination.yaml](../config/mep-hvac-coordination.yaml) | `5090867df2224edcfafee8c66d8be50e228dda5dbde790559826e0a76dde3206` |
| [config/model-package-links.yaml](../config/model-package-links.yaml) | `6f351ff5231cc650de48e5ef89c8f2fa13650b81312badd9ed6c525373e04f7e` |
| [config/plumbing.yaml](../config/plumbing.yaml) | `8f501540a5ea8e739c1c95171fd09c178245915270efe9a76e0a46afc130473b` |
| [docs/pending-site-data.md](../docs/pending-site-data.md) | `e480707ecfc9779dcba50c6dc45b1108f67df9ec5b892a5fad6023cc5e34d946` |
| [schedule/phase-1/control.yaml](../schedule/phase-1/control.yaml) | `ddf017f2015c7f4d6ca9392d3c2d9f7a27e3b4c197b19e084e363f40ae1fbbc3` |
| [schedule/phase-2/control.yaml](../schedule/phase-2/control.yaml) | `2010dab825bedb8e00b7aafc43ba908378fba5422709d94d3812a122a3a5590f` |
| [schedule/phase-3/control.yaml](../schedule/phase-3/control.yaml) | `e784a1e8e5295f1322d8d346abaded152b2308d85de9cd0f8a4355d4fcec943e` |
| [schedule/phase-scope.yaml](../schedule/phase-scope.yaml) | `4928a254129241b0762e6cda2831be995df30802b979bd2cf8da6eaba66f87a4` |
| [schedule/roadmap.yaml](../schedule/roadmap.yaml) | `0a954474b7fd676d98db498973c560aa45fddb2c67fd7364b453e6d4dff9dc45` |

任何输入源变化都会使此清单的输入指纹变化；验证器会报告旧视图及变化文件。已通过的现场检查还会比较自身记录的项目数据指纹和验收标准指纹，变化后转为 stale 并阻止付款放行。
