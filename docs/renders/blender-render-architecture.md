# Blender 渲染架构与边界

本文描述当前项目中 Web/CLI 建模、Blender 定妆渲染和渲染产物追溯之间的实际边界。本文只记录已经存在于代码和脚本中的能力；不把远程 workflow 修复、云端自动化或视觉验收结果当作已完成能力。

## 1. 总体原则

项目采用“Web/CLI 定稿，Blender 预览和渲染后处理”的分层：

```text
config/layout/model-geometry.yaml + overlay.yaml
        ↓
shared/SceneBuilder 等共享构建器
        ↓
CLI GLB / Web 手动导出的 GLB（正式建筑与正式布局）
        ↓
Blender dress_scene.py
  材质、灯光、环境、有限的家具资产替换、render-only staging
        ↓
PNG + .meta.json
```

- `config/layout/model-geometry.yaml` 是户型几何的唯一权威源；`overlay.yaml` 描述覆盖层意图。
- Web/CLI 共享构建器导出的 GLB 是正式建筑几何、正式家具/设备布局、正式吊顶基础几何、正式灯具外形和窗帘 active-only 快照的来源。
- Blender 读取 GLB 和生成的 render config/facts，进行材质、贴图、灯光、天空/HDRI、相机和渲染预览后处理。
- Blender 不回写 Web/CLI 源文件，也不把渲染预览中的候选模型自动升级为正式设计。
- Blender 中出现的 `render-only` 对象必须有显式标记；不能因为它是“真实资产”就把它误认为正式几何。
- 多角度决策板是互补证据集合，不是把不同相机拼成一张虚假的物理全景；索引见 `data/render-decision-boards.json`。

## 1.1 多角度决策板与并行渲染

单一相机受真实墙体、门洞、家具和隔断遮挡时，使用多角度决策板覆盖不同问题：

- `entrance_context`：入口印象、空间氛围和主要体量；
- `fixture_relationship`：家具、洁具、设备和固定构件之间的关系；
- `material_detail`：材质、纹理、五金、窗帘或节点特写；
- `auxiliary_view`：高位、俯视或其他辅助关系图；
- `failed_auxiliary`：明确记录未达到决策门槛的视角，不得当作正式证据。

每个视图必须记录 `room`、`camera`、`scenario`、`bundle`、PNG 路径、尺寸、SHA-256、用途和 `truth`（`physical_camera` 或 `auxiliary_view`）。决策板必须显式标记 `notASinglePhysicalView`，禁止无标签地拼接不同视点、灯光或透视结果。

房间之间可以并行渲染：每个房间使用独立 bundle、远程输出目录和日志；共享源代码、共享配置和 bundle 构建仍由主控串行修改与冻结。只有在各自 PNG 已下载并通过 `ReadMediaFile` 审查后，才能把视图加入决策板或升格为正式证据。

## 2. Web/CLI 定稿几何与 Blender 预览替换边界

### 2.1 正式来源

正式来源包括：

- 建筑墙、地面、房间、门窗、玻璃幕墙、飘窗等建筑几何；
- Web/CLI 导出的正式家具实例、设备、卫浴、厨房柜体和台面；
- 正式灯具外形；
- 基础吊顶几何；
- `overlay.yaml` 声明的窗帘安装，以及 `data/presentation-state.json` 投影出的 active-only 窗帘节点。

`build-render-bundle.ts` 会先运行 `generate:render-config` 和 `verify:project-render-facts`，再接受手动 Web GLB 或调用 CLI shared builder 导出 GLB。bundle 内的 `house.glb` 是输入 GLB 的副本，不是 Blender 重建出来的建筑模型。

### 2.2 Blender 可以做的事

Blender 可以：

