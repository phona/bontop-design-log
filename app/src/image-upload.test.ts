import { describe, it, expect, afterEach } from 'vitest';
import { safeEvidenceFilename, planCompression, compressImageFile } from './image-upload';

// canvas 真实压缩路径（createImageBitmap → canvas 缩放 → toBlob JPEG 重编码）jsdom 跑不了：
// jsdom 不实现 createImageBitmap，HTMLCanvasElement.toBlob 也没有编码器实现。这里**不
// mock 造假**，只覆盖纯函数与「没有 createImageBitmap 时回落原字节」的真实路径。真实
// 浏览器里的大图缩放 + JPEG 重编码（以及「压缩后仍 >900KB 报错」分支）留给合入后人工
// 实测：桌面 Chrome 与手机微信各选一张 2-5MB 照片，看暂存文件体积、界面反馈与 413 是否
// 消失。

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

  it('无扩展名 / 大写扩展名 / 非白名单扩展名', () => {
    expect(safeEvidenceFilename('photo')).toBe('photo');
    expect(safeEvidenceFilename('A.JPG')).toBe('A.jpg');
    expect(safeEvidenceFilename('B.JPEG')).toBe('B.jpeg');
    // 非白名单扩展名整段丢掉（靠内容判断类型，不靠名字）
    expect(safeEvidenceFilename('report.pdf')).toBe('report');
    expect(safeEvidenceFilename('scan.heic')).toBe('scan');
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
    expect(safeEvidenceFilename('.hidden.txt')).toBe('hidden');
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
});
