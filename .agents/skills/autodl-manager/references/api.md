# AutoDL 容器实例 Pro API 与 SSH/SFTP 参考

官方文档：[instance_pro_api](https://www.autodl.com/docs/instance_pro_api/)

## 配置与认证

项目根 `.env` 默认加载；进程环境变量优先，也可通过 `--env-file PATH` 指定文件。`AUTODL_CONFIG` 可选覆盖 TOML 配置路径。真实 token 不放入 `config.example.toml` 或 `.env.example`。

API Host 默认为 `https://api.autodl.com`。鉴权请求头为 `{"Authorization": token}`，值直接填写 token，不加 `Bearer`。

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

## 安全与工作流

`release` 不可逆，必须 `--confirm-release`，先 snapshot/status，必要时 power_off 并确认停止后才 release。已有实例默认不自动 release。Blender 流程为 start → upload → exec → download → stop → 明确确认后可选 release。
