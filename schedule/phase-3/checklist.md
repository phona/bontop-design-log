<!-- schedule-input-snapshot:{"config/acceptance.yaml":"ff38698cff4e22709aa0219214d71334d4176cbba94eb57d1dab134f5ba2ac77","config/decision-gates.yaml":"adb9605d279d6e3ea60ce70f77f6a0e441e5dbe66e0f43ab8abf18955d194036","config/electrical.yaml":"358b37a59a25457c7a638e436d0a1d61bfcf873b9988a40ee9e83c0121e12844","config/house.yaml":"a1f73bb2611e35a6a6dcdb76a0dcda62e438bf76289987bfaaddecff50d69aad","config/model-package-links.yaml":"e1633c40f09133d7cf37ebd89f94b6dc08701dc5bf1f2a12ebef3001ed77ba0e","schedule/phase-1/control.yaml":"a74a93e2d9b9d7a64b6d6194d5e53eccad6869faa2afba76394b3b0f4db5e7ff","schedule/phase-2/control.yaml":"db17332e72cc1859d4e70ba2479e552240ca173875a47fa6ed089cc5e5f29915","schedule/phase-3/control.yaml":"e784a1e8e5295f1322d8d346abaded152b2308d85de9cd0f8a4355d4fcec943e","schedule/phase-scope.yaml":"b6d5bec0a317cfdd67e6db7c839bdaea23035cebaa5dde1442d920d2aaac481d","schedule/roadmap.yaml":"a3b9e2b41bcaa8c3c9f049ab6b905fb4d56b957f9c7c880e77ba84ec0ddbafd9"} -->
# 三期入住后优化推进清单

> 自动生成：请勿直接编辑。维护源：`schedule/phase-3/control.yaml`  
> 视图输入指纹：`sha256:df0a9e797f6fdfaca8c899b19eb7ce88093a41d60c3a1e2826f3986916b315ff`（10 个输入文件）  
> Gate记录用项目数据指纹：`sha256:d34c92bcc6b9091744fc502a1655c098605aa13472a96d3e700f000c09557a43`  
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
