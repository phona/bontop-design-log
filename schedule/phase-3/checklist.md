<!-- schedule-input-snapshot:{"config/acceptance.yaml":"a8fb9755147bca9a52dcfc7147a5ef7d6abd3b570b6127522385c8a6fafa6f41","config/decision-gates.yaml":"e1066799953f6aeb74e5234d4bdc7f153cf473b95d5eedb91bcce7174ba16012","config/electrical.yaml":"a408c75200e70d7af6119a84eb38442181259a4508004f83b2fa541dd6992064","config/house.yaml":"9f74193ccdd24ddc8d2296b77bc27cfd0e39959c0e76f581843e8936a489f89c","config/model-package-links.yaml":"963c62033e7f6717f73ee1d85b4c35fa63a65f9b3d4bfde839248fa9f81080b1","schedule/phase-1/control.yaml":"f25e90df5c8ed2171f0f18f8b3ca9e0054d22d1124a27e905e0bbd899c0075b3","schedule/phase-2/control.yaml":"7ad86914b3f5c02cf4722a98eeeb1e80d454d02daa3361c1cefa36ab61c17b7f","schedule/phase-3/control.yaml":"fdda696d95d769bbaf6420617bb90e40053f20d1834263769c6f6ab72acc7d62","schedule/phase-scope.yaml":"17d0874a87fc441c2ad66eb1abfc55d341abfc4e9e32229889998e9e227cc8b6","schedule/roadmap.yaml":"e0203255eae42123aa20e2faa8354636b889274cfd8d06e11858ac0674827409"} -->
# 三期入住后优化推进清单

> 自动生成：请勿直接编辑。维护源：`schedule/phase-3/control.yaml`  
> 视图输入指纹：`sha256:e9bdf0d50901439bd1c4b691569b4578e47e7091e0fea777c3fc1295d1f4d020`（10 个输入文件）  
> Gate记录用项目数据指纹：`sha256:75459929a219181731d15be57b2bf827d15be0a39dad2f9c3cba9e5422739782`  
> 阶段状态：`proposed`；决策状态：`alignment_required`

## 当前可执行范围

- 当前只执行启动条件核对、范围澄清和预算确认；不得将候选清单视为采购或施工授权。
- 启动门槛全部通过并由业主冻结范围后，须把选中的项目拆成有顺序、依赖、负责人、数据输入、验收标准、证据和验收/付款门槛的工作包，再生成实施清单。

## 阶段启动 Checkpoint

| ID | 当前状态 | 要完成什么 | 通过条件 | 责任角色 | 必需证据 | 当前验收指纹 |
|---|---|---|---|---|---|---|
| P3-GATE-01 | blocked | 一期完成并开始真实入住观察 | 记录入住开始日期，并由业主确认观察周期的结束条件；不预设固定观察天数 | 业主 | occupancy_start_record、owner_observation_window | `c291733a071882b7b94ab9317bad8071d7907ebb887d7b5b898730e2005d28a0`<br>尚无检查记录 |
| P3-GATE-02 | blocked | 形成基于真实使用问题的缺口清单 | 每条问题记录日期、房间、使用场景、发生频率、影响、照片或视频、临时解决办法，并区分安全/功能/体验/审美 | 业主 | occupancy_observation_log、prioritized_gap_list | `81c62be9ecd4a22a0f15805149f1aed4f61e2f59fc1f20239bb4d30ed9d5ed09`<br>尚无检查记录 |
| P3-GATE-03 | blocked | 业主确认三期具体项目和预算上限 | 每个保留项目有尺寸、安装/摆放方式、维护条件、报价、验收标准和预算批准；固定灯位或电气变更已转为工程工作包 | 业主、供应商 | approved_phase_scope、written_quotes、approved_work_package_plan | `094f9f5d99cad1658da3a891731bc5e0ad8ffa4d41f6d496df20085b77450561`<br>尚无检查记录 |
| P3-GATE-04 | blocked | 二期对三期涉及空间的影响已完成或冻结 | 二期已完成，或其对墙面、窗帘、灯光、家具和动线的影响范围已有书面冻结基线 | 业主 | phase_2_closeout_or_scope_freeze | `e0a5fee1f1ebe7633cd030a70e292082da245848324c3e64fb2f43a2803d159e`<br>尚无检查记录 |

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
