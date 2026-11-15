<!-- schedule-input-snapshot:{"config/acceptance.yaml":"e789e04312cb9ae62d1a02eab72eb44f709075db58f09510ece4b85e57142187","config/decision-gates.yaml":"e1066799953f6aeb74e5234d4bdc7f153cf473b95d5eedb91bcce7174ba16012","config/electrical.yaml":"a8c35cd904c7b8c36aabfa97824b86188b483f7d64d072ccbc305fb4b4f07276","config/house.yaml":"afa712f81bb7b17557f758fd9c6e1f3ab4750e6530d1c62bf9bbb445464966b6","config/model-package-links.yaml":"963c62033e7f6717f73ee1d85b4c35fa63a65f9b3d4bfde839248fa9f81080b1","schedule/phase-1/control.yaml":"f73ad83dbc7d5ef0e566d5e83a9be7812530ec338582b6091ea682d75cbf625f","schedule/phase-2/control.yaml":"f5d8c0347a1d3208e39d5d12b38d1459655c51513ef5d5b6e3a52fb3a2dc7f81","schedule/phase-3/control.yaml":"e784a1e8e5295f1322d8d346abaded152b2308d85de9cd0f8a4355d4fcec943e","schedule/phase-scope.yaml":"17d0874a87fc441c2ad66eb1abfc55d341abfc4e9e32229889998e9e227cc8b6","schedule/roadmap.yaml":"e0203255eae42123aa20e2faa8354636b889274cfd8d06e11858ac0674827409"} -->
# 三期入住后优化推进清单

> 自动生成：请勿直接编辑。维护源：`schedule/phase-3/control.yaml`  
> 视图输入指纹：`sha256:1b77c3e14cd218fc0d43ef139eaf4daa97e21a730f68c3ace0af117d1438df5f`（10 个输入文件）  
> Gate记录用项目数据指纹：`sha256:66a8551b1f205498eb5298ecd25cae404a292731c534b6d2841bbcf5de695be3`  
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
