# 客厅主灯 R4：深钟形外露侧架预演

## 状态

`incomplete`（模型审美/功能复核通过；安装与光度仍为site_pending）。R3同机位截图仍读成浅盘，已保留为失败证据；R4已修正比例和吊杆落点，五视图runtime/snapshot/PNG齐全，独立审美/功能复核均PASS。当前只完成模型造型，不冻结商品、承重、光度或施工尺寸。

## R3失败复盘与本轮改动

R3的Ø900/720mm、深200mm灯体在仰视里仍以大圆盘为主。R3配置的吊杆下端半径约0.38m，而距灯底60mm处的锥壳半径约0.387m；端点因此藏进灯壳。schema还把杆端半径限制在上口以内，和“外置支撑”目标冲突。R3模型、R9截图、runtime与审查没有删除，证据保留在R3迭代目录和 `tmp/screenshots/living-main-light/`。

R4在同一批准范围内修复：总外框1.0×1.0m、总下垂0.35m、灯底y=2.45m和电气锚点不变；乳白灯体从上口Ø900/下口Ø720/深200mm改为上口Ø780/下口Ø520/深280mm。三根暖铜支撑沿体外下行，另加短径向连接脚落到侧壳；暖铜侧弧的跨度由720mm收至480mm，端脚由60mm缩至40mm，弧的南向最远处仍在1m包络内。

### 差异审计

- **移除/替换**：R3的Ø900/720mm、深200mm灯体比例；端点被灯壳遮住的吊杆路径；R3 60mm弧脚。原因是仰视轮廓仍像吸顶盘，运行几何也未实现配置所称的外露支撑。
- **保留**：R1/R2/R3历史决定、截图、runtime、评审、商品候选及价格口径、流明冲突、轨道灯淘汰理由、灯点/电气/吊顶/HVAC/餐桌关系。
- **R4视觉代价**：底部乳白圆面从Ø720缩至Ø520，正投影发光面积减少约48%；加深后的侧向乳白面增加，但不能据此宣称实际配光和照度达标。真实流明、均匀度与眩光待SKU文件核实。
- **静默失效条件**：若吊杆配置再次落入锥形灯体，仰视会再次失去垂吊结构；如果浏览器和GLB绕过共享几何，审图与导出会不一致；真实灯体不透光、驱动器输出不足、承重点/风口不满足等也不会由渲染自动发现。

## 实现范围

- `config/render/lighting.yaml`：声明Ø780/Ø520/280mm灯体、0.35m下垂、外置吊杆端点和缩小弧脚。
- `shared/render/SculpturalDomeGeometry.ts`：吊杆路径保持在壳体外侧，并用短横向连接脚接入侧壳；浏览器和GLB/export共用。
- `shared/project-render-facts-schema.ts`：移除“杆端必须在上口半径内”的错误规则，改为检查锥壳/侧壳净距、灯体上缘处杆体间隙和整体包络。
- 只修改灯具造型；没有改电气点位、回路、双控、家具、客餐厅灯位、吊顶或HVAC路由。

## 验证

| 命令 | 结果 |
|---|---|
| `npm run generate:project-render-facts` | PASS，生成15个灯具事实 |
| `npm run typecheck` | PASS |
| `npm run verify:lighting-config` | PASS，1个详细灯具配置 |
| `npm run verify:all` | PASS，17/17，0 failed；项目warning仍显示（家具2、规则6、渗透9、一致性5、MEP129、电气51、事实93，另有部分计数不可解析） |
| `npm run gate:visual` | CLEAR，ceiling `50c1c81f9ec8`、electrical `f2b49b7bcdb3`、plumbing `7f1513d14f27`、materials `64176f576326` |

没有运行测试套件。生成器、类型、灯具配置、全项目验证与视觉门禁均已在当前代码/配置版本上通过。

## R4同版证据

采用URL `http://localhost:5175/?v=20261016-r10`。正式捕获记录放在 `evidence/r4/`，PNG 放在 `tmp/screenshots/living-main-light/`，包含仰视、侧视、近景、客厅空间和俯视。每张均需ready=true、空配置错误、`visualPreviewActive=false`、目标 `electrical:light_living_dome` 和非总览相机，并核对运行配置值为Ø780/Ø520/280mm。

## 独立复核/遗留

R3的R8审美/功能PASS只对应R8旧几何，不适用于R4。R4同版五视图已由独立审美与功能审查均判PASS，review manifest记录固定JSON原文。模型范围可供业主继续评估；梁/顶板固定、实际灯重、厂家侧架接口、风口气流、维护与真实光度仍是site_pending，不可直接转为商品/施工定案。
