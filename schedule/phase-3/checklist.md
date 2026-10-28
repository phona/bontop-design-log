<!-- schedule-input-snapshot:{"config/acceptance.yaml":"2073ae223d39584f438e2be0fe231b0719b456b863e0c379c216681089b90e9f","config/electrical.yaml":"b1a016bce0f223712fed137da94c151608a2379b47399abd21384651f2349059","config/house.yaml":"8339729d1ac0f00960930eefdb00d58dcf4c6cac417fea55ad8473f89fbadf44","config/model-package-links.yaml":"443df176174fe6aadc19343894f0de876827d318df2f279cefd565a98ec8b3a8","schedule/phase-1/control.yaml":"67c4a16725a9efe787fc2ea554017d4bc018939594f87c6b8b2b3379b837590a","schedule/phase-2/control.yaml":"2010dab825bedb8e00b7aafc43ba908378fba5422709d94d3812a122a3a5590f","schedule/phase-3/control.yaml":"e784a1e8e5295f1322d8d346abaded152b2308d85de9cd0f8a4355d4fcec943e","schedule/phase-scope.yaml":"4928a254129241b0762e6cda2831be995df30802b979bd2cf8da6eaba66f87a4","schedule/roadmap.yaml":"0a954474b7fd676d98db498973c560aa45fddb2c67fd7364b453e6d4dff9dc45"} -->
# 三期入住后优化推进清单

> 自动生成：请勿直接编辑。维护源：`schedule/phase-3/control.yaml`  
> 视图输入指纹：`sha256:41d92c166f8ba3b83e07eedeb3f0d61697ca76b3abebf1f55967f02e10a6ecf5`（9 个输入文件）  
> Gate记录用项目数据指纹：`sha256:0f8b69040997e6190dc15999c959fa12efa316c5e5c26a8462e894e904357f77`  
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
| P3-030 | 绿植与小型摆件 | 不预分配 | proposed | [config/house.yaml](../../config/house.yaml) — types=plant_fiddle |
| P3-040 | 入住后灯光氛围微调 | 不预分配 | proposed | [config/electrical.yaml](../../config/electrical.yaml) — types=downlight,ceiling_light |

## 入住观察记录要求

每条记录保留：id、observed_at、room、use_scenario、problem、frequency、impact、evidence、temporary_solution、category、owner、status。观察周期由业主在启动时确认并记录，不用固定天数替代真实使用反馈。

## 验收与记录

- 每个启动 Checkpoint 核对后，在阶段控制源的 `audit.records` 追加 `gate_id`、结果、检查人、日期、证据、`gate_spec_sha256` 和 `project_data_sha256`。复验追加记录，不覆盖历史。
- 未定义通过条件、责任角色或证据的 gate 不能标为 passed。
- 项目数据或本阶段范围变化后重新生成清单；旧的通过记录需按当前数据重新核对。