- 按 `config/materials.yaml` 的 appearance/render role 应用程序化材质和 PBR 通道；
- 加载 `assets/textures`、BlenderKit/外部家具资产和 HDRI；
- 在**现有正式家具实例的锚点**上，用真实家具资产替换白名单内的家具类型；
- 添加明确标记为 `render-only` 的家具候选、软装、挂画、地毯、茶几、书架、吊顶完成度 staging 或 HVAC coordination/reference view-only；
- 为已有窗帘节点按 GLB 的 layer/variant 赋材质，并按 scenario 控制 `bare_shell` 等渲染可见性；
- 为每个相机×场景 job 设置灯光、HDRI、玻璃参数、曝光、色彩管理和输出路径。

家具替换的关键条件是：替换件必须跟随一个当前 GLB 中已存在的正式家具实例锚点，并使用完整的 formal instance key，而不是只按家具类型查找。`blender_assets.py` 的导入流程会保留模型原始姿态，再通过四元数复合摆位 yaw；失败时保留原来的正式/程序化 fallback。

### 2.3 Blender 禁止做的事

Blender 禁止：

- 修改 Web/CLI 建筑几何、房间边界、墙体拓扑、门窗位置或玻璃幕墙位置；
- 修改正式布局坐标、旋转、数量、预算 counts 或 `house.yaml`/共享 facts；
- 通过 Blender 新建正式厨房、正式卫浴、正式灯具外形、正式基础吊顶或正式家具，绕过 shared/CLI GLB；
- 把 render-only 候选写回 Web/CLI、`house.yaml`、`model-geometry.yaml`、`overlay.yaml`、预算或碰撞数据；
- 把家具候选挂到玻璃幕墙、被 suppress 的墙或门洞上；
- 根据渲染画面“猜”建筑位置，再反向修正式几何。

玻璃幕墙不能挂载电视、插座、挂件或柜体。墙面/挂墙 staging 必须基于 GLB 中可靠的实体墙锚点；没有实体墙证据时应跳过候选，而不是移动建筑或强行吸附。

## 3. 四类对象生命周期

### 3.1 formal source（正式源）

formal source 是来自 Web/CLI GLB 的正式对象，代表交付设计中的建筑或正式布局。它的几何和实例身份由上游决定。Blender 可以为它换材质，也可以在允许的替换流程中暂时隐藏它，但不能改写其正式源数据。

### 3.2 replacement（渲染替换件）

replacement 是 Blender 导入的真实资产，用来替代某个 formal source 的渲染外观。它必须：

1. 对应一个现有正式家具实例；
2. 使用完整 formal instance key（房间、类型、索引），不能只用 `sofa_3seat` 这类类型名；
3. 复制正式锚点的世界位置和朝向，必要时按资产自身 bbox 做等比缩放；
4. 设置 `dress_replacement_source`/`replacement_source` 等审计属性；
5. 在替换失败时让正式/程序化 fallback 保持可见。

同一个 formal instance key 下，最多应有一个可见 formal source 或 replacement source。`audit_scene_assets.py` 会按实例 key 聚合源，并把多个可见 formal/replacement source 报为冲突。render-only source 不计入这个正式替换冲突，但仍需审计和追溯。

### 3.3 render-only（仅渲染预览）

render-only 是只用于 Blender 画面评估的候选或装饰。常见标记包括：

- `render_only`/`renderOnly`；
- `geometrySource: blender_staging`；
- `formalWebGeometry: false`；
- 相关的 `assetSource`、`assetProvider`、候选 metadata。

`blender_render_only.py` 中的候选位置通常来自当前正式家具锚点、命名 plumbing bbox 或可靠实体墙 bbox；但 `add_soft_decor` 仍有部分固定评审坐标，不能将其全部表述为锚点/声明式位置驱动。缺失模型、导入失败、占用玻璃/门洞时保留 fallback 或直接跳过。render-only 绝不改变正式布局、预算和碰撞，也不应被当作 Web 交付内容。

### 3.4 legacy（遗留实现）

legacy 是历史上用于补建或增强几何的代码/材质路径，保留的目的主要是兼容、迁移参考或旧 fixture 处理。当前规则是：

