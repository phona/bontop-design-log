# 餐厅 S1 + EM450 水吧模型预演

本轮把业主提供尺寸的 S1 与原有唯一一台 EM450 放到餐厅水吧低柜候选台面上；1400G 净水器机身按业主确认放到厨房水槽柜下。冰箱、餐桌、玄关半高柜、吊顶和建筑位置保持原位。

800×420×850mm低柜只是当前视觉代理尺寸，尚未由业主确认。截图使用项目现有 Three.js 场景，未重画或替代户型。

## 当前固定视角（S1形体V5）

- [餐厅人眼总览](evidence/s1-form-v5-overview.png)：显示低柜、两台设备和冰箱关系。
- [水吧设备近景](evidence/s1-form-v5-close.png)：S1局部`+z`对应东侧出水区，局部`-z`对应西侧后置机身；总外廓和台面关系不变。
- [V5运行时坐标/AABB与校验结果](evidence/runtime-query-s1-form-v5.json)：浏览器ready=true、错误横幅为空，AABB仍为312×106×280mm。

## 整体水吧验收

- **美学：PASS（限当前视觉预演）**。整组低柜、S1、EM450与邻接冰箱在总览/近景中比例和色彩关系协调，台面服务组层级可读。
- **功能：BLOCKED**。低柜尺寸与材质仍是候选；柜门扫掠、防倾倒、冰箱动态开门、双机操作维护、电源/墙控和人员站位没有通过核验。
- 当前PASS不能升级为最终柜体或施工验收。审查详情见`review-whole-waterbar-aesthetic-v1.json`、`review-whole-waterbar-functional-v1.json`和总清单。

V1–V4截图、运行时记录和评审均保留作历史对照：[V1总览](evidence/waterbar-overview.png)、[V1近景](evidence/waterbar-close.png)、[V2总览](evidence/s1-form-v2-overview.png)、[V2近景](evidence/s1-form-v2-close.png)、[V3总览](evidence/s1-form-v3-overview.png)、[V3近景](evidence/s1-form-v3-close.png)、[V4总览](evidence/s1-form-v4-overview.png)、[V4近景](evidence/s1-form-v4-close.png)。V4的出水仓/机身仍沿宽度排成两块，业主看后指出像横过来；V5改沿深度轴表达东侧出水和西侧后置水箱。V4细节修正与V1–V4所有历史文件均未删除。

## 本轮状态

静态运行时外廓与用户给定设备尺寸一致；`typecheck`与`gate:visual`通过。最新`verify:all`为16/17，唯一失败是另一份电气决策文档的DEC重号；家具布局/碰撞等几何核验通过。`test:server`当前1008项中998通过、10失败，涉及工作区既有预算/关系/日照/MEP断言、浏览器边界静态词条误判、Node纹理测试缺少`document`等；详见`review-manifest.json`。墙控操作、电源负荷、设备实际补水/维护包络、冰箱动态开门、RO柜内净空及滤芯抽取仍未通过本轮模型验证，故此档案不是施工放行。

评审、范围审计和待核项见 [review-manifest.json](review-manifest.json)。

形体修正记录：[V2](s1-shape-correction-v2.md) · [V3](s1-shape-correction-v3.md) · [V4](s1-shape-correction-v4.md) · [V5](s1-shape-correction-v5.md)
