# 客卫开放洗漱区地面分区

## Alignment

- 用户确认：开放洗漱区用客餐厅当前木纹砖，内卫继续小花砖，并明确要求落地。
- 迭代编号：`guest-bath-open-vanity-floor-split-20261018`。
- 决策编号：`DEC-2026-10-18-TILE-02`。
- 当前状态：blocked；地面实现与专项验证已完成，仓库全量门禁和现场施工界面复核仍未通过；事实基线、用户范围和接受条件保持冻结。

## Baseline

- `guest_bath` 当前resolved footprint为3.15㎡；南侧开放洗漱区x[5.60,7.10]、z[3.55,4.30]为1.125㎡，内卫余区为2.025㎡。
- 当前正式方案为默认KT 200×1200木纹砖，整个guest_bath覆盖为复古小花砖。
- 开工前 `npm run gate:visual` 为CLEAR；浏览器业务ready为true、错误横幅为空，固定南侧斜俯视证据位于`evidence/baseline.png`。

## Implementation plan

1. 在overlay声明内部材料区，host room=guest_bath、follow=living_dining。
2. 扩展共享瓦工takeoff，对room+follow内部floor_region先验证包含与面积守恒，再把量从宿主房间材质/湿区桶转入follow材质/干区桶。
3. 预算材料行与tile comparison都读取同一takeoff输出；不为面积或费率新增第二个手工来源。
4. 保留room override的小花砖，保留历史 DEC-042 原文；新增DEC明确它的“整间客卫小花砖”范围结论被本次推翻。
5. 同步采购入口、待现场数据和验证证据；不编辑generated render facts。

## Removed / superseded content diff

- `docs/decisions/14-style-furniture.md`中DEC-042的“客卫全3.1㎡小花砖”作为历史保留；新DEC仅推翻其整房范围，不删除其小花砖风格意图。
- `schedule/procurement.md`原“客卫小花砖约3㎡”将替换为内卫2.025㎡小花砖+开放洗漱区1.125㎡木纹砖。删除该旧范围是因为开放台盆已在内卫门外，继续把整间语义房3.15㎡算作花砖会与已确认的开放洗漱区木纹砖决定冲突。
- `config/tile-comparison.yaml`原guest_bath整房3.15㎡ wet baseline不再适用于当前面层分区；原始KT报价单数量与报价范围保留，重新标明现方案口径下不可直接据整房面积对照。
- 完整服务端测试发现`tests/server/masonry-quotes.test.ts`仍把干/湿区量和瓦工人工锚定在分区前数值。本轮将该既有断言更新为干区116.739㎡、湿区6.601㎡和人工¥10,591，并将该测试纳入本轮允许范围；没有删除历史量值，基准语义改为记录在DEC前的房间面积。

### Substantive review

- **删了什么**：现行采购范围中的“客卫小花砖约3㎡”整房表述被替换为内卫2.025㎡小花砖+开放洗漱区1.125㎡木纹砖；门店原始报价、SKU候选、旧DEC和历史量值均保留。
- **推翻了什么**：`DEC-2026-08-21-042`的客卫整房小花砖范围被`DEC-2026-10-18-TILE-02`推翻；内卫小花砖风格意图与房间基底override仍保留。
- **静默失效条件**：若follow选材无法解析，渲染会回退默认地材；若只更新渲染而未同步takeoff/budget，会把开放区计回整间客卫；若材质复制丢失polygonOffset会出现闪面；现场边界和溅水条件变化时需重审分区。

## Validation record

最终复核结果（2026-10-18）：

- `npm run typecheck`：PASS。
- 地面专项 server 测试（masonry-takeoff、masonry-quotes、budget-calculator、tile-cost-comparison、tile-comparison-api、overlay-merge）：PASS；`TextureManager.test.ts`：9/9 PASS。
- `npm run schedule:render`、`npm run verify:schedule`：PASS，预算文件由control源重新生成。
- `npm run gate:visual`：CLEAR。
- `npm run verify:all`：16/17通过，唯一失败为当前workspace的`verify-mep`。
- `npm run test:server`：946/966通过；20项失败。`config/mep-hvac-coordination.yaml`第163行缩进错误导致3个`/api/project`测试无法加载MEP authority，并伴有MEP/facts/registry、共享渲染边界和Node测试DOM桩等范围外失败；本轮地面专项测试全通过。
- `npm run test:app`：513/561通过；48项HouseScene测试因测试环境缺少`ResizeObserver`失败，App套件导入因Three.js测试桩缺少`Color.setRGB`失败；本轮TextureManager专项9项全通过。
- 浏览器同机位after证据：`window.__APP__.isReady() === true`、配置错误横幅为空；客卫基础地面为小花砖，新增区域跟随客餐厅木纹砖，世界边界为x[5.60,7.10]、z[3.55,4.30]，polygonOffset保留；见`evidence/after-runtime.json`、`after.snapshot.txt`、`after.png`。
- 独立审美review：PASS；客卫地面范围功能review：PASS。施工界面review：BLOCKED，须现场复尺并核验门口、防水和溅水区材料条件。全量验证与施工界面要求未完成前，整体状态保持blocked。

### Retrospective trigger

`verify:all`重复在`verify-mep`失败，完整`test:server`重复出现当前MEP配置解析失败，按重复验证失败触发复盘。已核查堆栈：`config/model-package-links.yaml`读取`config/mep-hvac-coordination.yaml`时在第163行缩进失败；本轮没有修改该范围外的MEP文件，也没有改变地面面积或材质基准。地面专项测试和浏览器证据保持有效；MEP文件修复后需要重跑全量验证，因此本轮不重基准，overall状态仍为blocked。

## Site follow-up

交房复尺时核实门洞线、开放洗漱区完成面范围、台盆溅水情况、防水与收边；向供应商核验具体SKU和湿态防滑资料，施工方书面确认人工计价。
