import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const testEntry = process.argv[1];
process.argv[1] = 'node-test-runner';
const {
  copyBundleResources,
  PREVIEW_ROOM_ASSET_DIRECTORIES,
  REQUIRED_RESOURCE_FILES,
  parseBuildRenderBundleArgs,
} = await import('./build-render-bundle.js');
if (testEntry !== undefined) process.argv[1] = testEntry;

test('PREVIEW_ROOM_ASSET_DIRECTORIES contains the declared rooms without blenderkit_candidates', () => {
  assert.equal(Object.keys(PREVIEW_ROOM_ASSET_DIRECTORIES).length, 10);
  assert.ok(!Object.hasOwn(PREVIEW_ROOM_ASSET_DIRECTORIES, 'blenderkit_candidates'));
});

test('parseBuildRenderBundleArgs parses --preview-room', () => {
  assert.deepEqual(
    parseBuildRenderBundleArgs(['--preview-room', 'balcony', '--output-dir', 'out']),
    { outputDir: 'out', allowDirty: false, previewRoom: 'balcony' },
  );
});

test('parseBuildRenderBundleArgs rejects an unknown preview room', () => {
  assert.throws(
    () => parseBuildRenderBundleArgs(['--preview-room', 'unknown-room', '--output-dir', 'out']),
    /usage:/,
  );
});

test('parseBuildRenderBundleArgs defaults to formal mode', () => {
  assert.deepEqual(
    parseBuildRenderBundleArgs(['--output-dir', 'out']),
    { outputDir: 'out', allowDirty: false },
  );
});

test('copyBundleResources loads the preview room asset mapping', () => {
  const root = mkdtempSync(join(tmpdir(), 'render-bundle-test-'));
  const outputDir = join(root, 'bundle');
  try {
    for (const path of [
      ...REQUIRED_RESOURCE_FILES,
      'data/render-decision-boards.json',
      'data/presentation-state.json',
      'scripts/blender/materials_from_yaml.py',
      'scripts/blender/wood_texture.py',
      'scripts/blender/blenderkit_packed_pbr.py',
      'scripts/blender/curtain_projection.py',
    ]) {
      const source = join(root, path);
      mkdirSync(join(source, '..'), { recursive: true });
      writeFileSync(
        source,
        path === 'data/render-bundle-assets.json'
          ? JSON.stringify({ schema: 'bontop.render-bundle-assets', version: 1, rooms: { balcony: PREVIEW_ROOM_ASSET_DIRECTORIES.balcony.map((asset) => `assets/furniture/${asset}`) } })
          : 'test',
      );
    }
    for (const directory of ['assets/textures', 'renders/blender/textures', 'hdri']) {
      mkdirSync(join(root, directory), { recursive: true });
      writeFileSync(join(root, directory, 'shared.txt'), 'test');
    }
    for (const asset of PREVIEW_ROOM_ASSET_DIRECTORIES.balcony) {
      mkdirSync(join(root, 'assets/furniture', asset), { recursive: true });
      writeFileSync(join(root, 'assets/furniture', asset, 'asset.blend'), 'test');
    }
    const resources = copyBundleResources(outputDir, root, {
      profile: 'preview',
      room: 'balcony',
      assetDeclaration: { path: 'data/render-bundle-assets.json', version: 1, sha256: 'test' },
    });

    assert.deepEqual(
      resources.map(({ path }) => path).filter((path) => path.startsWith('assets/furniture/')),
      ['assets/furniture/washer/asset.blend', 'assets/furniture/dryer/asset.blend'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('copyBundleResources excludes blenderkit_candidates from preview resources', () => {
  const root = mkdtempSync(join(tmpdir(), 'render-bundle-test-'));
  const outputDir = join(root, 'bundle');
  try {
    for (const path of [
      ...REQUIRED_RESOURCE_FILES,
      'data/render-decision-boards.json',
      'data/presentation-state.json',
      'scripts/blender/materials_from_yaml.py',
      'scripts/blender/wood_texture.py',
      'scripts/blender/blenderkit_packed_pbr.py',
      'scripts/blender/curtain_projection.py',
    ]) {
      const source = join(root, path);
      mkdirSync(join(source, '..'), { recursive: true });
      writeFileSync(
        source,
        path === 'data/render-bundle-assets.json'
          ? JSON.stringify({ schema: 'bontop.render-bundle-assets', version: 1, rooms: { balcony: PREVIEW_ROOM_ASSET_DIRECTORIES.balcony.map((asset) => `assets/furniture/${asset}`) } })
          : 'test',
      );
    }
    for (const directory of ['assets/textures', 'renders/blender/textures', 'hdri']) {
      mkdirSync(join(root, directory), { recursive: true });
      writeFileSync(join(root, directory, 'shared.txt'), 'test');
    }
    mkdirSync(join(root, 'assets/furniture', 'blenderkit_candidates'), { recursive: true });
    writeFileSync(join(root, 'assets/furniture', 'blenderkit_candidates', 'candidate.blend'), 'test');
    for (const asset of PREVIEW_ROOM_ASSET_DIRECTORIES.balcony) {
      mkdirSync(join(root, 'assets/furniture', asset), { recursive: true });
      writeFileSync(join(root, 'assets/furniture', asset, 'asset.blend'), 'test');
    }
    const resources = copyBundleResources(outputDir, root, {
      profile: 'preview',
      room: 'balcony',
      assetDeclaration: { path: 'data/render-bundle-assets.json', version: 1, sha256: 'test' },
    });

    assert.ok(resources.every(({ path }) => !path.includes('blenderkit_candidates')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});