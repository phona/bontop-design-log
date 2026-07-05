# 和萃 701 室内设计全控项目

> **核心原则**：所有数据本地化、版本化、可审计。AI驱动创意，Python驱动计算与归档，业主只做决策与验收。

## 项目信息

| 项目         | 数据                                |
| ------------ | ----------------------------------- |
| 楼盘         | 和萃                                |
| 预测建筑面积 | **119.38㎡**                        |
| **套内面积** | **94.76㎡（业主确认）**             |
| 层高         | **3.0m**                            |
| 户型         | 四房两厅两卫                        |
| 楼层         | **7楼**                             |
| 建筑类型     | **板楼**                            |
| 单元位置     | **西户（左侧户）**                  |
| 朝向         | 南北通透                            |
| 城市         | 南宁                                |

## 目录结构

```
interior-design-project/
├── README.md
├── config/                    # 结构化配置
│   ├── house.yaml             # 户型基础数据
│   ├── layout/                # 概念方案与定稿布局
│   └── materials.yaml         # 材料规格库
├── survey/                    # 现场量房数据
│   ├── photos/
│   └── videos/
├── cad/                       # 图纸归档
│   ├── original/              # 开发商/物业竣工图
│   ├── survey/                # 量房复核图
│   └── design/                # 设计师深化图纸
├── budget/                    # 预算与支付
│   ├── base.json              # 基线预算
│   ├── payments/              # 付款凭证
│   └── changes/               # 变更记录
├── contracts/                 # 合同归档
│   ├── design_service/
│   ├── construction/
│   └── material/
├── renders/                   # 渲染与漫游
│   ├── blender/
│   └── web/
├── docs/                      # 文档
│   ├── designer_brief.md
│   ├── acceptance_checklist.md
│   ├── material_selection_log.md
│   └── decision_log.md
├── audit/                     # 审计日志
│   ├── audit.log
│   └── git_tags.md
├── scripts/                   # Python工具脚本
└── schedule/                  # 进度计划
```

## 当前状态

- [x] 项目目录初始化完成
- [x] 获取物业合同分户图并识别为结构化数据
- [x] 获取第三方设计图并确定为套内布局底图
- [ ] 获取物业竣工原DWG（承重墙、梁位、水电）
- [ ] 现场量房并录入精确尺寸
- [x] 从概念方案中选定最终布局
- [ ] 设计师深化与施工图
- [ ] 招投标与合同签订
- [ ] 施工与变更审计
- [ ] 竣工验收

## 快速开始

```bash
# 查看户型数据
cat config/house.yaml

# 查看当前预算
cat budget/base.json

# 查看审计日志
cat audit/audit.log

# 查看待决策事项
cat docs/decision_log.md
```

## 核心原则

1. **没有口头变更**：任何改动必须进 Git。
2. **没有合并项报价**：施工方必须逐项报价。
3. **没有无依据决策**：每个选择有数据支撑。
4. **没有黑箱**：设计师、施工队、材料商在统一框架里工作。
5. **没有事后失忆**：任何历史决策可在 30 秒内追溯到源文件。
