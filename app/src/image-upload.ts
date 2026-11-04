// 证据上传硬化（issue #70，2026-11-04）。
//
// 问题：手机拍照 2-5MB → readAsDataURL 的 base64 膨胀约 33% → body 4-7MB，而
// server/index.ts 的 express.json({limit:'1mb'}) 直接 413；超限走 express 默认 HTML
// 错误页，前端只剩「HTTP 413」没有重试引导。微信保存的中文名 / 带空格名也过不了
// server/acceptance-draft-store.ts:113 的文件名白名单 /^[\w.\-]+$/（400）。
//
// 本模块把上传前的三步 hardening 收在一处：
//   1. safeEvidenceFilename——纯函数，把任意文件名净化成服务端白名单可接受的安全名
//      （nonce 保证同一检查多张照片不撞暂存路径，forceExtension 让扩展名跟实际格式一致）；
//   2. planCompression——纯函数，按 MIME 与体积决定压不压；
//   3. compressImageFile——需要压且浏览器有 createImageBitmap 时走压缩阶梯（标准档 →
//      降档）按**编码后 base64 体积**判定（服务端 1mb 限整个 JSON 请求体）；老浏览器 /
//      jsdom / 任何压缩异常都回落 readAsDataURL 原字节（绝不为压缩失败抛错，但编码后
//      超限会明确报错，不白传一次 413）。
//
// canvas 真实执行路径（createImageBitmap → toBlob）jsdom 跑不了，留给合入后浏览器实测；
// 单测只覆盖纯函数与回落路径（见 image-upload.test.ts 头注）。

/** 低于该体积不压（base64 膨胀 33% 后仍稳在 1MB 上限内）。 */
const COMPRESS_THRESHOLD_BYTES = 400_000;
/** 压缩后最长边上限（等比缩放，不放大）。 */
const MAX_EDGE_PX = 1600;
/** JPEG 重编码质量。 */
const JPEG_QUALITY = 0.72;
/**
 * 压缩目标：编码后（base64 字符数）压到这个数以下。服务端 express.json({limit:'1mb'})
 * 限的是**整个 JSON 请求体**：base64 膨胀 4/3 + package_id/check_id/filename 开销，900,000
 * 字符 ≈ 675KB 二进制 + 开销后稳在 1,048,576 字节内（codex 复审 major：早先按二进制
 * 900KB 设限，800KB 图编码后就有 1,066,758 字节，照样 413）。
 */
const MAX_ENCODED_BASE64_CHARS = 900_000;
/**
 * 原样上传（未压缩附件/无压缩能力回落）的硬上限：按**完整 JSON 请求体**算，留出
 * package_id/check_id/filename 与 JSON 结构的开销余量。700,000 字节 PDF 编码后
 * 933,336 字符 + 开销 ≈933,436 < 1,048,576，服务端收得下——codex 复审 minor：早先
 * 把压缩目标 900k 错当成原样上传的硬限，误拒了服务端可接收的附件。
 */
const MAX_REQUEST_BASE64_CHARS = 1_040_000;
/** 压缩阶梯：标准档 → 降档；两档编码后都超限才让用户重拍。 */
const COMPRESS_LADDER: Array<{maxEdge: number; quality: number}> = [
  {maxEdge: MAX_EDGE_PX, quality: JPEG_QUALITY},
  {maxEdge: 1200, quality: 0.5},
];
/** 净化后文件名总长上限（截断 stem、保扩展名）。 */
const FILENAME_MAX_LENGTH = 64;
/**
 * 证据附件扩展名白名单。原样回传的附件（PDF 合同 / 视频 / HEIC 等）保留扩展名——
 * 服务端只校验字符集 `/^[\w.\-]+$/`（acceptance-draft-store.ts:113），不判断内容，
 * 落定后业主要靠扩展名认格式（codex 复审 minor：早先只放行图片扩展名，report.pdf
 * 会被剥成 report-<nonce>）。压缩结果只可能是 JPEG，forceExtension 恒为 jpg。
 */
const EXTENSION_WHITELIST = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'heic', 'gif',
  'pdf', 'doc', 'docx', 'xlsx', 'xls', 'txt', 'csv',
  'mp4', 'mov', 'mkv', 'avi', 'wmv',
]);
/** 同一次会话内的上传计数（与时间戳拼成 nonce，保证净化后文件名不撞车）。 */
let uploadCounter = 0;

