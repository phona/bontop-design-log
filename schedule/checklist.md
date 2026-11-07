<!-- schedule-input-snapshot:{"config/acceptance.yaml":"1d739b2c35e38c0fba27b38dd0314b81c5f79700ab939cde605872e6c177267f","config/decision-gates.yaml":"4496e9cdb3deb14ba3aa3404f3484162bd5c39c69dcf24b0dd32c7b1c578e41e","config/electrical-topology.yaml":"901e950952da0eeee5234c860bdddc6a67ff984360f0d36645eac2676cf22c51","config/electrical.yaml":"4d16434c89d115c3a7d22adb8f5de636d8a3fe96a24b0f1fd6aae300b833504a","config/house.yaml":"22762dfb07e1e992d1d614b7d81569bcabc5fa4056c3675818dedeaefb030789","config/hvac.yaml":"2f5486fa46d6a322a69da9c9a53f072011ecb5a65d8ea3b6e67af6f839102342","config/layout/model-geometry.yaml":"d3a0fca40f30ca431c0ca0a9375aae172d5f7372f1dd102c4d9982bc2927aa8f","config/mep-hvac-coordination.yaml":"1682441637540bcd09d7d6ebb55e0b3b0c7372ef2cb747f59422c247ba08f289","config/model-package-links.yaml":"cc7fedf960f87cf8addb373b8f14863b0c2928fac59e5d91ba3f645a5b37404c","config/model/envelope/ceiling.yaml":"10e7a166b70dbb3f04f4b3670ed9ebf20bf8294bad648be5fd10ae7b16b09271","config/model/envelope/finish-defaults.yaml":"61b8d45abca702e88872c959a460cb9cc1d8ad9c9e2418c830539b8b341f886a","config/model/envelope/floor-zones.yaml":"ce8d5142d70922be175bd6fb0975be7bc38313b3217791522a7f17a64266bee2","config/model/envelope/openings.yaml":"a5609d286d2407af44420b031a8dee245b0be2ba81461221cafb4a1d53e9f880","config/plumbing.yaml":"a4aed2ff8009571baf8def2169486c3e0e353b5920f6590c032f45e7184fc7a7","docs/pending-site-data.md":"37aabf33e5070ff97d8d935ca0d651bae16d4fbd4d9040964f45147c9833fd36","schedule/phase-1/control.yaml":"870397c019aa261944a9d1418435c9cf12e6eb546ca86c276e2f85d037b59648","schedule/phase-2/control.yaml":"0b2494f2fd7a2621462dc77eeee08b27f383c1ee0271cf144eb7ff38d63cca64","schedule/phase-3/control.yaml":"e784a1e8e5295f1322d8d346abaded152b2308d85de9cd0f8a4355d4fcec943e","schedule/phase-scope.yaml":"4928a254129241b0762e6cda2831be995df30802b979bd2cf8da6eaba66f87a4","schedule/roadmap.yaml":"a3b9e2b41bcaa8c3c9f049ab6b905fb4d56b957f9c7c880e77ba84ec0ddbafd9"} -->
# 项目进度与阶段 Checkpoint

> 自动生成：请勿直接编辑。维护源为各阶段 control.yaml、roadmap.yaml、phase-scope.yaml、model-package-links.yaml、验收标准和已关联项目配置。  
> 项目数据指纹：`sha256:04b73f1fea2c4173f423817cc3eb2017868014cb22bb8222d1729b2cf2108a03`（20 个输入文件）  
> 当前量房待确认台账：77 个编号，详情见 [量房待填清单](../docs/pending-site-data.md)。

## 怎么用这份清单

- 先看阶段表，按“当前状态”和“启动门槛”决定是否进入下一阶段。
- 一期按 [一期施工与验收清单](phase-1/checklist.md) 的当前工作包推进；每个包展示开始条件、检查方法、通过标准、证据和关联项目数据。
- 二期、三期目前仍是提案，只能核对启动门槛；选定范围后还要把每个项目拆成施工工作包，不能把候选清单当采购或施工指令。
- 更新了项目配置或现场台账后，运行 `npm run schedule:render`。`npm run verify:schedule` 只读检查生成文件是否过期，不会替你悄悄重写。

## 阶段路线与状态

