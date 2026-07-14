# 项目铁律（AI 会话必读）

## CAD / 3D 渲染架构（2026-07-14 起生效）

> CAD 只出几何，config 出一切意图。代码只读、只执行，禁止推断。

- `scripts/parse_cad.py` 只做几何提取与坐标换算；坐标系锚点只来自
  `config/layout/cad-anchor.yaml` 的显式声明，缺失必须报错（fail loud）。
- 输出的墙体只有 `x1/z1/x2/z2` 纯几何字段。禁止追加分类/意图字段。
- "这段墙是什么"（幕墙/玻璃/补墙…）只在 `config/layout/overlay.yaml` 声明；
  合并逻辑（`server/overlay-merge.ts`）只有 suppress 和 add 两条机械规则。
- **禁止**添加任何基于几何位置、边界、邻接关系的自动分类启发式。
  需要新行为 → 新增 element type（zod schema + 渲染器 case）+ 声明式配置。
- 配置校验失败必须报错并进配置错误横幅；禁止静默跳过、禁止"智能降级"。
- 守卫测试位于 `scripts/parse_cad_test.py`（字段白名单、禁用标识扫描）与
  `tests/server/overlay-merge.test.ts`（不声明永远是 wall）。删除或绕过
  守卫测试视同违反铁律。

设计文档：`docs/superpowers/specs/2026-07-14-dxf-overlay-rendering-design.md`