export interface CompressedImage {
  /** dataURL 逗号后段（服务端只要 base64 本体）。 */
  base64: string;
  byteLength: number;
  compressed: boolean;
}

/** 下一次上传的唯一 nonce（时间戳 + 会话内计数；暂存区按包/检查隔离，会话内唯一即够）。 */
export function nextUploadNonce(): string {
  uploadCounter += 1;
  return `${Date.now().toString(36)}-${uploadCounter}`;
}

/**
 * 把任意文件名净化成服务端白名单可接受的安全名。纯函数。
 *
 * 规则：只取 basename（`/` 与 `\` 都切）；stem 里非 [A-Za-z0-9._-] 的字符统一替换为
 * `_`；扩展名取最后一个 `.` 之后的部分、转小写，在白名单内保留（图片 + PDF/视频等
 * 常见证据类型；forceExtension 可强制改写，用于压缩后实际格式是 JPEG 的场景）；
 * stem 净化后为空（或以 `.` 开头被剥空）则用 photo-<UTC yyyymmdd-hhmmss>；
 * 传了 nonce 时拼到 stem 末尾（同一检查传多张照片，中文名净化后都成 `__` 会撞
 * 暂存路径并互相覆盖——codex 复审 major）；总长限 64（超长截断 stem、保扩展名）。
 * 不产出空串、不含路径分隔符、不以 `.` 开头。
 */
export function safeEvidenceFilename(name: string, nonce?: string, forceExtension?: string): string {
  const basename = String(name ?? '').split(/[/\\]/).pop() ?? '';
  const dot = basename.lastIndexOf('.');
  const rawStem = dot >= 0 ? basename.slice(0, dot) : basename;
  const rawExt = dot >= 0 ? basename.slice(dot + 1).toLowerCase() : '';
  const forced = (forceExtension ?? '').toLowerCase().replace(/^\./, '');
  const ext = EXTENSION_WHITELIST.has(forced) ? forced : (EXTENSION_WHITELIST.has(rawExt) ? rawExt : '');
  const suffix = ext ? `.${ext}` : '';
  // 前导 `.` 剥掉（`.gitignore` / `..jpg` 形不得以 . 开头）；剥空则走 photo- 兜底
  let stem = rawStem.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  if (stem === '') stem = `photo-${utcStamp()}`;
  const maxStem = FILENAME_MAX_LENGTH - suffix.length;
  if (nonce) {
    // nonce 本身也限长：先给完整 nonce 预留位置、再截断原始 stem——顺序反了会从尾部
    // 把 nonce 削掉，长名下不同 nonce 的结果仍旧相同、防碰撞静默失效（codex 复审
    // blocking：60×x 的 '-first'/'-second' 实测复现）
    const tag = nonce.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, Math.max(1, maxStem - 3));
    const keep = Math.max(1, maxStem - tag.length - 1);
    stem = `${stem.length > keep ? stem.slice(0, keep) : stem}-${tag}`;
  }
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
 * 动图字节级检测（纯函数）。canvas 只画一帧再导 JPEG，会把动图压成单帧——证据要展示
 * 设备动作/故障过程时后续帧全丢（codex 复审 major）。判定：
 *   - GIF：Graphic Control Extension（21 F9 04）≥2 段即多帧；
 *   - WebP：RIFF/WEBP/VP8X 且 VP8X 标志字节 bit 0x02（ANIM）；
 *   - PNG：存在 acTL 动画控制块即 APNG（W3C PNG 规范；codex 复审 blocking——
 *     image/png 与 image/apng 的 MIME 都可能是 image/png，只能按块判定）；
 *   - 其余（JPEG/HEIC 等）无多帧动画形态，false。
 * 读不到字节按动图处理（不压，保守）。
 */
