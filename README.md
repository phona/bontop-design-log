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
│   ├── materials.yaml         # 材料规格库
│   ├── design-rules.yaml      # 设计规则
│   └── budget/                # 预算基线
│       └── base.json          # 基线预算
├── budget/                    # 预算变更与支付
│   ├── payments/              # 付款凭证
│   └── changes/               # 变更记录
├── survey/                    # 现场量房数据
│   ├── photos/
│   └── videos/
├── cad/                       # 图纸归档
│   ├── original/              # 开发商/物业竣工图
│   ├── survey/                # 量房复核图
│   └── design/                # 设计师深化图纸
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
- [x] 建立 CAD 驱动户型提取流程（`scripts/cad/parse_cad.py`），解析中文房间标签（`SH-文字标注`），3D 交互采用对象优先模型。
- [ ] 设计师深化与施工图
- [ ] 招投标与合同签订
- [ ] 施工与变更审计
- [ ] 竣工验收

## 快速开始

```bash
# 查看户型数据
cat config/house.yaml

# 从 CAD 设计图提取户型布局
python -m pip install -r scripts/requirements.txt
python scripts/cad/parse_cad.py

# 查看提取后的结构化布局
cat config/layout/model-geometry.yaml

# 查看当前预算
cat config/budget/base.json

# 查看审计日志
cat audit/audit.log

# 查看待决策事项
cat docs/decision_log.md
```

### 日照模拟

点击右下角“日照”按钮打开面板：日期/时刻滑杆实时驱动太阳位置与光影（真实天文算法，南宁经纬度），季节预设（冬至/夏至/春分/秋分）、延时播放、俯视日照时长热力图（冬至默认）。分析数据：`GET /api/analysis/sunlight?date=MM-DD`，MCP 工具 `get_sunlight_analysis`。配置见 `config/environment.yaml`。

### 湿度风险评估

点击“湿度”按钮：各房间按结露/发霉风险等级着色（绿低/黄中/红高），高风险重点表面（回南天地面、朝北外墙、热桥角部）以脉冲标记显示，点击房间查看因子拆解。回南天窗口（02-15~04-15）内冷表面因子自动生效，日照面板会显示提示条。分析数据：`GET /api/analysis/humidity?date=MM-DD`，MCP 工具 `get_humidity_risks`。湿度因子声明见 `config/environment.yaml` 的 `humidity:` 段。

## 核心原则

1. **没有口头变更**：任何改动必须进 Git。
2. **没有合并项报价**：施工方必须逐项报价。
3. **没有无依据决策**：每个选择有数据支撑。
4. **没有黑箱**：设计师、施工队、材料商在统一框架里工作。
5. **没有事后失忆**：任何历史决策可在 30 秒内追溯到源文件。
