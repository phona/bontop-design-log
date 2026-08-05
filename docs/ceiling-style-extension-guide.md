# 吊顶造型扩展指南 — 新增 style 渲染分支的标准步骤

> 适用范围：为 `config/ceiling.yaml` 新增吊顶造型种类（如 `cove` 灯槽、双眼皮、弧形顶）。
> 前置阅读：`docs/superpowers/specs/2026-08-05-ceiling-region-design.md`。
> 铁律：新行为 = 新类型 + 声明式配置；代码只读配置、只执行，禁止推断。

---

## 步骤总览

| # | 位置 | 动作 |
|---|------|------|
| 1 | `server/config-loader.ts` | `CeilingZone.type` 联合类型加新值 |
| 2 | `app/src/render/annotations/ProblemDetector.ts`、`AnnotationRenderer.ts` | 同步镜像类型定义 |
| 3 | `config/ceiling.yaml` | 加新造型条目（声明意图） |
| 4 | `app/src/render/HouseScene.ts` | `renderCeilingZones` 加渲染分支 |
| 5 | 碰撞评估 | 新几何是否进 `extractCollisionWalls`（吊顶一律：否） |
| 6 | `scripts/verify-rules.ts` | 新 type 的字段校验（必填字段、取值范围） |
| 7 | 测试与验证 | 见第 7 节命令清单 |

顺序建议：1→2→3→4→5→6→7。类型先行，配置其次，渲染最后——任何时候配置里有未知 type，渲染层应跳过并告警，不得崩溃。

---

## 1. 服务端类型（server/config-loader.ts）

```ts
export interface CeilingZone {
  // ...
  type: 'drop' | 'integrated' | 'cove' | 'none' | 'ac_indoor' | 'aluminum_buckle' | '<new_style>';
  // 如新造型需要新字段，加可选字段，勿改既有字段含义：
  // cove_width?: number; cove_depth?: number;
}
```

新字段一律 optional（`?`），保证旧配置向后兼容。

## 2. 应用侧镜像类型

`ProblemDetector.ts:23` 与 `AnnotationRenderer.ts:28` 各有一份 `CeilingZone` 镜像定义，**三处必须同步**，否则 typecheck 不过或运行时分支遗漏。

> 若嫌三处重复，可在本次顺手收敛到 `shared/types.ts` 单一来源——属可选重构，不做也能完成扩展。

## 3. 配置声明（config/ceiling.yaml）

```yaml
- id: ceiling_living_cove
  room: living_dining
  type: cove
  thickness: 0.28
  area: [7.20, 4.30, 13.40, 9.80]
  cove_width: 0.15        # 新字段示例
  note: "客厅边吊灯槽（暖白灯带）"
```

规则：
- `id` 全局唯一；`room` 必填（无 room 的区域填相邻 room 作分组，渲染只看 `area`）。
- `area` 使用 model-geometry 同一局部坐标系（米），**禁止独立偏移**。
- 新造型 effect 不满意的调整 = 改配置，不动代码。

## 4. 渲染分支（app/src/render/HouseScene.ts）

在 `renderCeilingZones` 的 type 分派中加 case：

```ts
switch (zone.type) {
  case 'drop':
  case 'integrated':   this.buildDropSlab(zone); break;
  case 'aluminum_buckle': this.buildBuckleSlab(zone); break;
  case 'cove':         this.buildCoveCeiling(zone); break;  // 新增
  case 'ac_indoor':
  case 'none':         break;  // 不归本层
  default:
    console.warn(`[ceiling] unknown type skipped: ${zone.type} (${zone.id})`);
}
```

约束：
- mesh 必须 `this.ceilingMeshes.push(mesh)`，继承「仅第一人称可见」模式逻辑（`setCeilingVisible`）。
- `userData = { type: 'ceiling_zone', objectId: zone.id, roomId: zone.room }`，接入拾取与 `objectDisplayName`。
- 发光灯带用 **emissive 材质**（MeshStandardMaterial emissive），**禁止**加真实光源（PointLight/RectAreaLight）——多房间性能开销大，且真实照明属电气系统范畴。
- 防 Z-fighting：与自动平顶/其他吊顶共面时 ±2mm 偏移（沿用既有做法）。

## 5. 碰撞评估（铁律，必须留痕）

吊顶几何在头顶上方，第一人称 pitch 限制 ±80°，相机永不相交 → **不加入** `extractCollisionWalls`（app/src/scene/collision-utils.ts）。在 PR 描述或 commit message 中写明此评估结论。

例外：若新造型向下凸出超过 0.5m（如低位装饰构件），重新评估并在此文档记录结论。

## 6. 校验规则（scripts/verify-rules.ts）

- 新 type 加入合法值列表。
- 新字段加必填/范围校验（如 `cove` 必须带 `cove_width` 且 0.05–0.40m）。
- `area` 在声明 room 包围盒 ±0.5m 容差内的既有规则对新 type 同样生效。

## 7. 验证命令（全跑，缺一不可）

```bash
npm run verify:all
npm run test:app        # renderCeilingZones 新分支的单测：几何位置/材质/ceilingMeshes 注册/未知 type 跳过
npm run test:server     # CeilingZone 类型与校验
npm run typecheck
```

人工验收：第一人称走到对应区域抬头看；切轨道/俯视确认吊顶隐藏、户型图无遮挡。

## 8. 完成定义（DoD）

- [ ] 三处类型定义同步，typecheck 通过
- [ ] 配置条目仅声明意图，坐标与既有权威源同系
- [ ] 渲染分支接入 ceilingMeshes 模式可见性
- [ ] 碰撞评估结论已记录（默认：无碰撞）
- [ ] verify 规则覆盖新 type
- [ ] 四条验证命令全绿
- [ ] 此后该造型的日常调整只改 ceiling.yaml