export function isAnimatedImageBytes(type: string, bytes: Uint8Array): boolean {
  try {
    if (type === 'image/gif') {
      let gce = 0;
      for (let i = 0; i + 2 < bytes.length; i += 1) {
        if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) gce += 1;
      }
      return gce >= 2;
    }
    if (type === 'image/webp') {
      if (bytes.length < 21) return false;
      const tag = (offset: number): string => String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
      if (tag(0) !== 'RIFF' || tag(8) !== 'WEBP' || tag(12) !== 'VP8X') return false;
      return (bytes[20] & 0x02) !== 0; // VP8X 首字节：bit1 = ANIMATION_FLAG
    }
    if (type === 'image/png' || type === 'image/apng') {
      // acTL 动画控制块（在首个 IDAT 之前）。块类型是 ASCII，扫到即判动图；压缩数据里
      // 恰好出现同四字节的概率可忽略，且误判的后果只是不压缩（保留原字节，保守方向）。
      const actl = [0x61, 0x63, 0x54, 0x4c]; // 'acTL'
      for (let i = 0; i + 3 < bytes.length; i += 1) {
        if (bytes[i] === actl[0] && bytes[i + 1] === actl[1] && bytes[i + 2] === actl[2] && bytes[i + 3] === actl[3]) return true;
      }
      return false;
    }
    return false;
  } catch {
    return true; // 解析异常按动图处理：不压，保留原字节
  }
}

/** 读文件头做动图检测；读取失败按动图处理（保守：不压）。 */
async function detectAnimation(file: File): Promise<boolean> {
  try {
    const buffer = await file.arrayBuffer();
    return isAnimatedImageBytes(file.type, new Uint8Array(buffer));
  } catch {
    return true;
  }
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

/** canvas 按最长边 maxEdge 等比缩放（不放大）后以 quality 重编码为 JPEG。任何一步失败都抛给调用方回落。 */
async function downscaleToJpegBlob(file: File, maxEdge: number, quality: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const longestEdge = Math.max(bitmap.width, bitmap.height);
    const scale = longestEdge > maxEdge ? maxEdge / longestEdge : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    // 先铺白底再绘图：canvas 默认透明，直接导 JPEG 会把透明区域合成成**黑色**
    // （codex 复审 major：透明底黑字/黑线图的截图类证据会变得不可辨认）
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), 'image/jpeg', quality);
    });
    if (!blob) throw new Error('canvas.toBlob 返回空');
    return blob;
  } finally {
    bitmap.close();
  }
}

/** 原样读取并按**完整请求体**上限校验：超限且无法压缩时给用户明确错误，而不是白传一次 413。 */
async function readOriginalWithinLimit(file: File): Promise<CompressedImage> {
  const original = await readAsBase64(file, false);
  if (original.base64.length > MAX_REQUEST_BASE64_CHARS) {
    const approxKb = Math.round((original.base64.length * 3) / 4 / 1024);
    throw new Error(`文件约 ${approxKb}KB 超过上传上限，且当前浏览器无法压缩——请换一台设备或先用图片工具缩小`);
  }
  return original;
}

/**
 * 证据文件上传前处理：按 planCompression 决定不压（或老浏览器 / jsdom 没有
 * createImageBitmap）时原样回传（按完整请求体上限校验，超限明确报错不白传 413）；
 * 动图（GIF 多帧 / WebP ANIM）不压——canvas 单帧重编码会丢后续帧，证据要展示的
 * 设备动作/故障过程会静默丢失（codex 复审 major）；需要压则走压缩阶梯（标准档 →
 * 降档），**按编码后的 base64 体积判定**——服务端 1mb 限整个 JSON 请求体。压缩失败
 * （解码失败 / canvas 不可用等）一律回落原图，绝不为压缩失败抛错。
 */
export async function compressImageFile(file: File): Promise<CompressedImage> {
  const plan = planCompression(file);
  if (!plan.compress) return readOriginalWithinLimit(file);
  if (await detectAnimation(file)) return readOriginalWithinLimit(file);
  const canCompress = typeof globalThis.createImageBitmap === 'function';
  if (!canCompress) return readOriginalWithinLimit(file);
  for (const tier of COMPRESS_LADDER) {
    let blob: Blob;
    try {
      blob = await downscaleToJpegBlob(file, tier.maxEdge, tier.quality);
    } catch {
      return readOriginalWithinLimit(file);
    }
    const encoded = await readAsBase64(blob, true);
    if (encoded.base64.length <= MAX_ENCODED_BASE64_CHARS) return encoded;
  }
  throw new Error('照片压缩后仍超过上传上限，请重拍或换角度');
}