- legacy 不能旁路重建正式建筑、厨房、卫浴、灯具、正式家具或基础吊顶；
- `dress_scene.py` 中的兼容别名和旧 helper 不代表它们仍是正式来源；
- 正式 GLB 的 role 材质来自 `materials.yaml`，不能被 legacy 固定材质表覆盖；固定材质表最多用于 render-only soft decor；
- 修改 legacy 前先确认是否会影响正式对象、动态对象重置或审计分类。

生命周期上的顺序应理解为：formal source 先存在；允许的 replacement 在 Blender 中覆盖其渲染表现；render-only 只作为独立预览层；legacy 不能越过这些边界成为新的正式来源。

## 4. 当前 Blender 模块

当前渲染入口和拆分模块如下。当前只完成局部模块抽取；`dress_scene.py` 仍是主编排入口，并未全部拆分完成。脚本目录的职责分层如下：`scripts/render/glb/` 保存 CLI GLB 导出、检查和比较工具，`scripts/render/bundle/` 保存 bundle 构建与 manifest 工具，`scripts/verify/` 按 layout、placement、data、rules、collision、render 分组保存校验入口，`scripts/render/capture/` 和 `scripts/render/diagrams/` 保存截图与图表工具；这些分层不改变 Blender runtime 或 bundle 资源路径：

- `scripts/blender/dress_scene.py`：Blender 主入口；读取 GLB/config，初始化场景，编排材质、资产、灯光、环境、job 状态和 PNG 输出。
- `scripts/blender/blender_assets.py`：正式家具资产导入、等比缩放、姿态/四元数复合、正式实例 replacement、资产审计属性和部分电视墙 staging。
- `scripts/blender/blender_render_only.py`：BlenderKit 候选、软装、挂画、地毯、茶几、书架、房间缺项等 render-only staging；失败保留 fallback。
- `scripts/blender/blender_lighting.py`：灯具光源、track light、window portal、Sun、job 灯光状态和灯光审计。
- `scripts/blender/blender_environment.py`：World、Cycles HDRI、天空 fallback 和玻璃外景 sky plane。sky fallback 以 `sky_plane:<稳定玻璃对象名>` 为 canonical key：initialize 时创建，job 阶段复用并更新位置/材质，只切换 `hide_render`；HDRI 成功加载时全部隐藏，无 HDRI 时显示，不会随 job 增长对象数。
- `scripts/blender/materials_from_yaml.py`：从 `materials.yaml` 解析 render role/appearance，生成材质应用契约和外部 PBR 资源路径；其 tint 构建路径仍通过延迟导入依赖 `dress_scene.hex_rgb`，该反向依赖尚未消除。
- `scripts/blender/curtain_projection.py`：解析并校验 GLB 窗帘节点命名，与 `presentation.curtains` 的 `expectedVisibleNodes` 对比；不根据 scenario 猜测窗帘开合。
- `scripts/blender/dress_config.py`：把 scenarios×cameras 展开为 job 列表，并生成稳定的 `version__camera__scenario` 输出名。
- `scripts/blender/wood_texture.py`：与 Three.js 纹理逻辑对齐的程序化木地板贴图生成器，输出 diffuse/normal/roughness；同 seed 可复现，支持直铺和 herringbone。
- `scripts/blender/audit_scene_assets.py`：只读场景资产审计；按显式 metadata 分类真实资产、程序化对象、render-only，并按 formal instance key 聚合可见来源和冲突。

此外，bundle 资源清单当前还会携带 `scripts/blender/blenderkit_packed_pbr.py` 等资源辅助文件；它不是上述主编排边界的替代入口。

## 5. `initialize_once` + per-job reset 模型

当前实现的函数名是 `initialize_scene`，语义即 initialize once：

