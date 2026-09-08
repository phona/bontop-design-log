# 统一空间校验（第一版）

入口是 `npm run verify:spatial`，并已纳入 `npm run verify:all`。校验器只读取权威几何和声明：`config/layout/model-geometry.yaml` 提供墙、房间和开口，`config/layout/overlay.yaml` 提供 suppress 与玻璃/栏杆替代意图，`config/house.yaml` 提供 placed 家具，`config/ceiling.yaml` 与 `config/electrical.yaml` 提供吊顶和灯具点位。代码不会从房间名、家具名或截图推断墙体关系。

当前验证结果为当前建模范围的 delivery-ready：`entry_half_height_cabinet` 已从 `(11.50,3.90)` 沿客餐厅侧 `+z` 移至 `(11.50,4.00)`，`tv_wall_low` 已从 `(7.40,8.00)` 沿 `w_st_east` 的 `+x` 移至 `(7.48,8.00)`，保留约 5mm runtime slab 脱离；真实 runtime `plant_fiddle` 因产生 8mm 门禁交叠，按用户授权从 `(7.90,9.18)` 最小联动至 `(7.93,9.18)`。电视/沙发 z 轴、电气和餐厅家具均未移动，`verify:spatial` 为 0 error/10 warnings，`verify:all` 通过。实际墙面完成层/安装误差仍需现场复核，详见 `docs/design-iterations/furniture-wall-clearance-20260908/`。

校验分为五层：墙线拓扑、围护替代、实际渲染包络、家具关系、宿主关系。墙线检查共线重叠、无声明的交叉/T 接头和 near-miss；合法 L/T、线稿短重叠和三处已确认的幕墙端部接头分别写在 `config/spatial-validation.yaml`。每个 suppress 墙必须且只能由一个 `curtain_run`、`glass_infill` 或 `railing_run` 接管；分段 overlay 以 `parts.wallRefs` 为唯一物理引用，顶层 `walls` 摘要不重复计数。结构路径不得覆盖未 suppress 的实体墙，除非有同一文件中的精确 junction 声明。

placed 家具使用 `SceneBuilder`/`FixtureFactory` 生成后的真实三维包络。缺尺寸、缺 recipe、被跳过、出现未注册 runtime 家具或多出 runtime 实例均失败；墙体碰撞先对实际 runtime 墙 mesh 的有限分段/真实厚度调用 `segmentSolidOverlapDepth`，因此注入场景中即使只进入一侧墙厚、尚未越过中心线也会 fail-closed。当前 SceneBuilder 的墙和家具仍共用源墙中心线 datum，CLI 明确标记这种 representation contact policy；真实越过中心线仍是 error，门洞/lintel 不会被整条源墙线误报。玻璃/栏杆的碰撞入口首先使用实际 runtime mesh 包络，再以其对应的 concrete overlay path `id/partId/refIndex` 消除多段曲线 AABB 的假阳性；同 element 的不同结构 path 仍逐 pair 检查，只有 config 中绑定具体 part/path 且几何满足 `continuous`/`butt`/明确 join 的收口才放行。栏杆 handrail/bar 等内部构造件不作为彼此独立 pane，自身连接不误报。实体墙/玻璃穿越是 error。小于默认 5mm 的家具相交只报 contact-tolerance warning，较大的家具×家具交叠是 error。只有 `stacked`、`attached`、`contained` 关系可豁免，而且必须绑定稳定 runtime instance id（`furniture:room:type:index` 或明确 objectId），不能靠类型全局放行。

壁灯必须有实体宿主墙、`wall_side` 和可解析点位；suppressed/curtain 墙、未知墙、开口内、离墙和房间侧向不一致均失败。`validateWallLampMount` 保留朝向数值的纯函数反例，但本轮不对实际灯具 mesh 的法向/旋转做可靠校验，不能把该 helper 测试解释为 runtime 朝向已验证；CLI 当前只检查声明式宿主、房间侧向、开口、suppressed wall、runtime fixture 存在和垂向包络。顶装灯会生成 runtime fixture 并检查 fixture 存在、房间垂向包络和 ceiling zone。当前两盏主卧壁灯的宿主暂在 `lighting_host_overrides` 声明，因为既有电气点位仍是历史平面坐标；量房确认后应把宿主回写正式电气字段并删除 override。

`--json` 输出不含时间戳，issue 按 `code/entity/message` 稳定排序，适合 CI；`--out <path>` 写入同一份结构化报告，缺少路径会以退出码 2 失败。每条 issue 固定包含 `level`、`code`、`entity`、`source`、`message` 和 `evidence`。自动纠正的房间绕向 warning 在 `runtimeWarnings` 中保留，因此 JSON 仍可直接解析。

关键反例和 CLI 集成测试位于 `tests/server/spatial-validation.test.ts`，覆盖非法墙墙交叠、合法 L/T、near-miss、重复 suppress、一对一替代、玻璃共线/非共线重复、同 element 90°实体转角未声明 join、同 path sibling 自碰、玻璃×实体墙、实体墙厚浅层穿入、家具穿墙/穿玻璃/穿吊顶、家具相交、runtime 多余/缺失、未知 placed 类型、灯具 runtime 缺失语义，以及壁灯悬空、反向、侧向错误和挂玻璃。CLI 集成确认真实项目入口在本轮授权坐标下为 0 errors，报告含实际 runtime bounds、稳定 `--out` 内容；电视柜东移与植物联动的范围、旧阻断和最终证据记录在本轮五件套。

已知限制：第一版只验证当前默认 runtime 状态；平开门、衣柜门、可移动训练器械的全部活动状态仍由专项测试/独立迭代记录验证，不会被本 CLI 假装覆盖。实际灯具 mesh 的朝向/法向本轮未覆盖，需后续 runtime 几何证据和独立复核；真实产品外廓、窗帘软包络、设备安装/检修、厂家深化和量房误差仍需现场/厂家数据更新；本轮不扩展 3D UI 面板。
