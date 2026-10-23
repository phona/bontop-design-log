# schedule / 分期施工与审计台账

本目录统一管理分期预算、施工依赖、验收、证据、付款门槛和进度。目录名固定为 `schedule`；不要另建 `schedual`，避免工具和人员引用到两个不同位置。

## 1. 目录结构

| 路径 | 状态 | 用途 |
|---|---|---|
| `roadmap.yaml` | 维护源 | 跨阶段顺序、预算区间和启用条件 |
| `checklist.md` | 自动生成 | 项目总入口：当前阶段、下一工作包、阶段门槛和项目数据版本 |
| `phase-1/control.yaml` | 一期维护源 | 一期预算、施工、验收、证据、状态和付款门槛 |
| `phase-1/budget.md` | 自动生成 | 一期预算计划、合同额、已付、预测和门槛状态 |
| `phase-1/cost.md` | 自动生成 | 一期硬装（含中央空调）成本总表：逐行实际成本、成色与推导，未定价显形、不计入已知小计；只列成本不列预算，映射见 `scripts/schedule/cost-summary.ts` |
| `phase-1/schedule.md` | 自动生成 | 一期工序、工期、依赖和阻塞项 |
| `phase-1/checklist.md` | 自动生成 | 一期现场执行清单：当前工作包、checkpoint、验收证据和项目数据关联 |
| `phase-2/control.yaml` | 规划源 | 二期增强设备和家具，尚未冻结 |
| `phase-2/checklist.md` | 自动生成 | 二期启动门槛和候选项目数据关联；范围冻结后再扩成施工清单 |
| `phase-3/control.yaml` | 规划源 | 三期入住后软装优化，尚未冻结 |
| `phase-3/checklist.md` | 自动生成 | 三期入住观察和启动门槛；范围冻结后再扩成施工清单 |
| `procurement.md` | 采购决策视图 | 按一期采购组汇总首选、备选、未选原因、反转条件、预算和最小证据；二、三期只保留预留边界 |

`config/model-package-links.yaml` 是内部机器关联索引：按现有阶段/工作包粒度引用模型数据来源，不复制预算金额、成本组件说明、商品证据或几何；金额仍以各阶段 `control.yaml` 为准，不作为第二份业主采购矩阵。

验收标准本体仍以 `config/acceptance.yaml` 为唯一来源。各阶段只引用验收ID并记录本阶段的执行结果，不复制维护第二套标准。

## 2. 权威层级

出现冲突时按以下顺序处理：

1. 现场量房、书面审批、签字确认和有效检测记录；
2. 项目专业配置：几何、结构、机电、空调、吊顶和验收配置；
3. 当前阶段的 `control.yaml`；
4. 自动生成的 Markdown 视图；
5. 历史说明、聊天记录和未签字报价。

自动生成的 Markdown 只用于阅读、打印和现场手写，不是维护源，禁止直接编辑后当作项目事实。

## 3. 状态与流转

```text
not_started -> in_progress -> ready_for_inspection -> passed
                         \-> failed -> 整改 -> ready_for_inspection
现场条件不足 -> blocked
确认不适用   -> waived（必须记录批准人和原因）
```

`readiness` 与 `status` 分开：

- `readiness: blocked`：依赖或现场条件不满足，不能开工；
- `readiness: ready`：具备开工条件，但不代表已经施工；
- `status: passed`：只能由验收记录和证据推出，不能凭口头描述填写。
- 验证门禁会检查：工作包标为 `ready` 时，所有依赖包须有当前有效的 `passed` 或有证据的 `waived`，阻塞项须有关闭记录；施工中的包不能同时处于 blocked readiness。
- 全局阻塞项关闭时填写 `status: resolved`、`resolved_by`、`resolved_at` 和 `resolution_evidence`；豁免时填写 `status: waived`、`waived_by`、`waiver_reason` 和 `resolution_evidence`。工作包豁免需在 `waiver.approved_by`、`waiver.reason` 和 `waiver.evidence` 保存批准人、理由和证据。
- 工作包标为 `passed` 时，所有检查必须当前通过、项目数据指纹未过期、依赖和阻塞项仍满足；否则 `verify:schedule` 报错，清单按 blocked/stale 展示。
- 个别检查可声明 `can_run_while_blocked: true`，仅代表交房前可做可逆的设计预演或资料准备；必须同时声明 `does_not_release_construction: true`，不得因此将工作包改为 ready。

