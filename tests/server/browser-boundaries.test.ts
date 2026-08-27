import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const forbidden = /\b(window|document|fetch|HTMLCanvasElement|WebGLRenderer)\b/;

test('shared render and CLI sources stay browser-free', async () => {
  const files = [
    'shared/render/SceneBuilder.ts',
    'shared/render/CurtainGeometry.ts',
    'shared/render/FixtureFactory.ts',
    'shared/render/CeilingZoneBuilder.ts',
    'shared/render/uv-utils.ts',
    'shared/render/export-gltf.ts',
    'scripts/cli-glb-builder.ts',
    'scripts/export-glb.ts',
    'scripts/node-gltf-runtime.ts',
  ];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.equal(forbidden.test(source), false, `${file} contains browser-only dependency`);
  }
});

test('shared GLB exporter has no business filtering or app dependency', async () => {
  const source = await readFile('shared/render/export-gltf.ts', 'utf8');
  assert.doesNotMatch(source, /app\/src/);
  assert.doesNotMatch(source, /userData\.type|EXPORT_INCLUDE_TYPES|EXPORT_EXCLUDE_TYPES|whitelist|allowlist|hvac|curtain/i);
});

test('CLI exporter does not import app render code', async () => {
  const source = await readFile('scripts/export-glb.ts', 'utf8');
  assert.doesNotMatch(source, /app\/src/);
});
