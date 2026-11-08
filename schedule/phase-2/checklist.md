<!-- schedule-input-snapshot:{"config/acceptance.yaml":"1d739b2c35e38c0fba27b38dd0314b81c5f79700ab939cde605872e6c177267f","config/decision-gates.yaml":"4496e9cdb3deb14ba3aa3404f3484162bd5c39c69dcf24b0dd32c7b1c578e41e","config/electrical.yaml":"a7c8aeb35a4c51a560b2d0896d786aeeb074e548cfd411755992a48742c4b2bb","config/house.yaml":"ae4998d0042c12aa4bea1470556571faa6e167b424477ffc8a860f26b1800a94","config/model-package-links.yaml":"cc7fedf960f87cf8addb373b8f14863b0c2928fac59e5d91ba3f645a5b37404c","config/model/envelope/ceiling.yaml":"ed324cec145bffebdb406ba68c45b3ae8338cfb2aaf5550a74743bebf98c119f","config/model/envelope/finish-defaults.yaml":"cfb08b4fefefc71aa1525c5172cc28596b855bc6b95eb576302512314a942b4d","config/model/envelope/floor-zones.yaml":"af6e6bc529d7a959be4ec07c9034bcaefad0d8cafcb293c482f093786b0e8eaa","config/model/envelope/openings.yaml":"905e99baddac6f91b4176a386da1076e3dd37fffae86e97472d52f250400bbfe","config/plumbing.yaml":"59dcf4846c3a649d1e9f3329271e3779927dd0444cec22e623abf28e8c162cec","schedule/phase-1/control.yaml":"870397c019aa261944a9d1418435c9cf12e6eb546ca86c276e2f85d037b59648","schedule/phase-2/control.yaml":"0b2494f2fd7a2621462dc77eeee08b27f383c1ee0271cf144eb7ff38d63cca64","schedule/phase-scope.yaml":"4928a254129241b0762e6cda2831be995df30802b979bd2cf8da6eaba66f87a4","schedule/roadmap.yaml":"a3b9e2b41bcaa8c3c9f049ab6b905fb4d56b957f9c7c880e77ba84ec0ddbafd9"} -->
# 二期功能升级推进清单

> 自动生成：请勿直接编辑。维护源：`schedule/phase-2/control.yaml`  
> 视图输入指纹：`sha256:5811e90a847c288accff88ebbac3f896ce9f31fcf4a8c083b3f504ef592ab534`（14 个输入文件）  
> Gate记录用项目数据指纹：`sha256:0100280309747e95c60827134b749c3227dbfcd763a61a5ad7ec0b72fb35facb`  
> 阶段状态：`proposed`；决策状态：`alignment_required`

## 当前可执行范围

- 当前只执行启动条件核对、范围澄清和预算确认；不得将候选清单视为采购或施工授权。
- 启动门槛全部通过并由业主冻结范围后，须把选中的项目拆成有顺序、依赖、负责人、数据输入、验收标准、证据和验收/付款门槛的工作包，再生成实施清单。

## 阶段启动 Checkpoint

| ID | 当前状态 | 要完成什么 | 通过条件 | 责任角色 | 必需证据 | 当前验收指纹 |
|---|---|---|---|---|---|---|
| P2-GATE-01 | blocked | 一期竣工结算和资料移交完成 | PKG-170 通过；最终结算、缺陷清单和一期竣工资料已签收 | 业主、施工方 | final_account_statement、closed_defect_register、signed_handover_index | `8fdf720a8b538c89b4919947ad285e1f9f93a9017cc308667aceef63b931608c`<br>尚无检查记录 |
| P2-GATE-02 | blocked | 根据一期实际结余重新确定二期总上限 | 一期实际支出、未付承诺和预备金结余已对账，业主书面批准二期预算上限 | 业主 | phase_1_final_budget、owner_budget_approval | `5163923f8787aa994805caeb20db7e2fd10c39c3263666dfed48a8ab9b9266cd`<br>尚无检查记录 |
| P2-GATE-03 | blocked | 逐项确认采购必要性、尺寸、接口、保修和当前方案是否仍有效 | 每个候选均明确保留/延期/取消；保留项有现场复尺、接口与书面报价，P2-100柜组边界和P2-160灯光范围已对齐当前项目数据，并已拆成可验收工作包 | 业主、设计师、设备供应商、定制供应商 | approved_phase_scope、site_fit_records、written_quotes、approved_work_package_plan | `bf1759172c7381f0384467554991fabe556cff9f37b725f167752b27e0f47c31`<br>尚无检查记录 |

## 候选范围

