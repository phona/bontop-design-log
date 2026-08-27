---
name: agent-browser-practice
description: 需要用真实浏览器驱动/验证 Web 应用时使用 — 页面截图取证、运行时场景内省（eval 遍历对象树/包围盒）、改动前后同机位 A/B 对比、复现和定位视觉回归、验证应用就绪状态。覆盖 agent-browser 实战套路（就绪等待、排除法定位、对比流程）与踩坑记录（daemon 卡死、双层 HTTP 缓存、瞬时状态误读）。命令大全见 CLI 自带 `agent-browser skills get core --full`，本文件是其实战补充。
version: 1.0.0
---

# agent-browser 实战手册

命令大全以 CLI 自带文档为准：`agent-browser skills get core --full`。本文件只沉淀两件事：**反复用到的实战套路**和**踩过的坑**。

## 最小工作流

```bash
agent-browser open "http://localhost:5173"     # 打开页面（浏览器常驻，后续命令复用同一实例）
agent-browser eval "1+1"                        # 执行 JS，返回值 JSON 序列化输出
agent-browser screenshot out.png                # 视口截图
agent-browser reload                            # 重载当前页
agent-browser close --all                       # 关闭会话（daemon 异常时的复位手段）
```

## 实战套路

### 1. 就绪等待：等应用级 ready，不是页面 load

页面 load ≠ 应用可用。轮询应用暴露的 ready 信号再操作：

```bash
for i in $(seq 1 30); do
  r=$(agent-browser eval "!!(window.__APP__ && window.__APP__.isReady && window.__APP__.isReady())" | tail -1)
  [ "$r" = "true" ] && break
  sleep 2
done
```

### 2. eval 大返回值：重定向落盘，不进对话上下文

截图 data URL、大量遍历结果可能有几百 KB：

```bash
agent-browser eval "window.__APP__.captureFloorPlan()" > /tmp/shot.raw
python3 -c "import json,base64; s=json.loads(open('/tmp/shot.raw').read().strip()); open('/tmp/shot.png','wb').write(base64.b64decode(s.split(',',1)[1]))"
```

### 3. 场景内省：eval 直接遍历运行时对象

TS 的 `private` 只是编译期约束，运行时 `window.__APP__.houseScene.controls` 之类照拿。eval 里遍历场景树、算世界包围盒、按 `userData.objectId` 找对象，比猜像素位置可靠得多。输出多个值时用分隔符 join 成一行再 split。

### 4. 排除法定位视觉元素

不知道某个可见物体是谁：eval 里按候选 id 逐个 `visible = false`，各截一张图对比。比悬停 tooltip 可靠（tooltip 只覆盖可交互对象）。

悬停识别也可以：向 canvas 派发 `pointermove`（PointerEvent，带 clientX/Y），再读 tooltip DOM 文本。

### 5. 同条件 A/B 对比

- 两套实例用不同端口起（如 5173/5174），同一浏览器顺序抓取；
- 截图前 `agent-browser set viewport 1600 1000` 固定尺寸；
- 有相机控制的应用，eval 设置相同的相机位置/朝向再截图；
- 两张 PNG 用 PIL `ImageChops.difference` 出 diff 热力图，快速定位差异区域。

## 坑

### daemon 卡死 / "Invalid response: EOF ... daemon may be busy"

某个 eval 把页面搞崩、或 open 长时间挂起后，daemon 会处于半死状态，后续所有命令报 EOF。处置：`agent-browser close --all` 复位，再重新 `open`。`open` 卡超过约 2 分钟就直接杀掉重来，别等。

### 浏览器 HTTP 缓存（两个层次，都会坑）

- **JS bundle 缓存**：dev server 改了代码，`open` 同一 URL 可能加载旧模块——页面功能是新是旧从 URL 看不出来。对策：URL 加变化 query（`?v=1`、`?v=2`...）强制重新拉取入口和模块。
- **fetch/XHR 的 API 响应缓存**：上面那招**破不了**应用 `fetch('/api/xxx')` 的缓存。改配置/数据后要再 `reload` 一次，并验证数据确实是新的（查一个只有新版本才有的字段值），否则会在旧数据上调试半天。

### 别把瞬时状态当结论

- 应用未 ready 时遍历到的场景/数据可能是过渡态（半成品重建中），先确认 ready 再下结论。
- 页面上的报错横幅可能是编辑文件中途的瞬时状态被服务器记住了；先查服务端状态接口确认，再动手修"假错误"。
- config watcher 可能漏掉某次变更，服务端数据不对时 touch 一下配置文件触发重载，再核对。

### 其他

- 长时间命令（如冷启动 open）可能被执行环境自动转后台，继续做别的事，等完成通知即可。
- 截图里要看清细节，用原图裁剪区域查看，别在缩略图上猜。
