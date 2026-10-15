# 连续带 1.25m 预演记录

## 范围与对齐

- 业主要求客厅空调边吊与主走廊同为1.25m深、同饰面连续呈现。
- 业主确认南侧送风及装饰百叶移至新边界外侧z=5.56。
- 业主确认将light_corridor_1从客厅设备带移至主走廊中段(5.70,4.90)，并同步调整线路。
- 业主澄清冰箱消息误发；冰箱、半高柜与柜体结构排除。
- 本轮是三维视觉与机电协调预演，不是施工定稿。
- `main_corridor` 使用 `semantic_only: true`：参与灯位归属、边界校验和墙面邻接，不生成默认房间地/顶面，也不进入房间级瓦工算量；显式 `main_corridor_floor` 与 `ceiling_main_corridor` 仍是其地面/吊顶唯一表面来源。

## 几何与数量

- 主走廊：x[4.20,7.20]、z[4.30,5.55]，吊底约2.50m。
- 客厅设备带基线：x[7.20,13.40]、z[4.30,5.20]，吊底约2.50m；当前范围扩至z=5.55并归属 `living_dining`。
- 官方takeoff按圆角复算，净面积由5.5714㎡升至7.7457㎡，客厅区净增2.1743㎡；全屋石膏板净面积25.4055㎡、全屋吊顶净面积47.3140㎡、展开面积79.6525㎡。
- 两台内机、底面下出风z=4.85、回风/检修z=4.45保持；南侧百叶由z=5.21移至z=5.56。
- 客厅南地插A保留原插座坐标；分叉从干线 (11.0,5.55,2.70) 向边界外跨至z=5.56后再下引，低位段不落入新增吊顶投影。

## 变更审计

本轮创建独立iteration目录，没有压缩既有设计文档。实施覆盖业主确认的客厅带南边界、共边圆角、南侧百叶、走廊筒灯与线路，并调整客厅南地插A的吊顶外分叉点，插座本身不动。2026-10-08旧算量保留为历史快照；当前面积按唯一takeoff复算，旧快照23.222㎡与原几何现算23.2312㎡相差0.0092㎡，差异来源保留。

实施审计曾将授权范围误读为只含点位语义区，因而在一版工作区状态中临时移除了 `house.rooms.main_corridor.wall_finish: paint` 和四条涂装声明。业主随后明确选择墙面与顶面独立选择，并确认当前三段走廊墙面声明 `paint_main_corridor_w_strip_east`、`paint_main_corridor_w_st_north`、`paint_main_corridor_w_nw_south` 与 `paint_ceiling_main_corridor` 顶面声明保留。此前的临时删除口径已被新决定覆盖；本轮不改这四条声明，只解除墙/顶选择集合耦合并修正预算侧纯顶面路径。

## 实施与证据

状态：模型与配置预演已实施；当前源版本 `verify:all` 17/17 PASS、`typecheck` PASS、`gate:visual` CLEAR。墙/顶/预算专项测试分别为 `paint-scope` 27/27、`paint-comparison-api` 5/5、`budget-calculator` 47/47、`finish-scope` 26/26。完整 `test:server` 为1005/1008，余3项与本轮范围无关：`solar.test` 的夜间 ambient 期望差异1项，以及 TextureManager 测试 Node `document is not defined` 2项。

## 前一源版本的几何审查记录

