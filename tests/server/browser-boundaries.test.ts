import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// 只禁 API 使用形态，不禁裸词：FixtureFactory 的零件名/注释含英文单词 window（家电窗格义，如
// espresso-rear-water-tank-window、"smoked rear tank window."）曾被裸词正则误报——标识符与散文里的
// 词不是浏览器依赖；成员访问（window.xxx / window[...] / window(...)，点号后必跟属性名）才是。
const forbidden = /\b(?:window|document)\s*(?:\.\s*[A-Za-z_$]|\[|\()|globalThis\s*\.\s*(?:window|document)\b|\bfetch\s*\(|\bHTMLCanvasElement\b|\bWebGLRenderer\b/;

test('shared render and CLI sources stay browser-free', async () => {
  const files = [
    'shared/render/SceneBuilder.ts',
    'shared/render/CurtainGeometry.ts',
    'shared/render/FixtureFactory.ts',
    'shared/render/CeilingZoneBuilder.ts',
    'shared/render/uv-utils.ts',
    'shared/render/export-gltf.ts',
    'scripts/render/glb/cli-glb-builder.ts',
    'scripts/render/glb/export-glb.ts',
    'scripts/render/glb/node-gltf-runtime.ts',
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
  const source = await readFile('scripts/render/glb/export-glb.ts', 'utf8');
  assert.doesNotMatch(source, /app\/src/);
});
