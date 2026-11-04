import { describe, it, expect, afterEach } from 'vitest';
import { safeEvidenceFilename, nextUploadNonce, planCompression, compressImageFile } from './image-upload';

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

  it('回落路径下编码后仍超限 → 明确报错（不白传一次 413）', async () => {
    // codex 复审 major：服务端 1mb 限整个 JSON 请求体，base64 膨胀 4/3。二进制
    // 700KB → base64 约 933k 字符 + JSON 开销 → 超 1,048,576。没有 createImageBitmap
    // （老浏览器/jsdom）时压不了，必须在这里给出人能看懂的错，而不是让服务端 413 HTML。
    delete globalWithBitmap.createImageBitmap;
    const file = new File([new Uint8Array(700_000)], 'big.jpg', {type: 'image/jpeg'});
    await expect(compressImageFile(file)).rejects.toThrow(/文件约 \d+KB 超过上传上限，且当前浏览器无法压缩/);
  });
});
