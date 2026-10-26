<!-- schedule-input-snapshot:{"config/acceptance.yaml":"2073ae223d39584f438e2be0fe231b0719b456b863e0c379c216681089b90e9f","config/ceiling.yaml":"9235822b1161c4cf6ab10d966b9267bb96ef3830252b4eb81d56cd88a6be27eb","config/electrical.yaml":"1b776139e6a279719b01e20315ca05b43ecf6d506c64fe5aa90dbd45ce6fb405","config/house.yaml":"2909f803c378c1804bbb83e485dd1d3ad553b30336357ce80650ce9f9b9776f0","config/layout/overlay.yaml":"d9271c4ea1824d8bf57be73c089fab5c321c007a93cff7f781a604e90c904f44","config/model-package-links.yaml":"6f351ff5231cc650de48e5ef89c8f2fa13650b81312badd9ed6c525373e04f7e","config/plumbing.yaml":"28b6213e8f1c15d433ff5a7c3064efa7248b839a8aca97e060370b4aad51cc32","schedule/phase-1/control.yaml":"3e22e4c85f7e21eb6549b8f7df382e6d8991b6e68cc22569d95bb6beba4e7d6c","schedule/phase-2/control.yaml":"2010dab825bedb8e00b7aafc43ba908378fba5422709d94d3812a122a3a5590f","schedule/phase-scope.yaml":"4928a254129241b0762e6cda2831be995df30802b979bd2cf8da6eaba66f87a4","schedule/roadmap.yaml":"0a954474b7fd676d98db498973c560aa45fddb2c67fd7364b453e6d4dff9dc45"} -->
# 二期功能升级推进清单

> 自动生成：请勿直接编辑。维护源：`schedule/phase-2/control.yaml`  
> 视图输入指纹：`sha256:2fd9bdb3ccf6cc3719412b3877250d103ef4dfef0eaefa61c80002543a0039a5`（11 个输入文件）  
> Gate记录用项目数据指纹：`sha256:4ca99ec21dbb63746cd6a2db0393e7dca6ccc8b5709840b0eb3fe11236a4e9f5`  
> 阶段状态：`proposed`；决策状态：`alignment_required`

## 当前可执行范围

- 当前只执行启动条件核对、范围澄清和预算确认；不得将候选清单视为采购或施工授权。
- 启动门槛全部通过并由业主冻结范围后，须把选中的项目拆成有顺序、依赖、负责人、数据输入、验收标准、证据和验收/付款门槛的工作包，再生成实施清单。

## 阶段启动 Checkpoint

| ID | 当前状态 | 要完成什么 | 通过条件 | 责任角色 | 必需证据 | 当前验收指纹 |
|---|---|---|---|---|---|---|
| P2-GATE-01 | blocked | 一期竣工结算和资料移交完成 | PKG-170 通过；最终结算、缺陷清单和一期竣工资料已签收 | 业主、施工方 | final_account_statement、closed_defect_register、signed_handover_index | `8fdf720a8b538c89b4919947ad285e1f9f93a9017cc308667aceef63b931608c`<br>尚无检查记录 |
| P2-GATE-02 | blocked | 根据一期实际结余重新确定二期总上限 | 一期实际支出、未付承诺和预备金结余已对账，业主书面批准二期预算上限 | 业主 | phase_1_final_budget、owner_budget_approval | `5163923f8787aa994805caeb20db7e2fd10c39c3263666dfed48a8ab9b9266cd`<br>尚无检查记录 |
| P2-GATE-03 | blocked | 逐项确认采购必要性、尺寸、接口、保修和当前方案是否仍有效 | 每个候选均明确保留/延期/取消；保留项有现场复尺、接口与书面报价，P2-100柜组边界和P2-160灯光范围已对齐当前项目数据，并已拆成可验收工作包 | 业主、设计师、设备供应商、定制供应商 | approved_phase_scope、site_fit_records、written_quotes、approved_work_package_plan | `327aa0313953133b1593046b68ca89db9a582ab8790adc57e53561cbd8eaa75e`<br>尚无检查记录 |

