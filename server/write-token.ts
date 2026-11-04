import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RequestHandler } from 'express';

/**
 * 写操作 token 认证（issue #64，2026-11-04 业主拍板）：
 *
 * 1. 一律认证，不豁免：所有 POST/PUT/PATCH/DELETE 必须带 `x-bontop-token` 头
 *    （含跑卡点 / dry_run 预演 / view-context / visual-commands 等状态同步）。
 *    GET 等方法一律不校验。
 * 2. token 固定：加载优先级 `BONTOP_WRITE_TOKEN` 环境变量 > 仓库根
 *    `.bontop-write-token` 文件（不存在则生成 24 字节随机 hex 并以 600 落盘，
 *    之后启动复用）；轮换 = 手动删文件。本机回环同样不免 token
 *    （`--host 0.0.0.0` 手机联调不再静默 403）。
 *
 * 服务端只读路由不受影响；模型配置写路由已按「页面只读铁律」移除，不得恢复。
 */

export const WRITE_TOKEN_HEADER = 'x-bontop-token';
const WRITE_TOKEN_FILE = '.bontop-write-token';
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export type WriteTokenSource = 'env' | 'file' | 'generated';

export interface WriteTokenResolution {
  token: string;
  source: WriteTokenSource;
}

/**
 * 解析写 token。`repoRoot` 默认取进程 cwd（`npm run dev` 从仓库根起服务）。
 * 生成落盘用 600 权限（显式 chmod 防御 umask），内容带尾换行。
 */
export function resolveWriteToken(repoRoot: string = process.cwd()): WriteTokenResolution {
  const fromEnv = process.env.BONTOP_WRITE_TOKEN?.trim();
  if (fromEnv) {
    return { token: fromEnv, source: 'env' };
  }
  const filePath = path.join(repoRoot, WRITE_TOKEN_FILE);
  if (existsSync(filePath)) {
    const fromFile = readFileSync(filePath, 'utf8').trim();
    if (fromFile) {
      return { token: fromFile, source: 'file' };
    }
  }
  const generated = randomBytes(24).toString('hex');
  writeFileSync(filePath, `${generated}\n`, { mode: 0o600 });
  chmodSync(filePath, 0o600);
  return { token: generated, source: 'generated' };
}

/** 恒定时间比较：先各自 sha256 成定长 digest，长度差异不进入计时通道。 */
function safeEqual(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a, 'utf8').digest();
  const digestB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(digestA, digestB);
}

/**
 * 写操作守卫中间件。POST/PUT/PATCH/DELETE 缺头或 token 不符 → 401；
 * 其余方法直接放行。挂在 `express.json()` 之前——被拒的写不解析 body。
 */
export function createWriteTokenGuard(token: string): RequestHandler {
  return (req, res, next) => {
    if (!WRITE_METHODS.has(req.method)) {
      next();
      return;
    }
    const provided = req.header(WRITE_TOKEN_HEADER);
    if (typeof provided !== 'string' || !safeEqual(provided, token)) {
      res.status(401).json({
        error: 'write token required',
        detail: '首次使用请在页面输入 token（服务端日志或 .bontop-write-token）',
      });
      return;
    }
    next();
  };
}
