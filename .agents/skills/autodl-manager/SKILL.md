---
name: autodl-manager
description: 基于 AutoDL 官方容器实例 Pro API 与 Paramiko SSH/SFTP 的项目级实例管理助手
version: 4.0.0
---

# AutoDL Manager

本 skill 使用 AutoDL 官方容器实例 Pro API 管理实例和镜像，并使用 Paramiko SSH/SFTP 执行容器内命令、上传和下载文件。HTTP API 与 SSH/SFTP 是两层：上传下载不是官方 HTTP API，而是先通过 API snapshot/status 获取当次连接凭据，再连接 SSH/SFTP。

脚本路径均相对于项目根目录：

- `.agents/skills/autodl-manager/scripts/autodl_pro.py`
- `.agents/skills/autodl-manager/scripts/autodl_ssh.py`

Python 3.10 运行 SSH/SFTP 时使用 skill 私有环境 `.agents/skills/autodl-manager/.venv/bin/python`。该环境依赖仅为 `paramiko`；Pro API 客户端仍只需 Python 标准库和项目已有 `tomli`。

## 认证与配置

skill 目录 `.agents/skills/autodl-manager/.env` 默认自动加载；进程环境变量优先，脚本不会覆盖已有变量。该文件已被 gitignore 忽略，模板为 `.agents/skills/autodl-manager/.env.example`。可用 `--env-file PATH` 指定其他文件，`AUTODL_CONFIG` 可选地覆盖 TOML 配置路径。不要把 token 放入 `config.toml`。

```bash
.agents/skills/autodl-manager/.venv/bin/python .agents/skills/autodl-manager/scripts/autodl_pro.py config
.agents/skills/autodl-manager/.venv/bin/python .agents/skills/autodl-manager/scripts/autodl_pro.py --env-file .agents/skills/autodl-manager/.env ls
```

`.env.example` 只包含占位符和非敏感 API 参数。可复制为 `.agents/skills/autodl-manager/.env`；真实 `.env` 已被 gitignore 忽略。`config.toml` 保留旧 profile/default 配置，但不要写入 token；可用 `--config PATH` 覆盖。Token 优先级为进程环境 `AUTODL_TOKEN` > skill `.env` 中的 `AUTODL_TOKEN` > `[auth].token`。API 的 host/timeout/page_size 优先读取 `AUTODL_*`，其次 `[api]`，并兼容旧 `[autodl]`。

请求头必须直接使用 token：

```http
Authorization: 你的Token
```

不要添加 `Bearer`。所有 API 输出和错误会递归脱敏 `root_password`、`jupyter_token`、token、password、cookie 等敏感字段。

## Pro API 命令

```bash
PY=.agents/skills/autodl-manager/.venv/bin/python
API=.agents/skills/autodl-manager/scripts/autodl_pro.py
$PY "$API" ls
$PY "$API" info INSTANCE_UUID
$PY "$API" status INSTANCE_UUID
$PY "$API" create --profile pro --confirm
$PY "$API" start INSTANCE_UUID --confirm
$PY "$API" stop INSTANCE_UUID --confirm
$PY "$API" release INSTANCE_UUID --confirm-release
$PY "$API" images
$PY "$API" save-image INSTANCE_UUID --image-name '镜像备份' --confirm
```

创建、开关机、保存镜像需要确认参数。`release` 不可逆，必须显式 `--confirm-release`，且客户端会先确认 snapshot/status，必要时关机并轮询到停止状态；不会自动释放实例。默认 `pro` profile 已归档为实测可用的 Blender 镜像 `image-ff88133a27` + `v-48g-350w`，实际测试价格为 1.87 元/小时；若 AutoDL 后台调整镜像或规格，应先重新 `images`/`info` 确认。

## SSH/SFTP 命令

每次操作都会重新请求 snapshot 和 status；不会缓存密码或地址。非 `running` 默认报错，传入 `--start` 才会调用官方 `power_on`（`payload=gpu`）并轮询，然后重新 snapshot 获取最新地址、端口和密码。密码不出现在命令行；连接始终在 `finally` 中关闭。

```bash
SSH=.agents/skills/autodl-manager/scripts/autodl_ssh.py
$PY "$SSH" exec INSTANCE_UUID --command 'nvidia-smi'
$PY "$SSH" upload INSTANCE_UUID ./local-dir /root/work
$PY "$SSH" download INSTANCE_UUID /root/output ./output
$PY "$SSH" exec INSTANCE_UUID --command 'python render.py' --start
```

`upload` 支持单文件和递归目录；目录上传默认忽略 `.git`、`node_modules`、`__pycache__`、`.venv`、`venv` 和 `*.pyc`。本地源目录存在 `.autodlignore` 时优先使用它，否则使用 `.gitignore`。`download` 支持递归目录并自动创建本地父目录。

## Blender 专用 workflow

镜像已预装 Blender：`/root/blender/blender`。workflow 固定使用远端工作目录 `/root/bontop-acceptance`，不会上传 Blender 二进制或整个项目。默认 profile 的上传白名单只有：