- 前一源版本的独立审美复核：PASS。1.25m连续带、x=7.20共边、南侧三层风口线及东端NE/SE两处R100均通过；共边仍记录轻微拼缝风险。
- 前一源版本的独立功能/工程复核：PASS（仅限预演配置与协调）。semantic-only走廊不生成重复地/顶面、不进入重复房间级瓦工算量；灯位、百叶和关联路线均与新边界一致。
- 东端补拍 `east-end-R100-northeast-close.png` 与 `east-end-R100-southeast-close.png`，均为真实浏览器同版本截图，APP ready、错误横幅为空、相机非总览。为消除房间墙面遮挡，仅在浏览器画面层显示 `ceiling:ceiling_living` 几何，未改配置或场景源。每图有对应 runtime 查询与 snapshot 摘要。
- 初拍 `east-end-R100-southeast-obscured.png`、`east-end-R100-south-under-wall-obscured.png` 因近墙/背景表面遮挡而无法判读，移入 `evidence/diagnostic/` 保留作失败取证；原 `east-end-corner.png` 也仅作旧角度诊断，不再作为R100验收证据。
- 上述审查和截图在墙/顶选择对齐前完成，保留为前一源版本的历史记录；当前主走廊涂装声明已由业主确认保留，最新版本另有同源截图、runtime与snapshot，见 review manifest `evidence` 中 `*-independent-paint` 项。
- 仍属施工前置核验：实际内机、梁底、风管/冷媒/冷凝水/桥架/龙骨净空；z=5.56南送风百叶风量与有效面积；走廊筒灯开孔加强、散热和检修。此次交付是模型预演，不是施工放线或机电下单确认。

## 涂装架构对齐已完成

- 业主已明确墙面与顶面可以独立选择；当前主走廊三段墙面声明和一条3.75㎡顶面声明保留。`paint_region` 选墙面，`paint_ceiling_region` 选整间顶面；缺少顶面声明表示该房间顶面未选。
- 被废止的旧约束有两条：要求 `paint_ceiling_region` 房间集合等于 `paint_region` 房间集合；finish-scope F05 从“墙面涂漆”推断“必须有顶面涂漆”。墙面与 `wall_finish` 的墙域一致性、顶面几何附着、铝扣板边界与重复选择检查继续保留。
- 专项审计另发现预算层在没有墙面声明时提前返回，且预算房间集合漏收 ceiling-only 房间。已修为并集墙/顶/普通窗台房间集合，并增加预算 ceiling-only 回归用例。
- 当前涂装面积：墙毛188.375㎡、门洞扣除20.340㎡、净墙168.035㎡；顶106.974㎡；窗台37.198㎡；合计净涂装312.207㎡，其中普通漆计费308.652㎡。与上一版不含主走廊涂面的快照相比，当前明确保留的主走廊范围增加墙净10.150㎡与顶面3.750㎡；架构解耦本身不改变这些显式选择的数值。
- 当前 digest `ced6069745398d7b298c611060577b4938b6800c47d2476403ed90355bf3470a` 已补拍走廊入口、客厅南侧HVAC面、x=7.20交界、连续带俯斜角及NE/SE两处R100；6组均绑定APP ready、错误横幅为空的同源runtime与snapshot。当前源版本的独立审美与功能复核均PASS。

## 当前源版本独立复核

- **审美 PASS**：同宽同标高连续，x=7.20只有极细分区线、未形成错台；南侧三层线比例成立；NE/SE R100曲线完整连续。非阻断备注：HVAC临时几何标记降低画面纯度，但不改变连续性判断；白色是饰面意图代理，色样和现场收边仍需确认。
- **功能/工程 PASS**：`paint_region` 与 `paint_ceiling_region` 独立选择、面积进入budget roomIds；ceiling-only预算回归已通过。主走廊 semantic_only、筒灯坐标和回路归属、1.25m吊顶、z=5.56南侧百叶、z=4.85下出风、z=4.45回风/检修与路线保持一致。顶面目前按整间footprint选择；wall_finish仍是房间级墙面意图，不证明每一面实体墙脸都已覆盖，需逐面复核。
- **验证结果**：`verify:all` 17/17、`typecheck` PASS、`gate:visual` CLEAR；四组受影响专项测试全通过。完整 `test:server` 为1005/1008，余1项 `solar.test` 夜间ambient期望差异、2项 `TextureManager` Node `document is not defined`；它们在本轮改动范围之外，因此项目iteration保持 `incomplete`，不标记 `delivery_ready`。
- **施工前 site_pending**：实际内机/检修尺寸、梁底和综合管线净空；z=5.56送风性能；筒灯开孔加强与检修。模型预演不构成施工定稿。
