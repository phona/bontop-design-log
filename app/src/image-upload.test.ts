import { describe, it, expect, afterEach } from 'vitest';
import { safeEvidenceFilename, nextUploadNonce, planCompression, compressImageFile, isAnimatedImageBytes } from './image-upload';

// canvas 真实压缩路径（createImageBitmap → canvas 缩放 → toBlob JPEG 重编码）jsdom 跑不了：
// jsdom 不实现 createImageBitmap，HTMLCanvasElement.toBlob 也没有编码器实现。这里**不
// mock 造假**，只覆盖纯函数与「没有 createImageBitmap 时回落原字节 / 回落仍超限明确报错」
// 的真实路径。
//
// 合并前真实浏览器验证（codex 复审 major 要求，2026-11-04 由验收代理在 PR #85 worktree
// 上实测通过，agent-browser session bontop-issue85-verify，自有端口 4104/5177）：
//   3.96MB 手机大图 → 201，请求体 174,833 字节，暂存 131,048 字节 1600×1200（第一档）；
//   29.4MB 噪声图 → 201，暂存 384,800 字节 1200×1200（第二档降档被触发，文件尺寸实证）；
//   420KB PDF → 201 原样字节一致；同一检查 4 个文件共存 nonce 全存活。全程无 413。
// 截图与请求/响应记录在 tmp/capture/（过程物，不进 git）。

const globalWithBitmap = globalThis as {createImageBitmap?: unknown};
const savedCreateImageBitmap = globalWithBitmap.createImageBitmap;

afterEach(() => {
  if (savedCreateImageBitmap === undefined) delete globalWithBitmap.createImageBitmap;
  else globalWithBitmap.createImageBitmap = savedCreateImageBitmap;
});

