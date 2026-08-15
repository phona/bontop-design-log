# 渲染图导览

只看这两个目录，其他都是过程文件/可删：

## `blender/output/` — 当前方案全屋渲染（23 张，看这里）

命名规则：`<机位>__<工况>.png`。`material_review`=中性光看材质/颜色；`blue_hour`=傍晚氛围光。

- 客厅：`living_sofa_glass`（主机位）、`living_from_entry`（入户望客厅）、`living_from_sw`（西南角回望）、`living_floor_mid`（中距地板）、`living_floor_closeup`（地板特写）、`living_west_wall`（西墙）
- 餐厅：`dining_overview`
- 过道：`corridor_view`
- 主卧：`master_bed`、`bedroom_floor`、`bedroom_west_wall`
- 父母房：`study`；书房：`bedroom_se`；儿童房：`bedroom_nw`
- 厨房：`kitchen_overview`、`kitchen_counter`
- 卫浴：`master_bath`、`guest_bath`
- 阳台：`balcony`；玄关：`entry`

## `floor-compare/` — 地板方案对比留档（8 张）

- `00/07` = 现方案：800×800 木纹砖+近色美缝（已定案）
- `01/04` = 直铺强化板；`02/05` = 直铺橡木大板；`03/06` = 人字拼
- 编号 0x=客厅远景，04-07=6×4.5m 平铺

> 草稿目录 `E:\blender-render\local-test` 已清空；重渲的临时图别再往正式目录拷。