二、三期在业主确认范围和预算前保持 `proposed/alignment_required`，不得被AI自动升级为已批准采购。

## 4. 工作包规范

每个工作包至少包含：稳定ID和顺序、预算池、计划/合同/已付/预测金额、依赖和阻塞项、责任角色、验收项、验收方法、通过标准、必需证据、付款门槛及当前状态。

不能直接询价或验收的混合工作包，必须继续拆成 `budget.components`。每个费用项至少写明：稳定费用ID、名称、通俗的包含内容、数量或计价依据、当前金额和状态。金额未知时填写 `null` 并写明等待什么，不能用0元冒充未知；只有明确免费、排除到其他阶段或已包含在另一工作包时才可填写0元，并注明归属。

预算、施工和验收不得拆成互不关联的记录。任何付款必须能反查到工作包、验收项和证据。

## 5. 人工现场使用

1. 打开 `checklist.md` 找到当前阶段与下一工作包，再进入对应阶段清单；一期现场打印 `phase-1/checklist.md`。
2. 按工作包和 checkpoint 逐项检查，不按施工方口头汇总跳项。
3. 在“结果/签名/日期”栏记录现场结论，并同步拍摄要求的证据。
4. 失败项建立整改记录；复验通过前不勾选工作包完成，也不释放对应付款。
5. 将纸面结果和证据路径转录到当前阶段控制源的审计记录。通过记录须保存生成清单中的 `check_spec_sha256` 与 `project_data_sha256`。
6. 运行 `npm run schedule:render` 更新所有阶段视图；再运行 `npm run verify:schedule` 检查视图和审计记录是否仍绑定当前数据。

## 6. AI更新办法

AI必须读取 `roadmap.yaml`、当前阶段 `control.yaml`、`config/acceptance.yaml`、`config/model-package-links.yaml` 和工作包关联的项目数据源；核对工作包ID、验收ID、依赖、阻塞项及证据文件；没有证据时保持 `pending/blocked`；在审计记录中追加结果而不覆盖历史；复验用 `supersedes` 指向旧记录；最后重新生成视图。

审计记录示例：

```yaml
audit_log:
  records:
    - id: AUD-20261018-001
      package_id: PKG-030
      check_id: SCH-030-01
      status: passed
      checked_at: 2026-10-18T15:30:00+08:00
      checked_by: 业主
      evidence:
        - survey/photos/2026-10-18/hvac-pressure-gauge.jpg
        - survey/reports/2026-10-18/hvac-pressure-test.pdf
      check_spec_sha256: "<复制当前 checklist 检查行中的指纹>"
      project_data_sha256: "<复制当前工作包的项目数据指纹>"
      notes: 压力和时长见测试记录
```

复验必须追加新记录：

```yaml
    - id: AUD-20261020-002
      package_id: PKG-030
      check_id: SCH-030-01
      status: passed
      checked_at: 2026-10-20T11:00:00+08:00
      checked_by: 业主
      evidence:
        - survey/reports/2026-10-20/hvac-pressure-retest.pdf
      check_spec_sha256: "<复制复验时 checklist 检查行中的指纹>"
      project_data_sha256: "<复制复验时工作包的项目数据指纹>"
      supersedes: AUD-20261018-001
      notes: 整改后复验
```

## 7. 预算实践

