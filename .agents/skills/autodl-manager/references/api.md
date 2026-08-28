# AutoDL 容器实例 Pro API 与 SSH/SFTP 参考

官方文档：[instance_pro_api](https://www.autodl.com/docs/instance_pro_api/)

## 配置与认证

`.agents/skills/autodl-manager/.env` 默认加载；进程环境变量优先，也可通过 `--env-file PATH` 指定文件。该文件已被 gitignore 忽略，模板为 `.agents/skills/autodl-manager/.env.example`。`AUTODL_CONFIG` 可选覆盖 TOML 配置路径；不要把 token 放入 `config.toml`。

API 的 host/timeout/page_size 优先读取 `AUTODL_HOST`/`AUTODL_TIMEOUT`/`AUTODL_PAGE_SIZE`，其次 `[api]`，并兼容旧 `[autodl]`；默认 host 为 `https://api.autodl.com`。鉴权请求头为 `{"Authorization": token}`，值直接填写 token，不加 `Bearer`。

所有响应必须 HTTP 2xx 且 JSON `code == "Success"`。输出递归隐藏 `root_password`、`jupyter_token`、`token`、`password`、`cookie` 等字段。

## Pro API 接口

| 客户端命令 | 方法 | 路径 | Body/query |
|---|---|---|---|
| `create` | POST | `/api/v1/dev/instance/pro/create` | 创建参数 JSON |
| `info` | GET | `/api/v1/dev/instance/pro/snapshot` | query `instance_uuid` |
| `status` | GET | `/api/v1/dev/instance/pro/status` | query `instance_uuid` |
| `ls` | POST | `/api/v1/dev/instance/pro/list` | `page_index`, `page_size` |
| `start` | POST | `/api/v1/dev/instance/pro/power_on` | `instance_uuid`, `payload: gpu` |
| `stop` | POST | `/api/v1/dev/instance/pro/power_off` | `instance_uuid` |
| `release` | POST | `/api/v1/dev/instance/pro/release` | `instance_uuid` |
| `save-image` | POST | `/api/v1/dev/instance/pro/image/save` | `instance_uuid`, `image_name` |
| `images` | POST | `/api/v1/dev/instance/pro/image/private/list` | `page_index`, `page_size` |

## SSH/SFTP 分层

上传和下载不是官方 HTTP API。`autodl_ssh.py` 每次 exec/upload/download 先请求 snapshot 和 status；运行中直接连接，非 running 默认报错。传入 `--start` 时调用 `power_on`（payload=`gpu`）、轮询 status 到 `running`，再重新 snapshot，使用最新地址、端口和密码建立 Paramiko SSH 连接。凭据不缓存、不放入命令行，连接和 SFTP 客户端始终关闭。

```bash
PY=.agents/skills/autodl-manager/.venv/bin/python
$PY .agents/skills/autodl-manager/scripts/autodl_ssh.py exec UUID --command 'nvidia-smi'
$PY .agents/skills/autodl-manager/scripts/autodl_ssh.py upload UUID ./render /root/render
$PY .agents/skills/autodl-manager/scripts/autodl_ssh.py download UUID /root/render/out ./out
```

上传支持单文件和递归目录，默认忽略 `.git`、`node_modules`、`__pycache__`、`.venv`、`venv`、`*.pyc`；源目录的 `.autodlignore` 优先于 `.gitignore`。下载目录会递归创建本地路径。

## Blender workflow 与失败策略

镜像已包含 `/root/blender/blender`，固定远端根目录为 `/root/bontop-acceptance`。`autodl_blender.py` 只上传 profile 白名单中的 `config`、`scripts/blender`、`hdri`、`assets/textures` 和 `tmp/final-render-bundle`，保持相对目录结构，不上传 Blender 二进制或整个项目。

`preflight` 默认检查本地 `tmp/final-render-bundle`，要求 `house.glb`、`render-config.json`、`project-render-facts.json` 存在且 bundle 有非空文件；失败时不创建实例、不启动实例。完整 `run` 顺序是：preflight → create → 轮询 `creating`/`starting` 到 `running` → probe 固定的 Blender、可执行权限和 `nvidia-smi` → upload → render → fetch 并校验至少一个非空文件 → stop → 可选 release。创建后的异常或 KeyboardInterrupt 至少尝试 stop；fetch 失败绝不 release；变更操作不自动重试。API 创建成功时使用 `data` 中的 UUID 字符串。

`release` 不可逆，必须同时使用 `--release-after` 和 `--confirm-release`；已有实例默认不自动 release。`cleanup` 总是先 stop，只有两个标志都满足才 release。

### 费用最佳实践

- `running` 状态产生 GPU 按量费用；任务结束立即 `stop`。
- `shutdown/stopped` 通常停止 GPU 费用，但系统盘和实例仍保留，可能继续产生系统盘托管费。
- 要完全停止后续托管费用，需在结果下载并校验后执行 `release`；释放会永久删除实例数据。
- 自动化必须使用清理逻辑：无论远程命令成功、失败还是被中断，都至少尝试关机；只有 fetch 成功、明确标记为临时实例且用户同时授权时才释放。
- `running` 仅表示 API 状态，不保证 SSH 服务已就绪；开机后应轮询并重试 snapshot/SSH。
- `shutdown/stopped` 与 `release` 不同：关机通常停止 GPU 按量费用，但实例和系统盘仍保留并可能继续产生托管费用；release 永久删除实例数据并停止后续实例/系统盘托管费用，不能恢复。
- 每次连接前刷新 snapshot，禁止缓存可能变化的 SSH 地址、端口和密码。