| 阶段 | 当前状态 | 当前预算口径 | 启动 / 下一步条件 | 执行清单 |
|---|---|---:|---|---|
| 一期基本入住 | planning | ¥210,099 上限 | 交房查验完成后进入PKG-000；量房、图纸会审和同口径报价须在施工放线前完成，物业手续须在施工进场前完成 | [打开清单](phase-1/checklist.md) |
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
| [config/acceptance.yaml](../config/acceptance.yaml) | `1d739b2c35e38c0fba27b38dd0314b81c5f79700ab939cde605872e6c177267f` |
| [config/decision-gates.yaml](../config/decision-gates.yaml) | `4496e9cdb3deb14ba3aa3404f3484162bd5c39c69dcf24b0dd32c7b1c578e41e` |
| [config/electrical-topology.yaml](../config/electrical-topology.yaml) | `901e950952da0eeee5234c860bdddc6a67ff984360f0d36645eac2676cf22c51` |
| [config/electrical.yaml](../config/electrical.yaml) | `4d16434c89d115c3a7d22adb8f5de636d8a3fe96a24b0f1fd6aae300b833504a` |
| [config/house.yaml](../config/house.yaml) | `22762dfb07e1e992d1d614b7d81569bcabc5fa4056c3675818dedeaefb030789` |
| [config/hvac.yaml](../config/hvac.yaml) | `2f5486fa46d6a322a69da9c9a53f072011ecb5a65d8ea3b6e67af6f839102342` |
| [config/layout/model-geometry.yaml](../config/layout/model-geometry.yaml) | `d3a0fca40f30ca431c0ca0a9375aae172d5f7372f1dd102c4d9982bc2927aa8f` |
| [config/mep-hvac-coordination.yaml](../config/mep-hvac-coordination.yaml) | `1682441637540bcd09d7d6ebb55e0b3b0c7372ef2cb747f59422c247ba08f289` |
| [config/model-package-links.yaml](../config/model-package-links.yaml) | `cc7fedf960f87cf8addb373b8f14863b0c2928fac59e5d91ba3f645a5b37404c` |
| [config/model/envelope/ceiling.yaml](../config/model/envelope/ceiling.yaml) | `10e7a166b70dbb3f04f4b3670ed9ebf20bf8294bad648be5fd10ae7b16b09271` |
| [config/model/envelope/finish-defaults.yaml](../config/model/envelope/finish-defaults.yaml) | `61b8d45abca702e88872c959a460cb9cc1d8ad9c9e2418c830539b8b341f886a` |
| [config/model/envelope/floor-zones.yaml](../config/model/envelope/floor-zones.yaml) | `ce8d5142d70922be175bd6fb0975be7bc38313b3217791522a7f17a64266bee2` |
| [config/model/envelope/openings.yaml](../config/model/envelope/openings.yaml) | `a5609d286d2407af44420b031a8dee245b0be2ba81461221cafb4a1d53e9f880` |
| [config/plumbing.yaml](../config/plumbing.yaml) | `a4aed2ff8009571baf8def2169486c3e0e353b5920f6590c032f45e7184fc7a7` |
| [docs/pending-site-data.md](../docs/pending-site-data.md) | `37aabf33e5070ff97d8d935ca0d651bae16d4fbd4d9040964f45147c9833fd36` |
| [schedule/phase-1/control.yaml](../schedule/phase-1/control.yaml) | `870397c019aa261944a9d1418435c9cf12e6eb546ca86c276e2f85d037b59648` |
| [schedule/phase-2/control.yaml](../schedule/phase-2/control.yaml) | `0b2494f2fd7a2621462dc77eeee08b27f383c1ee0271cf144eb7ff38d63cca64` |
| [schedule/phase-3/control.yaml](../schedule/phase-3/control.yaml) | `e784a1e8e5295f1322d8d346abaded152b2308d85de9cd0f8a4355d4fcec943e` |
| [schedule/phase-scope.yaml](../schedule/phase-scope.yaml) | `4928a254129241b0762e6cda2831be995df30802b979bd2cf8da6eaba66f87a4` |
| [schedule/roadmap.yaml](../schedule/roadmap.yaml) | `a3b9e2b41bcaa8c3c9f049ab6b905fb4d56b957f9c7c880e77ba84ec0ddbafd9` |

任何输入源变化都会使此清单的输入指纹变化；验证器会报告旧视图及变化文件。已通过的现场检查还会比较自身记录的项目数据指纹和验收标准指纹，变化后转为 stale 并阻止付款放行。
