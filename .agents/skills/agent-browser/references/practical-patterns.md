# Agent Browser 实战套路与常见坑

命令细节以 `$HOME/.local/bin/agent-browser skills get core --full` 为准。本文件只沉淀项目专属的**实战套路**和**踩坑处理**。

## 不要做

- 不要在同一个 session / daemon 内并行执行 `open`、`reload`、`snapshot`、`screenshot` 等命令。
- 不要重复启动常驻的 `npm run dev`；先检查端口和 HTTP 响应。
- 不要把后台任务显示的 timeout 直接当成应用失败。
- 不要在页面变化后继续使用旧 refs；先重新 `snapshot`。
- 不要只凭一张截图判断应用正确；至少同时保留 URL、title、snapshot 和截图。
- 不要混用不同版本的 GLB、render facts 和 Blender config。

## 一、daemon / 会话管理

### 1. daemon EOF / busy

#### 现象

命令返回类似：

```text
Invalid response: EOF
 daemon may be busy or unresponsive
```

#### 原因

某个 `eval` 让页面或浏览器进程异常，或者 `open` 长时间挂起后，daemon 进入半死状态；后续命令可能全部失败。

#### 推荐处理

按顺序执行，保持单个 session 串行：

```bash
$HOME/.local/bin/agent-browser close --all
$HOME/.local/bin/agent-browser open "http://localhost:5173/"
$HOME/.local/bin/agent-browser wait --load networkidle
$HOME/.local/bin/agent-browser snapshot -i -c
```

必要时先确认应用本身仍可访问：

```bash
curl -I http://localhost:5173/
$HOME/.local/bin/agent-browser --help
```

冷启动 `open` 长时间无响应时，不要不断重复发送同一命令；终止当前命令、复位会话后再试。

### 2. refs 生命周期

`snapshot` 会为当前页面生成新的 `@eN` refs。点击、导航、表单提交、动态重渲染等页面变化都可能让旧 refs 失效；下一次交互前重新执行 `snapshot -i`。

## 二、并发与超时

### 1. 同一 session 必须串行

不要这样执行：

```bash
$HOME/.local/bin/agent-browser reload &
$HOME/.local/bin/agent-browser snapshot &
$HOME/.local/bin/agent-browser screenshot out.png &
```

同一个 daemon 的状态、当前 tab 和 refs 不是为这种并发操作设计的，容易出现 EOF、超时或拿到错误页面状态。

不同 session 可以隔离运行，但必须显式指定：

```bash
$HOME/.local/bin/agent-browser --session a open http://localhost:5173/
$HOME/.local/bin/agent-browser --session b open http://localhost:5173/
```

### 2. 常驻 dev server 不要当普通任务等待

`npm run dev` 会持续运行，后台任务显示 timeout 可能只是因为进程本来不会退出。单独启动一次，然后验证：

```bash
curl -I http://localhost:5173/
```

确认服务可用后，浏览器检查期间不要再次启动 dev server。若端口已被占用，先确认现有进程和页面是否就是目标实例，不要直接杀进程。

### 3. 长任务与浏览器操作分阶段

Blender、全量测试和 browser daemon 同时运行时可能争用 CPU、内存或 I/O。推荐顺序：

```text
确认 Web 服务 → 浏览器建立基线 → 结束浏览器操作
→ 执行 Blender / 测试 → 最后重新串行打开浏览器复核
```

## 三、本地 Web 验证流程

### 1. 标准基线证据

一次有效的页面验证至少记录以下四类证据：

1. 当前 URL；
2. 页面 title；
3. accessibility snapshot；
4. 截图文件。

推荐流程：

```bash
$HOME/.local/bin/agent-browser open "http://localhost:5173/"
$HOME/.local/bin/agent-browser wait --load networkidle
$HOME/.local/bin/agent-browser get url
$HOME/.local/bin/agent-browser get title
$HOME/.local/bin/agent-browser snapshot -i -c
$HOME/.local/bin/agent-browser screenshot tmp/web-baseline.png
```

页面有应用级 ready 信号时，`networkidle` 之后还要等待 ready。只拿到截图不足以证明页面加载完成或交互状态正确。

