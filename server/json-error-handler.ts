import type { ErrorRequestHandler } from 'express';

/**
 * JSON 错误出口（issue #70，2026-11-04）。
 *
 * 问题：手机上传 2-5MB 照片时 body-parser 超 `express.json({limit:'1mb'})`
 * （server/index.ts）抛 PayloadTooLargeError（err.type === 'entity.too.large'），
 * express 默认错误页是 HTML，前端只剩「HTTP 413」、没有重试引导。这里把超限转成
 * 413 JSON，detail 写清「照片已自动压缩；仍超限请重拍或换角度」。
 *
 * 其余错误原样 next(err) 交给既有错误链，不吞、不改。
 */
export const jsonErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  const type = (err as {type?: unknown} | undefined)?.type;
  if (type === 'entity.too.large') {
    res.status(413).json({
      error: 'payload too large',
      detail: '请求体超过 1MB 上限——照片已自动压缩；仍超限请重拍或换角度',
    });
    return;
  }
  next(err);
};
