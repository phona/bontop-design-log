<!-- schedule-input-snapshot:{"config/acceptance.yaml":"ff38698cff4e22709aa0219214d71334d4176cbba94eb57d1dab134f5ba2ac77","config/decision-gates.yaml":"adb9605d279d6e3ea60ce70f77f6a0e441e5dbe66e0f43ab8abf18955d194036","config/electrical.yaml":"358b37a59a25457c7a638e436d0a1d61bfcf873b9988a40ee9e83c0121e12844","config/house.yaml":"a1f73bb2611e35a6a6dcdb76a0dcda62e438bf76289987bfaaddecff50d69aad","config/model-package-links.yaml":"2dee99eba5ff687773bf495d1000f2b6ae41ab1cee0de24767e4900c41f0b30f","config/model/envelope/ceiling.yaml":"8d2ae2823bbb92ce920b30485b63de80b620d4a6ec081b99c4c59aba3e447f73","config/model/envelope/finish-defaults.yaml":"cfb08b4fefefc71aa1525c5172cc28596b855bc6b95eb576302512314a942b4d","config/model/envelope/floor-zones.yaml":"a2b1251d0dd6d65a093496188fa5be5c5ee514947a9756daecabbc60c9cd01f3","config/model/envelope/openings.yaml":"19fe765e675b357769e1e7d6f9a2659097e85a9d3b34dd4c0595e51882678450","config/plumbing.yaml":"0e3a1c74d47a5c298830eb6abbcdcba9c2068a6538f1979293b6d50db602cc91","schedule/phase-1/control.yaml":"13bf6f13f4f3cf7a7bbbba72f0f7a749e801f98aed5c6487d6f2f46a9a399697","schedule/phase-2/control.yaml":"db17332e72cc1859d4e70ba2479e552240ca173875a47fa6ed089cc5e5f29915","schedule/phase-scope.yaml":"b6d5bec0a317cfdd67e6db7c839bdaea23035cebaa5dde1442d920d2aaac481d","schedule/roadmap.yaml":"a3b9e2b41bcaa8c3c9f049ab6b905fb4d56b957f9c7c880e77ba84ec0ddbafd9"} -->
# 二期功能升级推进清单

> 自动生成：请勿直接编辑。维护源：`schedule/phase-2/control.yaml`  
> 视图输入指纹：`sha256:8ecfd34007760ca55d8d48d1e71d7fd127f54068ec4e05551f7e07cbad86e062`（14 个输入文件）  
> Gate记录用项目数据指纹：`sha256:dfeac09101529d4a2502599b2e53f2461f43a046e2850f85793ef939e583f53f`  
> 阶段状态：`proposed`；决策状态：`alignment_required`

## 当前可执行范围

- 当前只执行启动条件核对、范围澄清和预算确认；不得将候选清单视为采购或施工授权。
- 启动门槛全部通过并由业主冻结范围后，须把选中的项目拆成有顺序、依赖、负责人、数据输入、验收标准、证据和验收/付款门槛的工作包，再生成实施清单。

## 阶段启动 Checkpoint

| ID | 当前状态 | 要完成什么 | 通过条件 | 责任角色 | 必需证据 | 当前验收指纹 |
|---|---|---|---|---|---|---|
| P2-GATE-01 | blocked | 一期竣工结算和资料移交完成 | PKG-170 通过；最终结算、缺陷清单和一期竣工资料已签收 | 业主、施工方 | final_account_statement、closed_defect_register、signed_handover_index | `8fdf720a8b538c89b4919947ad285e1f9f93a9017cc308667aceef63b931608c`<br>尚无检查记录 |
| P2-GATE-02 | blocked | 根据一期实际结余重新确定二期总上限 | 一期实际支出、未付承诺和预备金结余已对账，业主书面批准二期预算上限 | 业主 | phase_1_final_budget、owner_budget_approval | `5163923f8787aa994805caeb20db7e2fd10c39c3263666dfed48a8ab9b9266cd`<br>尚无检查记录 |
| P2-GATE-03 | blocked | 逐项确认采购必要性、尺寸、接口、保修和当前方案是否仍有效 | 每个候选均明确保留/延期/取消；保留项有现场复尺、接口与书面报价，P2-100柜组边界和P2-160灯光范围已对齐当前项目数据，并已拆成可验收工作包 | 业主、设计师、设备供应商、定制供应商 | approved_phase_scope、site_fit_records、written_quotes、approved_work_package_plan | `fb3cc87a9c54187883635009bd2c11fdb4e456b09a2c854bd4de388f2264608a`<br>尚无检查记录 |

## 候选范围