- 阶段上限、已分配额和未分配额必须算术闭合；
- 计划额控制范围，合同额记录承诺，已付额记录现金流，预测额用于判断最终超支；
- 预备金由业主控制，不打包进施工方基础合同；
- 变更必须记录关联工作包、原因、报价、批准人和剩余额度；
- 未分配额不是默认可花预算；
- 二、三期使用预算区间，范围未冻结前不制造虚假精确单价；
- 同一费用只能属于一个工作包，避免重复计取。
- 父工作包的计划额是当前控制额度，不代表内部每项已经获得报价；逐项报价合计后必须与合同额对账；
- `estimated_need_cny` 大于 `planned_cny` 时形成明确的待分配缺口，不能因为总项目还有未分配额度就自动关闭；
- `hard_finish_quote_rounds` 登记业主侧的硬装询价轮次，价格按 quoted_sheet / owner_budget_pool / cap / candidate 分级；除 quoted_sheet 外都不是承诺价，也不得覆盖预算池与父包控制额；
- `config/budget/base.json` 中的20.8万元估算和19万元上限是历史基线；一期签约、付款和超支判断统一使用 `phase-1/control.yaml` 的21万元上限（¥210,000；2026-09-12先压缩至20万元，2026-09-12因业主确认云鲸J6追加¥3,000调整为20.3万元，2026-10-03因业主定标中央空调领航者四代一拖六并按36,000元询价再追加¥3,000调整为20.6万元，2026-10-05因业主定标美的GC5微蒸烤再追加¥4,000调整为21万元；此前24万元同为历史口径）；
- 物业可退押金属于临时现金占用，应与最终装修成本分开记录。

## 8. 施工与验收实践

- 前置工作包未通过，后续工作包不得设为 `ready`；
- 中央空调第一次安装和上部水电隐蔽验收未通过，不得封吊顶；
- 防水闭水验收未通过，不得覆盖进入相应泥瓦工序；
- 定制柜、橱柜和门未复尺、未确认深化图，不得下单；
- `critical` 项未通过或必需证据缺失，工作包不得标记 `passed`；
- 失败项必须整改并复验，保留首次失败记录；
- 付款门槛未通过，不释放对应节点款；
- 照片必须能定位房间、墙面或设备并记录日期，只拍局部且无法定位的照片不能作为完整隐蔽证据。

## 9. 生成与验证

项目配置与清单的联动：

- `config/model-package-links.yaml` 把阶段工作包关联到几何、家具、机电、空调和吊顶等当前项目数据；阶段清单按这些关联生成可点击的数据源。
- 每个生成视图头部有输入数据指纹；`verify:schedule` 比较输入文件和已生成视图。只要项目数据变化而视图未重新生成，就会列出变更文件并报 stale，不会自动覆盖文档。
- 一期通过记录保存检查标准指纹和项目数据指纹。关联数据或验收标准改变后，旧 PASS 会显示 stale，付款门槛回到 pending；复验必须追加新记录。
- 二、三期在仍为 `proposed/alignment_required` 时，清单只指导启动门槛。业主冻结范围后，先为选中的候选补齐工作包、施工顺序、项目数据引用、验收与证据要求，再授权落地。

只修改维护源，然后执行：

```bash
npm run schedule:render
npm run verify:schedule
npm run typecheck
```

`schedule:render` 是唯一写入生成视图的命令；`verify:schedule` 只读检查，不会替换旧视图。全量 `verify:all` 也会检查所有阶段清单是否过期。

验证覆盖预算合计、ID唯一性、依赖、阻塞引用、验收引用、审计归属、通过证据、复验历史和付款门槛。

## 10. 当前阶段边界

- 一期：基础硬装、中央空调、三卧室手动窗帘、成品柜为主的必需家具和必需家电；总上限¥210,000，其中云鲸J6上下水版扫地机器人按业主确认的¥3,000追加进入一期，中央空调于2026-10-03定标美的领航者四代一拖六200外机后再追加¥3,000，2026-10-05业主定标美的GC5微蒸烤一体机再追加¥4,000（内机容量表与连接率尚未闭合）。
- 二期：电视与电视墙、烘干机、洗碗机、净水器、小件家具、窗帘电机和健身设备；当前规划约¥42,100—¥67,200，云鲸J6已移入一期，不在此重复计费。
- 三期：入住后按真实使用补充软装和氛围优化；规划约¥5,000—¥10,000。

具体边界以各阶段 `control.yaml` 为准。跨阶段提前采购时，必须同步更新原阶段和目标阶段，确保预算不重复。

## 11. 采购决策入口

日常采购统一先读 [一期采购决策表](procurement.md)：它按采购组给出当前首选、备选、未选原因、反转条件和放行前核验，不重复施工工作包。预算、状态和验收仍以各阶段 `control.yaml` 为准。