## 候选范围

| ID | 项目 | 预算区间 | 状态 | 关联项目数据 |
|---|---|---:|---|---|
| P2-010 | 电视及电视墙系统（含客厅低柜） | ¥11,000—¥14,000 | proposed | [config/house.yaml](../../config/house.yaml) — room_ids=living_dining; types=tv_wall_low,tv_65,wall_cabinet_tall |
| P2-020 | 烘干机 | ¥2,500—¥4,500 | proposed | [config/house.yaml](../../config/house.yaml) — room_ids=balcony; types=dryer |
| P2-030 | 洗碗机 | ¥2,500—¥4,000 | proposed | [config/house.yaml](../../config/house.yaml) — room_ids=kitchen; types=dishwasher |
| P2-040 | 净水器 | ¥1,500—¥2,500 | proposed | [config/plumbing.yaml](../../config/plumbing.yaml) — ids=faucet_kitchen_purifier |
| P2-060 | 客厅咖啡桌、地灯、绿植等小件家具 | ¥2,000—¥4,000 | proposed | [config/house.yaml](../../config/house.yaml) — room_ids=living_dining; types=coffee_table,floor_lamp,plant_fiddle |
| P2-070 | 窗帘电机 | ¥3,000—¥4,000 | proposed | [config/layout/overlay.yaml](../../config/layout/overlay.yaml) — types=curtain<br>[config/electrical.yaml](../../config/electrical.yaml) — ids=sock_living_curtain,sock_master_curtain,sock_parent_curtain,sock_study_curtain |
| P2-080 | 家庭健身设备 | ¥1,000—¥1,500 | proposed | 待补数据映射 |
| P2-090 | 晾衣架 | ¥600—¥700 | proposed | [config/ceiling.yaml](../../config/ceiling.yaml) — trade=drying_rack |
| P2-100 | 主卧通顶定制衣柜（一期后移，藏空调冷凝水管槽，必须定制） | ¥3,000—¥5,000 | proposed | [config/house.yaml](../../config/house.yaml) — room_ids=master_bedroom; types=master_north_wall_wardrobe_950,mb_vanity_base_cabinet,mb_vanity_lower_board,mb_vanity_main_board,mb_vanity_pvc_box,mb_vanity_pvc_wardrobe_entry,mb_vanity_pvc_service_chase |
| P2-110 | 客厅与书房窗帘（一期后移） | ¥4,000—¥6,000 | proposed | [config/house.yaml](../../config/house.yaml) — room_ids=living_dining,study; types=curtain_set |
| P2-120 | 书房与西北次卧家具（一期后移） | ¥3,000—¥5,000 | proposed | [config/house.yaml](../../config/house.yaml) — room_ids=study,bedroom_nw |
| P2-130 | 壁床柜（一期后移） | ¥3,000—¥5,000 | proposed | 待补数据映射 |
| P2-140 | 客厅大收纳柜（一期后移） | ¥2,000—¥4,000 | proposed | [config/house.yaml](../../config/house.yaml) — room_ids=living_dining; types=wall_cabinet_tall |
| P2-150 | 展示柜（一期后移） | ¥1,000—¥3,000 | proposed | 待补数据映射 |
| P2-160 | 复杂灯光升级（筒射灯轨道灯，一期后移） | ¥2,000—¥4,000 | proposed | [config/electrical.yaml](../../config/electrical.yaml) — types=downlight,ceiling_light |
## 验收与记录

- 每个启动 Checkpoint 核对后，在阶段控制源的 `audit.records` 追加 `gate_id`、结果、检查人、日期、证据、`gate_spec_sha256` 和 `project_data_sha256`。复验追加记录，不覆盖历史。
- 未定义通过条件、责任角色或证据的 gate 不能标为 passed。
- 项目数据或本阶段范围变化后重新生成清单；旧的通过记录需按当前数据重新核对。