### 2. 应用级 ready

页面 load 不等于应用可用。轮询应用暴露的 ready 信号再操作：

```bash
for i in $(seq 1 30); do
  ready=$($HOME/.local/bin/agent-browser eval "!!(window.__APP__ && window.__APP__.isReady && window.__APP__.isReady())" | tail -1)
  [ "$ready" = "true" ] && break
  sleep 2
done
```

未 ready 时遍历到的场景或数据可能只是过渡态，不要据此下结论。

### 3. eval 大返回值和场景内省

截图 data URL、大量遍历结果可能有几百 KB，应重定向落盘，不要塞进对话上下文：

```bash
$HOME/.local/bin/agent-browser eval "window.__APP__.captureFloorPlan()" > tmp/shot.raw
python3 -c "import json,base64; s=json.loads(open('tmp/shot.raw').read().strip()); open('tmp/shot.png','wb').write(base64.b64decode(s.split(',',1)[1]))"
```

TS 的 `private` 只是编译期约束。运行时可通过 `window.__APP__` 遍历场景树、计算世界包围盒、按 `userData.objectId` 查找对象；这通常比猜像素位置可靠。多个值可先 `join` 成一行再解析。

### 4. 视觉元素排除法

不知道某个可见物体对应哪个对象时，可以按候选 id 逐个设置 `visible = false`，分别截图比较。这通常比 tooltip 可靠，因为 tooltip 只覆盖可交互对象。

需要识别悬停目标时，也可以向 canvas 派发带 `clientX/Y` 的 `PointerEvent`，再读取 tooltip DOM 文本。

### 5. 同条件 A/B 对比

- 两套实例使用不同端口，同一浏览器内按顺序抓取；
- 截图前固定视口：`$HOME/.local/bin/agent-browser set viewport 1600 1000`；
- 有相机控制的应用，用 eval 设置相同相机位置和朝向；
- 用 PIL `ImageChops.difference` 生成 diff 热力图；
- 查看细节时使用原图或裁剪区域，不要只看缩略图。

### 6. 缓存和瞬时状态

- **JS bundle 缓存**：dev server 改代码后，同一 URL 可能加载旧模块。可给 URL 加变化 query，例如 `?v=1`、`?v=2`。
- **fetch/XHR 缓存**：URL query 不一定能破除应用 API 响应缓存。改配置或数据后再 `reload`，并验证只有新版本才有的字段值。
- **配置 watcher**：服务端数据不对时，先确认状态接口；必要时触发配置 watcher 重载，再重新核对。
- 页面报错横幅可能是编辑过程中的瞬时状态，先查服务端实际状态，不要立即修“假错误”。

## 四、Blender / WSL 联动

### 1. Windows Blender 与 WSL 路径

#### 现象

Windows 侧 Blender 直接读取 Linux/WSL 路径失败，或找不到 GLB、配置和 HDRI。

#### 推荐处理

从 Windows Blender 进程访问 WSL 工作区时，推荐统一使用项目 wrapper：

```bash
bash scripts/run-blender.sh --glb tmp/house.glb \
  --config scripts/blender/render-config.json --config-dir .
```

wrapper 会依据 `BLENDER_HOST` 或可执行文件名判断目标环境，仅转换路径参数；Blender 本身运行在 Linux/WSL 时继续使用 Linux 路径。

### 2. GLB 与 render facts 必须匹配

#### 现象

Blender 报错：

```text
GLB contains unexpected curtain nodes
```

#### 原因

导出的 GLB 没有使用当前 render facts，或 GLB、facts、config 来自不同版本，导致场景节点与预期不一致。

#### 推荐处理

正式验证前使用同一份 facts 生成配置并导出 GLB：

```bash
npm run generate:render-config
npm run export:glb -- \
  --output tmp/house-facts.glb \
  --render-facts scripts/blender/project-render-facts.json
```

随后再运行 Blender。该流程适用于本项目 render pipeline；其他项目应以自己的导出脚本和 facts 生成方式为准。

## 记录新坑的模板

每次新增经验时，优先记录：

```markdown
## 标题

### 现象

### 原因

### 错误示例

### 推荐处理

### 适用边界
```
