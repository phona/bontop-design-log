import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// 只禁 API 使用形态，不禁裸词：FixtureFactory 的零件名/注释含英文单词 window（家电窗格义，如
// espresso-rear-water-tank-window、"smoked rear tank window."）曾被裸词正则误报——标识符与散文里的
// 词不是浏览器依赖；成员访问（window.xxx / window?.xxx / window[...] / window(...)，点号后必跟
// 属性名）、globalThis 引用、typeof 探测与裸全局值引用（if (window) 等代码上下文）才是。
// PR #14 评审补漏：可选链 window?.document 与裸 if (window) 曾绕过上一版正则——下方自检用例双向钉死。
// PR #14 复审补漏：把全局对象当值交出去的写法（return window / () => window）同样是浏览器依赖，
// 旧正则只认成员访问与括号/运算符上下文，这两类裸返回曾整体绕过——一并钉死；零件名
// （window-return-spring 连字符名）与散文注释（return the window 之类隔词提及）仍豁免。
const forbidden = /\b(?:window|document)\s*(?:\.\s*[A-Za-z_$]|\?\s*\.|\[|\()|\bglobalThis\s*\.\s*(?:window|document)\b|\btypeof\s+(?:window|document)\b|[(,=!&|?:;{]\s*(?:window|document)\s*(?:[),;]|&&|\|\||===|!==)|\breturn\s+(?:window|document)\b|=>\s*(?:window|document)\b|\bfetch\s*\(|\bHTMLCanvasElement\b|\bWebGLRenderer\b/;

test('browser-boundary pattern catches usage forms and ignores prose/part names', () => {
  for (const bad of [
    'const w = window?.document;',
    'const b = document?.body;',
    'if (window) { init(); }',
    'if (typeof window !== "undefined") { init(); }',
    'const x = window.location.href;',
    'el.appendChild(document.createElement("canvas"));',
    'const ok = !!window;',
    'function g() { return window; }',
    'function g() { return document; }',
    'const g = () => window;',
    'const g = () => document;',
    'register(() => window)',
  ]) assert.equal(forbidden.test(bad), true, `should catch: ${bad}`);
  for (const ok of [
    "'espresso-rear-water-tank-window'",
    "'ro-purifier-side-window'",
    "'window-return-spring'",
    '// Stainless-steel body, with a dark lower fascia and a smoked rear tank window.',
    '// does not return the window object; returns part geometry only.',
    "const getWindowPart = () => partByName('tank-window');",
  ]) assert.equal(forbidden.test(ok), false, `should ignore: ${ok}`);
});

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
