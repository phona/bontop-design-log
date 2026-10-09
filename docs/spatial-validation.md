# 统一空间校验（声明 · 拓扑 · 权威性）

入口是 `npm run verify:spatial`，并已纳入 `npm run verify:all`。校验器只读取权威几何和声明：`config/layout/model-geometry.yaml` 提供墙、房间和开口，`config/layout/overlay.yaml` 提供 suppress 与玻璃/栏杆替代意图，`config/house.yaml` 提供 placed 家具，`config/ceiling.yaml` 与 `config/electrical.yaml` 提供吊顶和灯具点位。代码不会从房间名、家具名或截图推断墙体关系。

**与防穿模 linter 的分工**：本 CLI 判「这个场景说得通吗」——声明是否自洽、拓扑是否连续、运行时是否建了配置里声明的东西、设备装的位置对不对；「两块实体是否占了同一块空间」由 `npm run verify:penetration` 负责，见 [`docs/penetration-lint.md`](./penetration-lint.md)。两者共用 `shared/penetration/scene.ts` 的场景采集，但互不重复判同一件事；`tests/server/penetration-boundary.test.ts` 一票否定：本 CLI 的报告不得含任何穿透族 code。

当前验证结果（2026-10-09，`df61fc5` + 起夜灯 `wallSide` 修复后）：`verify:spatial` 为 **0 error / 0 warning**，`verify:penetration` 为 0 error / 8 warning（玻璃净距不足）。此前文档记录的「0 error/10 warnings」是穿透规则还留在本 CLI 时的旧口径，已按实测改写。实际墙面完成层/安装误差仍需现场复核，详见 `docs/design-iterations/furniture-wall-clearance-20260908/`。

校验分为四层：墙线拓扑、围护替代、运行时权威性、宿主关系。墙线检查共线重叠、无声明的交叉/T 接头和 near-miss；合法 L/T、线稿短重叠和三处已确认的幕墙端部接头分别写在 `config/spatial-validation.yaml`。每个 suppress 墙必须且只能由一个 `curtain_run`、`glass_infill` 或 `railing_run` 接管；分段 overlay 以 `parts.wallRefs` 为唯一物理引用，顶层 `walls` 摘要不重复计数。结构路径不得覆盖未 suppress 的实体墙，除非有同一文件中的精确 junction 声明。

运行时权威性：每个 placed 家具与结构玻璃/栏杆元素都必须在 `SceneBuilder` 产出的 runtime 里有一条对应记录，多出或缺失即失败（`furniture_runtime_missing` / `furniture_runtime_unknown` / `glass_runtime_missing` / `glass_runtime_unknown`）；被跳过、缺尺寸、缺 recipe、无真实子 mesh 同样失败。`relationships` 只在此层做**声明体检**（必须绑定稳定 runtime instance id、不得按类型全局放行、引用必须存在），豁免的**执行**在穿透层。

宿主关系：壁灯必须有实体宿主墙、`wall_side` 和可解析点位；suppressed/curtain 墙、未知墙、开口内、离墙和房间侧向不一致均失败。`validateWallLampMount` 保留朝向数值的**纯函数反例**，但本轮不对实际灯具 mesh 的法向/旋转做可靠校验，不能把该 helper 测试解释为 runtime 朝向已验证；CLI 当前只检查声明式宿主、房间侧向、开口、suppressed wall、runtime fixture 存在和垂向包络。顶装灯会生成 runtime fixture 并检查 fixture 存在、房间垂向包络和 ceiling zone。起夜灯的 `wall`/`wall_side` 必须随点位一起进 runtime（2026-10-09 修复：漏传会让 `FixtureFactory` 抛错、整场 `buildScene` 失败）。当前两盏主卧壁灯的宿主暂在 `lighting_host_overrides` 声明，因为既有电气点位仍是历史平面坐标；量房确认后应把宿主回写正式电气字段并删除 override。

`--json` 输出不含时间戳，issue 按 `code/entity/message` 稳定排序，适合 CI；`--out <path>` 写入同一份结构化报告，缺少路径会以退出码 2 失败。每条 issue 固定包含 `level`、`code`、`entity`、`source`、`message` 和 `evidence`。自动纠正的房间绕向 warning 在 `runtimeWarnings` 中保留，因此 JSON 仍可直接解析。

关键反例和 CLI 集成测试位于 `tests/server/spatial-validation.test.ts`，覆盖非法墙墙交叠、合法 L/T、near-miss、重复 suppress、一对一替代、玻璃共线/非共线重复、runtime 多余/缺失、未知 placed 类型、灯具 runtime 缺失语义，以及壁灯悬空、反向、侧向错误和挂玻璃。CLI 集成确认真实项目入口为 0 errors、报告含实际 runtime bounds、稳定 `--out` 内容。

已知限制：第一版只验证当前默认 runtime 状态；平开门、衣柜门、可移动训练器械的全部活动状态由穿透层的活动包络议题跟踪（见 `docs/penetration-lint.md` 已知限制），不会被本 CLI 假装覆盖。实际灯具 mesh 的朝向/法向本轮未覆盖，需后续 runtime 几何证据和独立复核；真实产品外廓、窗帘软包络、设备安装/检修、厂家深化和量房误差仍需现场/厂家数据更新；本轮不扩展 3D UI 面板。