- `config`
- `scripts/blender`
- `hdri`
- `assets/textures`
- `tmp/final-render-bundle`

render bundle 预检必须找到 `house.glb`、`render-config.json`、`project-render-facts.json`、`manifest.json`，并校验 manifest 的 `inputFingerprints`、artifact bytes 和 SHA-256 自洽；预检失败不会创建实例或开机。bundle 路径是一次 workflow 的追溯边界：自定义 `--bundle` 必须贯穿 upload → render → fetch，不能让 render 回退到默认 bundle。Blender runtime 的 `config_dir` 统一指向 bundle/project root，配置、材质、贴图、家具和 HDRI 等相对路径都从该 root 解析；manifest 中的输入指纹随渲染传入 `dress_scene.py --manifest`，用于输出 sidecar 追溯。

```bash
PY=.agents/skills/autodl-manager/.venv/bin/python
BLENDER=.agents/skills/autodl-manager/scripts/autodl_blender.py
$PY "$BLENDER" preflight
$PY "$BLENDER" probe INSTANCE_UUID
$PY "$BLENDER" upload INSTANCE_UUID
$PY "$BLENDER" render INSTANCE_UUID
$PY "$BLENDER" fetch INSTANCE_UUID
$PY "$BLENDER" cleanup INSTANCE_UUID
```

一次性任务使用严格顺序：`preflight → create → 轮询 creating/starting 到 running → probe → upload → render → fetch 并校验非空输出 → stop → 可选 release`。`run` 遇到异常或中断会在 finally 至少尝试 stop；fetch 失败绝不 release；变更操作不自动重试。`release` 只有同时传入 `--release-after --confirm-release` 才执行。

render 实际在 `remote_root` 下安全拼装并执行 bundle 内脚本，例如：
`/root/blender/blender -b --python tmp/final-render-bundle/scripts/blender/dress_scene.py -- --glb tmp/final-render-bundle/house.glb --config tmp/final-render-bundle/render-config.json --manifest tmp/final-render-bundle/manifest.json --engine CYCLES --out-dir tmp/cycles --version cycles-final --config-dir tmp/final-render-bundle --res 35`。命令先在 `remote_root` 下 `cd`，因此 bundle、脚本和输出均使用同一组远端相对路径；`--config-dir` 是 bundle root，而非 `bundle/config`。输出使用显式 `out-dir/version` 目录；fetch 默认只下载该 version 目录，并拒绝非空本地目标，避免混入旧 PNG。workflow 不清理整个 `remote_root`，也不默认删除用户目录。

## 费用与生命周期最佳实践

- `running` 会产生 GPU 按量费用；完成工作后应尽快 `stop`。
- `shutdown/stopped` 通常停止 GPU 按量费用，但实例和系统盘仍保留，可能继续产生系统盘托管费。
- 不再需要实例时，先确认上传/下载已完成，再 `stop`，最后在用户明确确认后 `release`；`release` 会永久清除实例数据且不可恢复。
- 临时任务流程固定为：创建 → 等待 running → 上传 → exec → 下载并校验结果 → stop → 可选 release。
- 不把 Pro API 的弹性部署库存当作 Pro 实例库存；官方 Pro API 没有可靠的 Pro 实时库存查询。
- 每次开机或 SSH/SFTP 操作都重新获取 snapshot，不能缓存端口、地址或密码。
- 创建和开机后要轮询状态；`running` 不一定代表 SSH 服务已经就绪，应对 snapshot 和 SSH 连接做有限重试。
- `autodl_blender.py run` 自带 finally cleanup：失败或中断至少 stop；只有输出已成功 fetch 且显式双重确认时才 release。

## 官方接口映射

| 命令 | 方法 | 路径 |
|---|---|---|
| `create` | POST | `/api/v1/dev/instance/pro/create` |
| `info` | GET | `/api/v1/dev/instance/pro/snapshot?instance_uuid=UUID` |
| `status` | GET | `/api/v1/dev/instance/pro/status?instance_uuid=UUID` |
| `ls` | POST | `/api/v1/dev/instance/pro/list` |
| `start` | POST | `/api/v1/dev/instance/pro/power_on`，payload=`gpu` |
| `stop` | POST | `/api/v1/dev/instance/pro/power_off` |
| `release` | POST | `/api/v1/dev/instance/pro/release` |
| `save-image` | POST | `/api/v1/dev/instance/pro/image/save` |
| `images` | POST | `/api/v1/dev/instance/pro/image/private/list` |

GET 查询使用 query 参数 `instance_uuid`。官方响应必须 HTTP 2xx 且 `code == "Success"`。

## 安全限制

不要在命令、日志或输出中打印 root password、Jupyter token、API token、cookie。SSH `exec` 只执行用户明确传入的命令字符串；不会提供交互式 shell。Blender wrapper 不使用 `shell=True`，并限制远端命令、上传根目录和上传白名单。官方 Pro API 没有 TTL 或自动释放接口，因此 workflow 必须依靠 finally cleanup；完成下载校验后按需显式 release。