1. `bpy.ops.wm.read_factory_settings(use_empty=True)` 清空 Blender 初始场景；
2. 注入并配置资产/render-only 模块；
3. 导入正式 GLB；
4. 校验窗帘节点与 facts projection；
5. 创建材质、资产替换、render-only staging、灯光、World、天空 fallback、相机和可选 HVAC view-only；
6. 标记动态对象，保存对象数量、灯光默认值、玻璃材质默认值和窗帘 hide/render snapshot；
7. 返回供所有 job 复用的 runtime。

同一个 Blender 进程中，`dress_config.make_jobs` 产生的每个 job 不重新导入建筑，也不重新创建整套家具。每个 job 通过 `_apply_job_state` 执行 per-job reset：

- `_reset_job_visibility` 恢复动态对象和正式家具的可见性；
- 恢复窗帘初始 hide/render snapshot；
- 按当前 scenario 应用 `bare_shell`、HVAC、窗帘 policy；
- 更新纱帘透明度、玻璃/Low-E 参数、灯具发光、灯光、Sun、window portal、World/HDRI、天空 fallback、相机和曝光；
- 检查对象/mesh/light/camera/collection counts 是否意外变化；
- 输出 PNG 后写出对应 `.png.meta.json`。

因此新 job 状态应通过 reset 和显式配置得到，不能依赖上一个 job 留下的隐藏状态、材质参数、灯光能量或相机位置。若新功能会创建对象，必须说明它是 initialize once 创建、还是可重复调用且能正确复位的动态对象。

## 6. bundle、manifest 和 PNG sidecar 追溯

### 6.1 bundle

`npm run build:render-bundle -- --glb <手动导出的-house.glb> --output-dir <dir>` 当前会：

- 生成 `project-render-facts.json` 和 `render-config.json`；
- 复制输入为 bundle 内的 `house.glb`；
- 只复制显式声明的 runtime 配置、Blender 脚本、贴图、家具资源和 HDRI（包括声明资源目录中实际存在的文件），不是所有 source inputs；source inputs 主要通过 manifest 的 SHA-256 指纹追溯；
- 检查 GLB 有效性、有限 world bbox 和窗帘 active-only 节点；
- 写入 `manifest.json`。

bundle 的核心交付文件是 `manifest.json`、`house.glb`、`render-config.json` 和 `project-render-facts.json`，另有 manifest 列出的资源文件。

### 6.2 manifest

`manifest.json` 使用当前 schema `2.0`，记录：

- Git `revision`、dirty 状态和 `git status --porcelain=v1`；
- source inputs 的 SHA-256，包括布局几何、overlay、presentation、共享构建器和渲染配置相关输入；
- 每个资源/产物的路径、字节数和 SHA-256；
- `sourceInputsSha256`、`resourcesSha256`、`artifactsSha256`、`bundleSha256` 四个 input fingerprints；
- GLB 导出方法：`manual_web_export` 或 `cli_shared_builder`，以及输入 basename；
- facts、GLB 摘要和窗帘 snapshot/effective state/expected nodes/actual nodes。

`npm run verify:render-bundle -- --bundle <dir>` 会验证 manifest、文件 bytes/hash、资源相对路径、facts/config 一致性、GLB 摘要和窗帘节点。schema `1.x` legacy bundle 会被 render verification 拒绝，必须重新构建当前 bundle；clean bundle 还会检查 HEAD 和当前源输入是否漂移。

### 6.3 PNG sidecar

`dress_scene.py` 每次渲染 `foo.png` 时，同时写 `foo.png.meta.json`，包含：

- `scenario`；
- `camera`；
- `curtainPolicy`；
- `curtainSnapshotSha256`；
- `inputFingerprints`。

当运行绑定了 manifest 时，`inputFingerprints` 来自 manifest，并且 Blender 会校验 bundle 的资源、产物和 source input hash；没有 manifest 时会明确记录 `status: unbound`，这不是完整 bundle 追溯。PNG sidecar 的 fingerprints 必须与 manifest 一致；`assertRenderOutputMetadata` 用于单独校验这一契约。sidecar 不是视觉验收证明，只是把某张 PNG 绑定到具体输入集合和窗帘快照。

