// 证据上传硬化（issue #70，2026-11-04）。
//
// 问题：手机拍照 2-5MB → readAsDataURL 的 base64 膨胀约 33% → body 4-7MB，而
// server/index.ts 的 express.json({limit:'1mb'}) 直接 413；超限走 express 默认 HTML
// 错误页，前端只剩「HTTP 413」没有重试引导。微信保存的中文名 / 带空格名也过不了
// server/acceptance-draft-store.ts:113 的文件名白名单 /^[\w.\-]+$/（400）。
//
// 本模块把上传前的三步 hardening 收在一处：
//   1. safeEvidenceFilename——纯函数，把任意文件名净化成服务端白名单可接受的安全名；
//   2. planCompression——纯函数，按 MIME 与体积决定压不压；
//   3. compressImageFile——需要压且浏览器有 createImageBitmap 时走 canvas 等比缩放 +
//      JPEG 重编码；老浏览器 / jsdom / 任何压缩异常都回落 readAsDataURL 原字节
//      （绝不为压缩失败抛错），只有「压缩后仍 >900KB」这一个显式失败会 throw。
//
// canvas 真实执行路径（createImageBitmap → toBlob）jsdom 跑不了，留给合入后浏览器实测；
// 单测只覆盖纯函数与回落路径（见 image-upload.test.ts 头注）。

/** 低于该体积不压（base64 膨胀 33% 后仍稳在 1MB 上限内）。 */
const COMPRESS_THRESHOLD_BYTES = 400_000;
/** 压缩后最长边上限（等比缩放，不放大）。 */
const MAX_EDGE_PX = 1600;
/** JPEG 重编码质量。 */
const JPEG_QUALITY = 0.72;
/** 压缩结果超过该体积直接报错（base64 膨胀后仍会 413，让用户重拍而不是白传）。 */
const MAX_COMPRESSED_BYTES = 900_000;
/** 净化后文件名总长上限（截断 stem、保扩展名）。 */
const FILENAME_MAX_LENGTH = 64;
/** 只认这几种照片扩展名；其余（.pdf/.heic/无扩展名）丢掉，靠内容而非名字判断类型。 */
const EXTENSION_WHITELIST = new Set(['jpg', 'jpeg', 'png', 'webp']);

export interface CompressedImage {
  /** dataURL 逗号后段（服务端只要 base64 本体）。 */
  base64: string;
  byteLength: number;
  compressed: boolean;
}

/**
 * 把任意文件名净化成服务端白名单可接受的安全名。纯函数。
 *
 * 规则：只取 basename（`/` 与 `\` 都切）；stem 里非 [A-Za-z0-9._-] 的字符统一替换为
 * `_`；扩展名取最后一个 `.` 之后的部分、转小写，只在 {jpg,jpeg,png,webp} 白名单内
 * 保留，否则丢掉；stem 净化后为空（或以 `.` 开头被剥空）则用 photo-<UTC
 * yyyymmdd-hhmmss>；总长限 64（超长截断 stem、保扩展名）。不产出空串、不含路径
 * 分隔符、不以 `.` 开头。
 */
export function safeEvidenceFilename(name: string): string {
  const basename = String(name ?? '').split(/[/\\]/).pop() ?? '';
  const dot = basename.lastIndexOf('.');
  const rawStem = dot >= 0 ? basename.slice(0, dot) : basename;
  const rawExt = dot >= 0 ? basename.slice(dot + 1).toLowerCase() : '';
  const ext = EXTENSION_WHITELIST.has(rawExt) ? rawExt : '';
  const suffix = ext ? `.${ext}` : '';
  // 前导 `.` 剥掉（`.gitignore` / `..jpg` 形不得以 . 开头）；剥空则走 photo- 兜底
  const stem = rawStem.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  if (stem === '') return `photo-${utcStamp()}${suffix}`;
  const maxStem = FILENAME_MAX_LENGTH - suffix.length;
  return `${stem.length > maxStem ? stem.slice(0, maxStem) : stem}${suffix}`;
}

/** UTC yyyymmdd-hhmmss（app 代码可以用 Date）。 */
function utcStamp(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
}

/**
 * 按 MIME 与体积决定压不压。纯函数：非 image/ 不压；≤400KB 不压；否则压。
 */
export function planCompression(file: {type: string; size: number}): {compress: boolean; reason: string} {
  if (!file.type.startsWith('image/')) return {compress: false, reason: '非图片'};
  if (file.size <= COMPRESS_THRESHOLD_BYTES) return {compress: false, reason: '已够小'};
  return {compress: true, reason: `超过 ${COMPRESS_THRESHOLD_BYTES} 字节，需压缩`};
}

/**
 * 读成「服务端要的 base64 本体」：FileReader.readAsDataURL 取逗号后段，字节数取
 * 源体积（Blob.size 精确，无需按 base64 长度反推）。读取失败 reject（界面显示错误，
 * 与旧代码 reader.onerror 的行为一致）。
 */
function readAsBase64(source: Blob, compressed: boolean): Promise<CompressedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const comma = text.indexOf(',');
      const base64 = comma >= 0 ? text.slice(comma + 1) : text;
      resolve({base64, byteLength: source.size, compressed});
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(source);
  });
}

/** canvas 按最长边 1600 等比缩放（不放大）后重编码为 JPEG。任何一步失败都抛给调用方回落。 */
async function downscaleToJpegBlob(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const longestEdge = Math.max(bitmap.width, bitmap.height);
    const scale = longestEdge > MAX_EDGE_PX ? MAX_EDGE_PX / longestEdge : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), 'image/jpeg', JPEG_QUALITY);
    });
    if (!blob) throw new Error('canvas.toBlob 返回空');
    return blob;
  } finally {
    bitmap.close();
  }
}

/**
 * 证据图片上传前处理：按 planCompression 决定不压（或老浏览器 / jsdom 没有
 * createImageBitmap）时原样回传；需要压则走 canvas 缩放 + JPEG 重编码。压缩失败
 * （解码失败 / canvas 不可用等）一律回落原图，绝不为压缩失败抛错；只有压缩结果仍
 * >900KB 时 throw（这条错误会显示给用户，UI 据此提示重拍或换角度）。
 */
export async function compressImageFile(file: File): Promise<CompressedImage> {
  const plan = planCompression(file);
  const canCompress = plan.compress && typeof globalThis.createImageBitmap === 'function';
  if (!canCompress) return readAsBase64(file, false);
  let blob: Blob;
  try {
    blob = await downscaleToJpegBlob(file);
  } catch {
    return readAsBase64(file, false);
  }
  if (blob.size > MAX_COMPRESSED_BYTES) {
    throw new Error('照片压缩后仍超过 900KB，请重拍或换角度');
  }
  return readAsBase64(blob, true);
}