describe('safeEvidenceFilename（issue #70）', () => {
  it('已安全的名字原样返回', () => {
    expect(safeEvidenceFilename('a.jpg')).toBe('a.jpg');
    expect(safeEvidenceFilename('wall-tile_01.png')).toBe('wall-tile_01.png');
  });

  it('中文名（微信保存）逐字符替换为 _，扩展名保留', () => {
    expect(safeEvidenceFilename('微信图片_20261029123456.jpg')).toBe('_____20261029123456.jpg');
  });

  it('空格 / 括号等白名单外字符统一替换为 _', () => {
    expect(safeEvidenceFilename('my photo (1).png')).toBe('my_photo__1_.png');
  });

  it('无扩展名 / 大写扩展名 / 证据类扩展名保留 / 可执行档丢弃', () => {
    expect(safeEvidenceFilename('photo')).toBe('photo');
    expect(safeEvidenceFilename('A.JPG')).toBe('A.jpg');
    expect(safeEvidenceFilename('B.JPEG')).toBe('B.jpeg');
    // codex 复审 minor：原样回传的附件保留扩展名——服务端只校验字符集不判断内容，
    // 落定后业主要靠扩展名认格式（report.pdf 早先会被剥成 report-<nonce>）
    expect(safeEvidenceFilename('report.pdf')).toBe('report.pdf');
    expect(safeEvidenceFilename('scan.heic')).toBe('scan.heic');
    expect(safeEvidenceFilename('clip.MP4')).toBe('clip.mp4');
    // 白名单外（可执行档等）仍整段丢掉
    expect(safeEvidenceFilename('evil.exe')).toBe('evil');
    expect(safeEvidenceFilename('photo.')).toBe('photo');
  });

  it('stem 净化后为空 → photo-<UTC yyyymmdd-hhmmss>', () => {
    expect(safeEvidenceFilename('.jpg')).toMatch(/^photo-\d{8}-\d{6}\.jpg$/);
    expect(safeEvidenceFilename('')).toMatch(/^photo-\d{8}-\d{6}$/);
    // .gitignore 形：最后一个 . 在首位 → stem 空 → 兜底，且扩展名不在白名单被丢掉
    expect(safeEvidenceFilename('.gitignore')).toMatch(/^photo-\d{8}-\d{6}$/);
  });

  it('超长截断 stem、保扩展名，总长 64', () => {
    const longPng = safeEvidenceFilename(`${'x'.repeat(100)}.png`);
    expect(longPng).toBe(`${'x'.repeat(60)}.png`);
    expect(longPng.length).toBe(64);
    const longNoExt = safeEvidenceFilename('y'.repeat(100));
    expect(longNoExt).toBe('y'.repeat(64));
    expect(longNoExt.length).toBe(64);
  });

  it('路径样名字只取 basename（正斜杠 / 反斜杠 / ../ 都切）', () => {
    expect(safeEvidenceFilename('../../etc/passwd')).toBe('passwd');
    expect(safeEvidenceFilename('a/b/c.jpg')).toBe('c.jpg');
    expect(safeEvidenceFilename('C:\\Users\\me\\photo.jpg')).toBe('photo.jpg');
  });

  it('结果不以 . 开头', () => {
    // .hidden.txt：前导 . 剥掉、.txt 在白名单内保留（证据类扩展名）
    expect(safeEvidenceFilename('.hidden.txt')).toBe('hidden.txt');
    expect(safeEvidenceFilename('..jpg')).toMatch(/^photo-\d{8}-\d{6}\.jpg$/);
    expect(safeEvidenceFilename('..')).toMatch(/^photo-\d{8}-\d{6}$/);
  });

  it('脏名批量不变量：非空、无路径分隔符、不以 . 开头、长度 ≤64、服务端白名单可接受', () => {
    const dirty = [
      '', ' ', '.', '..', '.jpg', '..jpg', '.gitignore', '.hidden.txt',
      '微信图片_20261029123456.jpg', 'my photo (1).png', 'report.pdf', 'photo.',
      '../../etc/passwd', 'C:\\Users\\me\\photo.jpg', `${'x'.repeat(100)}.png`,
      'a/b/c.jpg', '\t\n', '...', 'a..b.jpg', 'photo.jpg.jpg',
    ];
    for (const name of dirty) {
      const safe = safeEvidenceFilename(name);
      expect(safe, `name=${JSON.stringify(name)}`).not.toBe('');
      expect(safe.includes('/'), name).toBe(false);
      expect(safe.includes('\\'), name).toBe(false);
      expect(safe.startsWith('.'), name).toBe(false);
      expect(safe.length, name).toBeLessThanOrEqual(64);
      // server/acceptance-draft-store.ts:113 的落盘白名单，前端净化结果必须直接通过
      expect(/^[\w.-]+$/.test(safe), `whitelist: ${safe}`).toBe(true);
    }
  });

  it('nonce：同一检查的多张照片不撞暂存路径（中文名净化后都成 __）', () => {
    // codex 复审 major：「客厅.jpg」「厨房.jpg」不带 nonce 都会净化成 __.jpg——
    // 服务端 stageEvidence 按名覆盖暂存、finalize 拒重名，第二张会顶掉/传不进第一张
    expect(safeEvidenceFilename('客厅.jpg')).toBe('__.jpg');
    expect(safeEvidenceFilename('厨房.jpg')).toBe('__.jpg');
    // 带不同 nonce 即区分；nonce 里的白名单外字符同样被净化
    expect(safeEvidenceFilename('客厅.jpg', 'aaa1')).toBe('__-aaa1.jpg');
    expect(safeEvidenceFilename('厨房.jpg', 'bbb2')).toBe('__-bbb2.jpg');
    expect(safeEvidenceFilename('客厅.jpg', 'x y')).toBe('__-x_y.jpg');
    // nextUploadNonce 连续两次不同（同一次会话内唯一）
    const first = nextUploadNonce();
    const second = nextUploadNonce();
    expect(first).not.toBe(second);
    expect(safeEvidenceFilename('客厅.jpg', first)).not.toBe(safeEvidenceFilename('厨房.jpg', second));
  });

  it('nonce 在长名下不被截断削掉（codex 复审 blocking：先预留再截断）', () => {
    // 60×x 的 stem 逼近 64 上限：若先拼 nonce 再从尾部截断，nonce 正好被削掉，
    // 不同 nonce 的结果仍旧相同 → 暂存路径互撞、防碰撞静默失效
    const first = safeEvidenceFilename(`${'x'.repeat(60)}-first.jpg`, 'nonce-a');
    const second = safeEvidenceFilename(`${'x'.repeat(60)}-second.jpg`, 'nonce-b');
    expect(first).not.toBe(second);
    expect(first.length).toBeLessThanOrEqual(64);
    expect(second.length).toBeLessThanOrEqual(64);
    expect(first.endsWith('-nonce-a.jpg')).toBe(true);
    expect(second.endsWith('-nonce-b.jpg')).toBe(true);
    // 服务端落盘白名单
    expect(/^[\w.-]+$/.test(first)).toBe(true);
    expect(/^[\w.-]+$/.test(second)).toBe(true);
  });

  it('forceExtension：压缩结果是 JPEG，.png 源也落 .jpg；未压缩回落保持原扩展名', () => {
    expect(safeEvidenceFilename('shot.png', undefined, 'jpg')).toBe('shot.jpg');
    expect(safeEvidenceFilename('shot.PNG', 'n1', 'JPG')).toBe('shot-n1.jpg');
    // 非白名单的强制扩展名被忽略，回落原扩展名逻辑
    expect(safeEvidenceFilename('shot.png', undefined, 'exe')).toBe('shot.png');
    // 无扩展名 + 强制 jpg → 补 .jpg
    expect(safeEvidenceFilename('photo', 'n1', 'jpg')).toBe('photo-n1.jpg');
  });
});

