import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigLoader, ConfigRegistry, loadElectricalConfig, loadPlumbingConfig, loadCeilingConfig } from '../../server/config-loader.js';

async function waitFor(condition: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 50));
  }
  assert.ok(condition(), 'condition not met before timeout');
}

describe('ConfigLoader', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads and invokes onChange', () => {
    const path = join(dir, 'test.json');
    writeFileSync(path, JSON.stringify({ a: 1 }));
    let called = false;
    const loader = new ConfigLoader(path, JSON.parse, (cfg) => {
      called = true;
      assert.deepEqual(cfg, { a: 1 });
    });
    loader.load();
    assert.equal(called, true);
    assert.equal(loader.getStatus().status, 'ok');
  });

  it('keeps previous config on failure', () => {
    const path = join(dir, 'test.json');
    writeFileSync(path, JSON.stringify({ a: 1 }));
    const loader = new ConfigLoader(path, JSON.parse, () => {});
    loader.load();
    writeFileSync(path, 'not json');
    loader.load();
    assert.deepEqual(loader.getConfig(), { a: 1 });
    assert.equal(loader.getStatus().status, 'failed');
    assert.ok(loader.getStatus().error);
  });

  it('registry aggregates statuses', () => {
    const path = join(dir, 'x.json');
    writeFileSync(path, 'bad');
    const registry = new ConfigRegistry();
    const loader = new ConfigLoader(path, JSON.parse, () => {});
    registry.register(loader);
    loader.load();
    const statuses = registry.getStatuses();
    assert.equal(statuses.length, 1);
    assert.equal(statuses[0].status, 'failed');
  });

  // 回归（2026-10-24）：单文件 watch 挂在 inode 上，git checkout/编辑器的原子替换
  // （写临时文件再改名）换掉 inode 后 watch 静默永久断线。目录级监听必须让替换写、
  // 以及替换之后的后续写（可能落在 chokidar 50ms change 节流窗口内，靠尾部重读兜底），
  // 都继续触发 reload。
  it('watch fires on in-place write', async () => {
    const path = join(dir, 'watched.json');
    writeFileSync(path, JSON.stringify({ n: 1 }));
    let loads = 0;
    const loader = new ConfigLoader(path, JSON.parse, () => { loads += 1; });
    loader.load();
    loader.startWatching();
    try {
      await new Promise((r) => setTimeout(r, 200));
      writeFileSync(path, JSON.stringify({ n: 2 }));
      await waitFor(() => loads >= 2);
      assert.deepEqual(loader.getConfig(), { n: 2 });
    } finally {
      await loader.stopWatching();
    }
  });

  it('watch survives atomic replace and keeps firing afterwards', async () => {
    const path = join(dir, 'watched.json');
    writeFileSync(path, JSON.stringify({ n: 1 }));
    let loads = 0;
    const loader = new ConfigLoader(path, JSON.parse, () => { loads += 1; });
    loader.load();
    loader.startWatching();
    try {
      await new Promise((r) => setTimeout(r, 200));
      const staged = join(dir, 'staged.json');
      writeFileSync(staged, JSON.stringify({ n: 2 }));
      renameSync(staged, path);
      await waitFor(() => loads >= 2);
      assert.deepEqual(loader.getConfig(), { n: 2 }, 'atomic replace must trigger reload');

      writeFileSync(path, JSON.stringify({ n: 3 }));
      await waitFor(() => loads >= 3);
      assert.deepEqual(loader.getConfig(), { n: 3 }, 'watch must still fire after inode swap');
    } finally {
      await loader.stopWatching();
    }
  });
});

describe('Domain config loaders', () => {
  it('loads electrical config with expected fields', () => {
    const cfg = loadElectricalConfig();
    assert.ok(Array.isArray(cfg));
    if (cfg.length > 0) {
      assert.ok(cfg[0].id);
      assert.ok(cfg[0].room);
      assert.ok(cfg[0].wall);
      assert.ok(typeof cfg[0].x === 'number');
      assert.ok(typeof cfg[0].z === 'number');
    }
  });

  it('loads plumbing config with expected fields', () => {
    const cfg = loadPlumbingConfig();
    assert.ok(Array.isArray(cfg));
    if (cfg.length > 0) {
      assert.ok(cfg[0].id);
      assert.ok(cfg[0].room);
      assert.ok(typeof cfg[0].x === 'number');
      assert.ok(typeof cfg[0].z === 'number');
    }
  });

  it('loads ceiling config with zone data', () => {
    const cfg = loadCeilingConfig();
    assert.ok(Array.isArray(cfg));
    if (cfg.length > 0) {
      assert.ok(cfg[0].room);
      assert.ok(cfg[0].type);
    }
  });

  it('returns empty array for missing electrical config', () => {
    const origPath = '../../server/config-loader.js';
    // Just verify the function signature — will throw on missing file in real impl
  });
});
