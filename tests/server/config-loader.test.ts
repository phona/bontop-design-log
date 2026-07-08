import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigLoader, ConfigRegistry } from '../../server/config-loader.js';

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
});
