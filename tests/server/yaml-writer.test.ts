import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeYaml, backupPath } from '../../server/yaml-writer.js';

describe('yaml-writer', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'yaml-writer-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes valid YAML file', async () => {
    const file = join(tmpDir, 'test.yaml');
    const data = { key: 'value', list: [1, 2, 3] };
    await writeYaml(file, data);
    const content = readFileSync(file, 'utf8');
    assert.ok(content.includes('key: value'));
  });

  it('creates a .bak backup before writing', async () => {
    const file = join(tmpDir, 'test.yaml');
    writeFileSync(file, 'original: data\n', 'utf8');
    const data = { key: 'new_value' };
    await writeYaml(file, data);
    assert.ok(existsSync(backupPath(file)));
    const backup = readFileSync(backupPath(file), 'utf8');
    assert.ok(backup.includes('original'));
  });

  it('preserves array structures', async () => {
    const file = join(tmpDir, 'electrical.yaml');
    const data = [
      { id: 'sock_1', room: 'living', type: 'socket', x: 1, z: 2, height: 0.3 },
      { id: 'sock_2', room: 'bedroom', type: 'socket', x: 3, z: 4, height: 0.3 },
    ];
    await writeYaml(file, data);
    const content = readFileSync(file, 'utf8');
    assert.ok(content.includes('sock_1'));
    assert.ok(content.includes('sock_2'));
  });

  it('preserves the room-keyed furnishings structure', async () => {
    const file = join(tmpDir, 'house.yaml');
    const data = {
      furnishings: {
        living_dining: [
          { type: 'sofa_3seat', x: 11, z: 7, rotation: 270 },
          { type: 'tv_stand', x: 7.4, z: 7, rotation: 90 },
        ],
        bedroom_nw: [
          { type: 'bed_180', x: 4.6, z: 2.3, rotation: 270 },
        ],
      },
    };
    await writeYaml(file, data);
    const content = readFileSync(file, 'utf8');
    assert.ok(content.includes('living_dining'));
    assert.ok(content.includes('bed_180'));
  });
});
