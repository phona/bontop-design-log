<!-- schedule-input-snapshot:{"config/acceptance.yaml":"e789e04312cb9ae62d1a02eab72eb44f709075db58f09510ece4b85e57142187","config/decision-gates.yaml":"e1066799953f6aeb74e5234d4bdc7f153cf473b95d5eedb91bcce7174ba16012","config/electrical.yaml":"99febaecae6bd906169917b1b7d77696586052ba07e7d517433cb6147186e3fa","config/house.yaml":"7eac810a5e29b40fc3ccf017d40b2010e74a59f9d39ad2a7f3f1a442e5b34ab9","config/model-package-links.yaml":"e94c8d9fff58aa297f4cb403261b708781ee44ddb52cbb2d6594527bb9cf7afc","schedule/phase-1/control.yaml":"d708440b8ed1fbef1f3e5203b1a980d31260294e5ebf45f5b028cb653e821a72","schedule/phase-2/control.yaml":"3e36ba8c6cf86e2173c49354d7a48780197c8b8876653b80aae12826f07cebb6","schedule/phase-3/control.yaml":"e784a1e8e5295f1322d8d346abaded152b2308d85de9cd0f8a4355d4fcec943e","schedule/phase-scope.yaml":"b29abcb3ab3e4a4207bd724c9420a02939b9cb2066508261e3f215e6d09f66af","schedule/roadmap.yaml":"a3b9e2b41bcaa8c3c9f049ab6b905fb4d56b957f9c7c880e77ba84ec0ddbafd9"} -->
# 三期入住后优化推进清单

> 自动生成：请勿直接编辑。维护源：`schedule/phase-3/control.yaml`  
> 视图输入指纹：`sha256:76171d74d1653d70a6d37b7a04dae4dade70d165604558d63a4952350eef5e59`（10 个输入文件）  
> Gate记录用项目数据指纹：`sha256:5e26c7b1f8af9c75db8251f608221d34787f0c7b657572f7785484a4e5f91bf6`  
> 阶段状态：`proposed`；决策状态：`alignment_required`

## 当前可执行范围

- 当前只执行启动条件核对、范围澄清和预算确认；不得将候选清单视为采购或施工授权。
- 启动门槛全部通过并由业主冻结范围后，须把选中的项目拆成有顺序、依赖、负责人、数据输入、验收标准、证据和验收/付款门槛的工作包，再生成实施清单。

## 阶段启动 Checkpoint

| ID | 当前状态 | 要完成什么 | 通过条件 | 责任角色 | 必需证据 | 当前验收指纹 |
|---|---|---|---|---|---|---|
| P3-GATE-01 | blocked | 一期完成并开始真实入住观察 | 记录入住开始日期，并由业主确认观察周期的结束条件；不预设固定观察天数 | 业主 | occupancy_start_record、owner_observation_window | `c291733a071882b7b94ab9317bad8071d7907ebb887d7b5b898730e2005d28a0`<br>尚无检查记录 |
| P3-GATE-02 | blocked | 形成基于真实使用问题的缺口清单 | 每条问题记录日期、房间、使用场景、发生频率、影响、照片或视频、临时解决办法，并区分安全/功能/体验/审美 | 业主 | occupancy_observation_log、prioritized_gap_list | `81c62be9ecd4a22a0f15805149f1aed4f61e2f59fc1f20239bb4d30ed9d5ed09`<br>尚无检查记录 |
| P3-GATE-03 | blocked | 业主确认三期具体项目和预算上限 | 每个保留项目有尺寸、安装/摆放方式、维护条件、报价、验收标准和预算批准；固定灯位或电气变更已转为工程工作包 | 业主、设计师、供应商 | approved_phase_scope、written_quotes、approved_work_package_plan | `3124f9d4f55efdb01645c4d65b6297e26a1db3f40e7c3ab22e04b054c203d923`<br>尚无检查记录 |
| P3-GATE-04 | blocked | 二期对三期涉及空间的影响已完成或冻结 | 二期已完成，或其对墙面、窗帘、灯光、家具和动线的影响范围已有书面冻结基线 | 业主、设计师 | phase_2_closeout_or_scope_freeze | `311e926f5bec74e58d1e5282bbfef4daa1e89de6ef144e16ce12118a2916812a`<br>尚无检查记录 |

## 候选范围

| ID | 项目 | 预算区间 | 状态 | 关联项目数据 |
|---|---|---:|---|---|
| P3-010 | 装饰画与墙面陈设 | 不预分配 | proposed | 待补数据映射 |
| P3-020 | 地毯靠垫及补充织物 | 不预分配 | proposed | 待补数据映射 |
| P3-030 | 绿植与小型摆件 | 不预分配 | proposed | [config/house.yaml](../../config/house.yaml) — ids=ld.plant_fiddle |
| P3-040 | 入住后灯光氛围微调 | 不预分配 | proposed | [config/electrical.yaml](../../config/electrical.yaml) — ids=light_dining_pendant,light_corridor_1,light_entry_down,light_entry_foyer |

## 入住观察记录要求

每条记录保留：id、observed_at、room、use_scenario、problem、frequency、impact、evidence、temporary_solution、category、owner、status。观察周期由业主在启动时确认并记录，不用固定天数替代真实使用反馈。

## 验收与记录

- 每个启动 Checkpoint 核对后，在阶段控制源的 `audit.records` 追加 `gate_id`、结果、检查人、日期、证据、`gate_spec_sha256` 和 `project_data_sha256`。复验追加记录，不覆盖历史。
- 未定义通过条件、责任角色或证据的 gate 不能标为 passed。
- 项目数据或本阶段范围变化后重新生成清单；旧的通过记录需按当前数据重新核对。