## 7. 典型故障排查

### 7.1 画面里出现重复家具

优先检查 `audit_scene_assets.py` 的资产审计，而不是先删对象：

1. 运行只读审计，查看每个 mesh 的 `instance_key`、`formal_web_geometry`、`dress_replacement_source`、`render_only`、`asset_source` 和 `hide_render`；
2. 按完整 key 检查是否同时有可见 formal source 和 replacement source；
3. 检查 replacement 是否误用了家具类型作为 key，导致多个实例都匹配同一替换；
4. 检查 render-only 候选是否被错误归类为 replacement；render-only 不应算作正式 replacement，但仍可能造成视觉重复；
5. 检查 per-job reset 是否把上个 job 的动态对象重新显示，或重复调用 staging 时没有复用已有 canonical 对象。

正确修复方向是修正实例 key、可见性或替换白名单，不是修改 Web/CLI 布局。

### 7.2 Low-E 玻璃效果不对

当前 `materials_from_yaml.py` 支持 `profile: low_e`，默认参数包括 roughness、transmission、IOR 和 coat。job 状态还会同步修改 `glass` 和 `exterior_glazing` 两个材质角色；只改其中一个会导致正式幕墙节点仍使用旧参数。

排查顺序：

- 确认 `materials.yaml` 的 `exterior_glazing` role 实际指向了期望材质，且 profile 不是误用 `fluted`；
- 确认 scenario 的 `glass_tint`、`glass_ior`、`glass_coat` 被应用；
- 确认 Cycles 下执行了玻璃 shadow passthrough；
- 确认 HDRI/sky fallback 状态：HDRI 成功加载时 sky plane 应隐藏，HDRI 缺失时才使用不透明天空 fallback；
- 检查 PNG sidecar 和 job audit 的 scenario/fingerprint，避免把不同工况的玻璃效果混比。

这类排查只能修改 Blender 材质/环境配置，不能修改幕墙建筑几何或把 Low-E 解释成需要重建玻璃。

### 7.3 斜线、斜铺或家具横躺

“斜线”可能来自两类不同问题：

- 木地板的 herringbone 是 `wood_texture.py` 有意生成的 ±45° 板条，不是建筑墙线；应检查 appearance 的 `pattern`、seed、plank 尺寸和生成贴图；
- 家具资产的斜放/横躺通常是导入资产自身轴向或 baked rotation 问题。`blender_assets.py` 使用四元数复合摆位，不能简单覆盖 `rotation_euler`，否则会丢失 glTF 的基础坐标转换。应先查看源 bbox、导入后的 rotation、薄轴/高度，再使用已声明的 `rot_fix`、`level_x` 或 `flip_axis`，并确认不改变 formal anchor。

如果斜线出现在墙、门、玻璃或房间边界，先回到 GLB/geometry/topology 校验；不要用 Blender 旋转建筑来遮盖上游错误。

### 7.4 旧 bundle 或旧 manifest

遇到 `Legacy render bundle manifest schema 1.x is rejected`、source input drift、artifact SHA mismatch 或 facts/config 不一致时：

- 不要手工编辑 bundle 内的 manifest、GLB 或 config；
- 确认 bundle 目录为空/新建，避免构建器拒绝覆盖非空目录；
- 重新运行 `generate:render-config`、`build:render-bundle` 和 `verify:render-bundle`；
- 若工作树有未提交修改，按当前规则显式使用 `--allow-dirty`，让 manifest 记录 dirty porcelain；
- 检查渲染输出的 `.meta.json` 是否仍绑定旧 fingerprints；旧 PNG 不应被标成新 bundle 的输出。

当前构建器不会启动浏览器、Blender 或云端渲染；不要把 bundle 构建成功误写成远程 workflow 已修复，也不要把 verifier 通过误写成视觉验收已完成。

## 8. preview / formal 模式与 CLI 约定