| ID | 项目 | 预算区间 | 状态 | 关联项目数据 |
|---|---|---:|---|---|
| P2-010 | 电视及电视墙系统（含客厅低柜） | ¥11,000—¥14,000 | proposed | [config/house.yaml](../../config/house.yaml) — ids=ld.wall_cabinet_tall,ld.tv_wall_low,ld.tv_65 |
| P2-020 | 烘干机 | ¥2,500—¥4,500 | proposed | [config/house.yaml](../../config/house.yaml) — ids=balcony.dryer |
| P2-030 | 洗碗机 | ¥2,500—¥4,000 | proposed | [config/house.yaml](../../config/house.yaml) — ids=kitchen.dishwasher |
| P2-040 | 净水器 | ¥1,500—¥2,500 | proposed | [config/plumbing.yaml](../../config/plumbing.yaml) — ids=faucet_kitchen_purifier |
| P2-060 | 客厅咖啡桌、地灯、绿植等小件家具 | ¥2,000—¥4,000 | proposed | [config/house.yaml](../../config/house.yaml) — ids=ld.floor_lamp,ld.plant_fiddle,ld.coffee_table |
| P2-070 | 窗帘电机 | ¥3,000—¥4,000 | proposed | [config/model/envelope/openings.yaml](../../config/model/envelope/openings.yaml) — ids=curtain_living_south,curtain_master_west,curtain_master_south,curtain_master_strip_fabric,curtain_mb_washbasin_blinds,curtain_parent_south,curtain_study_south,curtain_nw_north,curtain_mbath_corner<br>[config/model/envelope/floor-zones.yaml](../../config/model/envelope/floor-zones.yaml) — ids=curtain_living_south,curtain_master_west,curtain_master_south,curtain_master_strip_fabric,curtain_mb_washbasin_blinds,curtain_parent_south,curtain_study_south,curtain_nw_north,curtain_mbath_corner<br>[config/model/envelope/finish-defaults.yaml](../../config/model/envelope/finish-defaults.yaml) — ids=curtain_living_south,curtain_master_west,curtain_master_south,curtain_master_strip_fabric,curtain_mb_washbasin_blinds,curtain_parent_south,curtain_study_south,curtain_nw_north,curtain_mbath_corner<br>[config/electrical.yaml](../../config/electrical.yaml) — ids=sock_living_curtain,sock_master_curtain,sock_parent_curtain,sock_study_curtain |
| P2-080 | 家庭健身设备 | ¥1,000—¥1,500 | proposed | 待补数据映射 |
| P2-090 | 晾衣架 | ¥600—¥700 | proposed | [config/model/envelope/ceiling.yaml](../../config/model/envelope/ceiling.yaml) — trade=drying_rack |
| P2-100 | 主卧通顶定制衣柜（一期后移，藏空调冷凝水管槽，必须定制） | ¥3,000—¥5,000 | proposed | [config/house.yaml](../../config/house.yaml) — ids=mb.bed_180,mb.wardrobe_950,mb.wardrobe_pelmet,mb.bedside_cabinet_north,mb.bedside_cabinet_south,mb.washbasin_cabinet,mb.dressing_table,mb.dressing_stool,mb.low_dresser,mb.vanity_base_cabinet,mb.vanity_lower_board,mb.vanity_main_board,mb.condensate_pipe,mb.vanity_pvc_wardrobe_entry,mb.vanity_pvc_service_chase,mb.vanity_pvc_box; ids=mb.wardrobe_950,mb.wardrobe_pelmet,mb.vanity_base_cabinet,mb.vanity_lower_board,mb.vanity_main_board,mb.vanity_pvc_box,mb.vanity_pvc_wardrobe_entry,mb.vanity_pvc_service_chase,mb.condensate_pipe |
| P2-110 | 客厅与书房窗帘（一期后移） | ¥4,000—¥6,000 | proposed | [config/house.yaml](../../config/house.yaml) — room_ids=living_dining,study; types=curtain_set |
| P2-120 | 书房与西北次卧家具（一期后移） | ¥3,000—¥5,000 | proposed | [config/house.yaml](../../config/house.yaml) — ids=bnw.bed_150,bnw.wardrobe_180,bnw.desk,bnw.chair,bnw.shelf,study.desk,study.chair,study.seasonal_wardrobe_wall,study.seasonal_wardrobe_step_north,study.seasonal_wardrobe_step_south |
| P2-130 | 壁床柜（一期后移） | ¥3,000—¥5,000 | proposed | 待补数据映射 |
| P2-140 | 客厅大收纳柜（一期后移） | ¥2,000—¥4,000 | proposed | [config/house.yaml](../../config/house.yaml) — ids=ld.wall_cabinet_tall |
| P2-150 | 展示柜（一期后移） | ¥1,000—¥3,000 | proposed | 待补数据映射 |
| P2-160 | 复杂灯光升级（筒射灯轨道灯，一期后移） | ¥2,000—¥4,000 | proposed | [config/electrical.yaml](../../config/electrical.yaml) — ids=light_dining_pendant,light_corridor_1,light_entry_down,light_entry_foyer |
## 验收与记录

- 每个启动 Checkpoint 核对后，在阶段控制源的 `audit.records` 追加 `gate_id`、结果、检查人、日期、证据、`gate_spec_sha256` 和 `project_data_sha256`。复验追加记录，不覆盖历史。
- 未定义通过条件、责任角色或证据的 gate 不能标为 passed。
- 项目数据或本阶段范围变化后重新生成清单；旧的通过记录需按当前数据重新核对。