| ID | 项目 | 预算区间 | 状态 | 关联项目数据 |
|---|---|---:|---|---|
| P2-010 | 电视及电视墙系统（含客厅低柜） | ¥11,000—¥14,000 | proposed | [config/house.yaml](house.yaml) — room_ids=living_dining; types=tv_wall_low,tv_65,wall_cabinet_tall |
| P2-020 | 烘干机 | ¥2,500—¥4,500 | proposed | [config/house.yaml](house.yaml) — room_ids=balcony; types=dryer |
| P2-030 | 洗碗机 | ¥2,500—¥4,000 | proposed | [config/house.yaml](house.yaml) — room_ids=kitchen; types=dishwasher |
| P2-040 | 净水器 | ¥1,500—¥2,500 | proposed | [config/plumbing.yaml](plumbing.yaml) — ids=faucet_kitchen_purifier |
| P2-060 | 客厅咖啡桌、地灯、绿植等小件家具 | ¥2,000—¥4,000 | proposed | [config/house.yaml](house.yaml) — room_ids=living_dining; types=coffee_table,floor_lamp,plant_fiddle |
| P2-070 | 窗帘电机 | ¥3,000—¥4,000 | proposed | [config/model/envelope/openings.yaml](openings.yaml) — ids=curtain_living_south,curtain_master_west,curtain_master_south,curtain_master_strip_fabric,curtain_mb_washbasin_blinds,curtain_parent_south,curtain_study_south,curtain_nw_north,curtain_mbath_corner<br>[config/model/envelope/floor-zones.yaml](floor-zones.yaml) — ids=curtain_living_south,curtain_master_west,curtain_master_south,curtain_master_strip_fabric,curtain_mb_washbasin_blinds,curtain_parent_south,curtain_study_south,curtain_nw_north,curtain_mbath_corner<br>[config/model/envelope/finish-defaults.yaml](finish-defaults.yaml) — ids=curtain_living_south,curtain_master_west,curtain_master_south,curtain_master_strip_fabric,curtain_mb_washbasin_blinds,curtain_parent_south,curtain_study_south,curtain_nw_north,curtain_mbath_corner<br>[config/electrical.yaml](electrical.yaml) — ids=sock_living_curtain,sock_master_curtain,sock_parent_curtain,sock_study_curtain |
| P2-080 | 家庭健身设备 | ¥1,000—¥1,500 | proposed | 待补数据映射 |
| P2-090 | 晾衣架 | ¥600—¥700 | proposed | [config/model/envelope/ceiling.yaml](ceiling.yaml) — trade=drying_rack |
| P2-100 | 主卧通顶定制衣柜（一期后移，藏空调冷凝水管槽，必须定制） | ¥3,000—¥5,000 | proposed | [config/house.yaml](house.yaml) — room_ids=master_bedroom; ids=mb.wardrobe_950,mb.wardrobe_pelmet,mb.vanity_base_cabinet,mb.vanity_lower_board,mb.vanity_main_board,mb.vanity_pvc_box,mb.vanity_pvc_wardrobe_entry,mb.vanity_pvc_service_chase,mb.condensate_pipe |
| P2-110 | 客厅与书房窗帘（一期后移） | ¥4,000—¥6,000 | proposed | [config/house.yaml](house.yaml) — room_ids=living_dining,study; types=curtain_set |
| P2-120 | 书房与西北次卧家具（一期后移） | ¥3,000—¥5,000 | proposed | [config/house.yaml](house.yaml) — room_ids=study,bedroom_nw |
| P2-130 | 壁床柜（一期后移） | ¥3,000—¥5,000 | proposed | 待补数据映射 |
| P2-140 | 客厅大收纳柜（一期后移） | ¥2,000—¥4,000 | proposed | [config/house.yaml](house.yaml) — room_ids=living_dining; types=wall_cabinet_tall |
| P2-150 | 展示柜（一期后移） | ¥1,000—¥3,000 | proposed | 待补数据映射 |
| P2-160 | 复杂灯光升级（筒射灯轨道灯，一期后移） | ¥2,000—¥4,000 | proposed | [config/electrical.yaml](electrical.yaml) — types=downlight,ceiling_light |
## 验收与记录

- 每个启动 Checkpoint 核对后，在阶段控制源的 `audit.records` 追加 `gate_id`、结果、检查人、日期、证据、`gate_spec_sha256` 和 `project_data_sha256`。复验追加记录，不覆盖历史。
- 未定义通过条件、责任角色或证据的 gate 不能标为 passed。
- 项目数据或本阶段范围变化后重新生成清单；旧的通过记录需按当前数据重新核对。