`preview` 和 `formal` 是本项目的运行约定，不是 `run-blender.sh` 或 `dress_scene.py` 的额外 `--mode` 参数。两种模式使用同一套 Blender 场景编排和输入契约；差别在于输入是否已冻结、追溯要求和验收门槛。

### 8.1 preview 模式

preview 用于快速比较材质、灯光、环境、相机和允许的 render-only staging。它可以使用工作树中的当前输入，也可以使用已生成 bundle；允许低分辨率、较少 samples、单机位或单场景，以及 `--mat-override`。preview 的结果只用于评审，不得被表述为正式交付或视觉验收通过。

示例：

```bash
# 使用已有 GLB 和生成的 render config，只渲一个机位/工况
scripts/run-blender.sh \\
  --glb tmp/preview/house.glb \\
  --config scripts/blender/render-config.json \\
  --config-dir . \\
  --out-dir tmp/preview/out \\
  --engine EEVEE --version preview-001 \\
  --only living --scenario daylight --res 50 --samples 64

# 在同一机位比较候选材质；每个候选应单独输出一组 PNG
scripts/run-blender.sh \\
  --glb tmp/preview/house.glb \\
  --config scripts/blender/render-config.json \\
  --out-dir tmp/preview/material-wall-warm \\
  --version preview-wall-warm \\
  --only living --scenario daylight \\
  --mat-override 'wall=#f5f1e8' --res 50 --samples 64
```

preview 的边界：

- 可以改变 Blender 运行时材质、灯光、World/HDRI、曝光、相机和明确的 render-only 对象；不能改变 GLB 建筑、正式布局、预算、碰撞或上游配置。
- 可以暂时使用 dirty source 或未绑定 manifest 的输入，但 sidecar 必须明确记录 `status: unbound`（若未绑定）；这类 PNG 不能作为可复现交付物。
- `--mat-override` 只影响本次渲染，不回写 `config/materials.yaml`；preview 结束后不得把候选材质或 render-only 对象当作正式设计。
- preview 最低检查是命令成功、输出 PNG 与 `.png.meta.json` 成对生成，并确认机位/工况正确；它不等同于 bundle verifier 或视觉验收。

### 8.2 formal 模式

formal 用于可追溯的正式渲染输出。必须先从当前正式源构建一个新 bundle，再绑定 manifest 渲染；正式模式不接受手工修改 bundle 内的 `manifest.json`、GLB、facts 或 render config，也不把 Blender staging 写回上游源文件。

推荐流程：

```bash
# 无手工 Web GLB 时，由 shared builder 导出正式 GLB
npm run build:render-bundle -- \\
  --output-dir tmp/formal-bundle-001

# 若已有 Web 手动导出的 GLB，显式记录其来源
npm run build:render-bundle -- \\
  --glb /path/to/house.glb \\
  --output-dir tmp/formal-bundle-001

# 绑定 manifest 执行正式渲染；可用 --only/--scenario 做正式批次拆分
scripts/run-blender.sh \\
  --glb tmp/formal-bundle-001/house.glb \\
  --config tmp/formal-bundle-001/render-config.json \\
  --config-dir tmp/formal-bundle-001 \\
  --manifest tmp/formal-bundle-001/manifest.json \\
  --out-dir tmp/formal-bundle-001/renders \\
  --engine CYCLES --version formal-001

npm run verify:render-bundle -- \\
  --bundle tmp/formal-bundle-001
```

正式模式的边界与要求：