describe('planCompression（issue #70）', () => {
  it('非图片不压（type 优先于体积）', () => {
    expect(planCompression({type: 'application/pdf', size: 5_000_000})).toEqual({compress: false, reason: '非图片'});
    expect(planCompression({type: '', size: 5_000_000})).toEqual({compress: false, reason: '非图片'});
  });

  it('≤400KB 不压（边界含 400000）', () => {
    expect(planCompression({type: 'image/jpeg', size: 400_000})).toEqual({compress: false, reason: '已够小'});
    expect(planCompression({type: 'image/png', size: 1})).toEqual({compress: false, reason: '已够小'});
  });

  it('超过 400KB 的图片要压', () => {
    expect(planCompression({type: 'image/jpeg', size: 400_001}).compress).toBe(true);
    expect(planCompression({type: 'image/jpeg', size: 2_500_000}).compress).toBe(true);
  });
});

describe('isAnimatedImageBytes（codex 复审 major：动图不压）', () => {
  const webp = (animFlag: boolean): Uint8Array => {
    const bytes = new Uint8Array(32).fill(0);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
    bytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
    bytes.set([0x56, 0x50, 0x38, 0x58], 12); // VP8X
    bytes[20] = animFlag ? 0x02 : 0x00; // VP8X 标志字节 bit1 = ANIM
    return bytes;
  };

  it('GIF 恒判动图（GCE 计数不可靠：GCE 是可选块，多帧也可只有 0/1 个）', () => {
    // codex 复审 blocking：GIF89a 规范 §23——GCE 每帧可选。按 GCE 计数判多帧会把
    // 「只有一个 GCE 的多帧 GIF」误判静态而压成单帧。取舍：GIF 一律不压（大 GIF
    // 基本都是动图；静态大 GIF 只损失压缩率，仍受请求体上限保护）。
    const gif = (gceCount: number): Uint8Array => {
      const bytes = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
      const gce = [0x21, 0xf9, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00];
      for (let i = 0; i < gceCount; i += 1) bytes.push(...gce);
      return new Uint8Array(bytes);
    };
    expect(isAnimatedImageBytes('image/gif', gif(0))).toBe(true);
    expect(isAnimatedImageBytes('image/gif', gif(1))).toBe(true); // 单 GCE 多帧：旧实现的漏判场景
    expect(isAnimatedImageBytes('image/gif', gif(5))).toBe(true);
    // 空字节/坏字节同样不压（保守方向）
    expect(isAnimatedImageBytes('image/gif', new Uint8Array(0))).toBe(true);
  });

  it('WebP：VP8X 动画标志位判定，非 VP8X（损失式 VP8 ）判静态', () => {
    expect(isAnimatedImageBytes('image/webp', webp(true))).toBe(true);
    expect(isAnimatedImageBytes('image/webp', webp(false))).toBe(false);
    const lossy = webp(false);
    lossy.set([0x56, 0x50, 0x38, 0x20], 12); // VP8 损失式，非 VP8X
    expect(isAnimatedImageBytes('image/webp', lossy)).toBe(false);
  });

  it('PNG：存在 acTL 动画块判 APNG 动图，普通 PNG 判静态', () => {
    // codex 复审 blocking：PNG 支持 acTL 声明的多帧动画（W3C PNG 规范），且 MIME 通常
    // 还是 image/png——不检测就会把动画 PNG 压成单帧，证据静默丢帧
    const png = (withActl: boolean): Uint8Array => {
      const bytes = new Uint8Array(64).fill(0);
      bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // PNG 签名
      if (withActl) bytes.set([0x61, 0x63, 0x54, 0x4c], 20); // acTL 块类型
      return bytes;
    };
    expect(isAnimatedImageBytes('image/png', png(true))).toBe(true);
    expect(isAnimatedImageBytes('image/apng', png(true))).toBe(true);
    expect(isAnimatedImageBytes('image/png', png(false))).toBe(false);
  });

  it('JPEG 与静态 PNG/HEIC 无多帧动画形态，false', () => {
    expect(isAnimatedImageBytes('image/jpeg', new Uint8Array([0xff, 0xd8, 0xff]))).toBe(false);
    expect(isAnimatedImageBytes('image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(isAnimatedImageBytes('image/heic', new Uint8Array([0x00, 0x00, 0x00, 0x18]))).toBe(false);
  });

  it('gif 在白名单内：原样回传的动图证据保留扩展名（codex 复审 minor）', () => {
    expect(safeEvidenceFilename('fault.gif', 'n1')).toBe('fault-n1.gif');
    expect(safeEvidenceFilename('clip.GIF')).toBe('clip.gif');
  });
});

describe('compressImageFile（issue #70，jsdom 回落路径）', () => {
  it('小图跳过压缩，原样回传 dataURL 逗号后段', async () => {
    const file = new File(['fake-image-bytes'], 'a.jpg', {type: 'image/jpeg'});
    const result = await compressImageFile(file);
    expect(result).toEqual({base64: btoa('fake-image-bytes'), byteLength: 16, compressed: false});
  });

  it('delete globalThis.createImageBitmap 后大文件回落原字节', async () => {
    delete globalWithBitmap.createImageBitmap;
    const bytes = new Uint8Array(500_001);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 251;
    const file = new File([bytes], 'big.jpg', {type: 'image/jpeg'});
    const result = await compressImageFile(file);
    expect(result.compressed).toBe(false);
    expect(result.byteLength).toBe(500_001);
    // 原字节：base64 解回来长度一致，抽样校验内容（回落没有被压缩改写）
    const decoded = atob(result.base64);
    expect(decoded.length).toBe(500_001);
    expect(decoded.charCodeAt(0)).toBe(0);
    expect(decoded.charCodeAt(250)).toBe(250);
    expect(decoded.charCodeAt(500_000)).toBe(500_000 % 251);
  });

  it('回落路径下按完整请求体判定：700KB 传得上去，800KB 明确报错', async () => {
    // codex 复审 minor：700,000 字节 base64 = 933,336 字符 + JSON 开销 ≈933,436 <
    // 1,048,576，服务端收得下——早先把压缩目标 900k 错当成原样上传硬限误拒了它。
    // 没有 createImageBitmap（老浏览器/jsdom）时压不了，700KB 必须放行。
    delete globalWithBitmap.createImageBitmap;
    const ok = new File([new Uint8Array(700_000)], 'report.pdf', {type: 'application/pdf'});
    const okResult = await compressImageFile(ok);
    expect(okResult.compressed).toBe(false);
    expect(okResult.base64.length).toBe(933_336);

    // 800,000 字节 → base64 1,066,672 字符 + JSON 开销 > 1,048,576：服务端必 413，
    // 必须在客户端就给出人能看懂的错，而不是白传一次 413 HTML。
    const tooBig = new File([new Uint8Array(800_000)], 'big.pdf', {type: 'application/pdf'});
    await expect(compressImageFile(tooBig)).rejects.toThrow(/文件约 \d+KB 超过上传上限/);
  });

  it('动图（GIF 多帧）不压缩：原字节回传，后续帧不丢', async () => {
    // codex 复审 major：canvas 单帧重编码会把动图压成静帧——证据要展示设备动作/故障
    // 过程时后续帧全丢。>400KB 的多帧 GIF 必须原样回传。
    const gce = [0x21, 0xf9, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00];
    const bytes = new Uint8Array(500_000);
    bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
    for (let frame = 0; frame < 3; frame += 1) bytes.set(gce, 100 + frame * 1000);
    const file = new File([bytes], 'fault.gif', {type: 'image/gif'});
    const result = await compressImageFile(file);
    expect(result.compressed).toBe(false);
    expect(result.byteLength).toBe(500_000);
    expect(result.base64.length).toBe(666_668); // 原字节：没被重编码
  });
});