- 正式 GLB 必须来自 `manual_web_export` 或 `cli_shared_builder`，且 bundle 内固定为 `house.glb`；bundle 目录必须为空或不存在，构建器拒绝覆盖非空目录。
- 默认要求 clean source。若确实要记录未提交改动，只有构建 bundle 时显式使用 `--allow-dirty`；manifest 必须保留 dirty porcelain，这种产物应标为 dirty formal batch，不得冒充 clean、可复现交付。
- 正式渲染必须传入同一 bundle 的 `--manifest`，以校验资源、产物和 source input fingerprints；未绑定 manifest 的输出只能归入 preview。
- 正式批次不得使用 `--mat-override` 或临时替换正式源数据；允许的 replacement 和 render-only staging 仍须遵守本文件的实例 key、实体墙、玻璃幕墙和 fallback 规则。
- 正式输出的 `.png.meta.json` 必须与 manifest fingerprints、scenario、camera 和 curtain snapshot 一致；sidecar 追溯通过不代表画面视觉验收通过。

### 8.3 验收分层

按以下顺序记录结果，避免把脚本校验误写成视觉结论：

1. **输入验收**：`manifest.json` schema、GLB、facts、render config、资源路径和 SHA-256 通过 `npm run verify:render-bundle -- --bundle <dir>`；若是 clean bundle，还必须没有 source input drift。
2. **运行验收**：Blender 命令成功；预期的相机×scenario 输出齐全；每张 PNG 都有 sidecar；对象、mesh、light、camera、collection 数量没有因 job 累积异常增长。
3. **契约验收**：sidecar 的 `scenario`、`camera`、curtain policy/snapshot 和 fingerprints 正确；正式 replacement 不重复；render-only 有明确 metadata，且没有写回正式源。
4. **视觉验收**：按项目 acceptance checklist 逐张检查构图、建筑边界、材质、灯光、玻璃、窗帘、家具遮挡和明显重复/穿插。只有这一步通过，才能写“视觉验收通过”；前三级通过只能写“脚本/追溯通过”。

边界条件：输入 GLB、render config、manifest、HDRI 或贴图缺失时应失败并修复输入，不应在 Blender 猜测或重建正式几何；单个资产导入失败时按既有规则保留正式/程序化 fallback。任何发现墙体、门窗、玻璃幕墙、房间边界或正式家具位置错误的结果，都应回到 Web/CLI/配置层修复，而不是在 Blender 中遮盖。

## 9. 新功能 checklist

新增 Blender 渲染功能前，至少确认：

- [ ] 是否明确属于材质、灯光、环境、formal replacement、render-only 或 legacy；
- [ ] 是否会改变 Web/CLI 建筑几何、正式布局、预算或碰撞；若会，必须移回共享/正式数据层，不能在 Blender 偷改；
- [ ] 若替换家具，是否绑定完整 formal instance key，而不是家具类型；
- [ ] 是否只使用已有正式锚点、可靠实体墙 bbox 或命名 plumbing bbox；没有锚点时是否跳过而不是猜位置；
- [ ] 是否避开 `curtain_run`、被 suppress 的玻璃墙和门洞；
- [ ] 是否设置并保持正确的 `formalWebGeometry`、`geometrySource`、`assetSource`、`assetProvider`、`dress_replacement_source` 或 `render_only` 审计属性；
- [ ] 导入资产是否检查 bbox、尺寸、轴向、材质槽、UV、贴图和 packed image；
- [ ] 是否保留导入失败时的正式/程序化 fallback；
- [ ] 是否能在 `initialize_scene` 一次创建，并在每个 job 的 reset 后得到相同的干净状态；
- [ ] 是否会影响窗帘 active-only 节点契约；若会，必须同步上游 projection，而不是在 Blender 猜测开合；
- [ ] Low-E 等 scenario 参数是否同时应用到相关材质角色；
- [ ] 是否为 bundle 资源清单、manifest fingerprints 和 PNG `.meta.json` 追溯考虑了输入；
- [ ] 是否补充离线单测/只读审计，且不把视觉结果或远程 workflow 状态写成已验证事实；
- [ ] 完成几何、电气、家具或碰撞相关修改后，按项目规则运行相应的 `npm run verify:all`、`npm run test:server`、`npm run typecheck`，并在文档或交付记录中如实区分“脚本通过”和“视觉验收”。

本文档自身不改变任何 Web/CLI、配置、渲染脚本或资源文件。
 
