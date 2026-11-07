// shared/envelope-sources.ts 来源注册表的回归测试（issue #98 第三阶段 S6）。
//
// 守两件事：
// ① 注册表是「源名 → 权威文件 → objectId 前缀」的唯一真相：反查、单文件约束、
//    YAML 侧（model-package-links authorities / mep-takeoff sources）不许再各抄一份；
// ② 漂移必须炸：把 authorities 的 ceiling 路径改错一个字符，loadModelPackageLinks
//    就要抛错——否则「文件路径构成身份」只是从 6 张表减到 2 张。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  CEILING_SOURCE,
  SOURCE_NAMES,
  SOURCE_PREFIXES,
  SOURCES,
  sourceFile,
  sourceNameOfFile,
} from '../../shared/envelope-sources.js';
import { loadModelPackageLinks, MODEL_PACKAGE_LINKS_PATH } from '../../server/model-package-links.js';
import { parsePendingLedger } from '../../shared/pending-ledger.js';
import { collectKnownTypes, collectElements, ELEMENT_SOURCES } from '../../shared/element-sources.js';

describe('来源注册表（S6）', () => {
  it('五个源的名称/文件/前缀齐备，overlay 是三文件合并文档', () => {
    assert.deepEqual([...SOURCE_NAMES].sort(), ['ceiling', 'electrical', 'hvac', 'overlay', 'plumbing']);
    assert.equal(SOURCES.overlay.files.length, 3, 'overlay = openings + floor-zones + finish-defaults');
    assert.deepEqual([...SOURCES.overlay.files], [
      'config/model/envelope/openings.yaml',
      'config/model/envelope/floor-zones.yaml',
      'config/model/envelope/finish-defaults.yaml',
    ]);
    assert.equal(SOURCES.ceiling.files[0], 'config/model/envelope/ceiling.yaml');
    assert.equal(SOURCE_PREFIXES.ceiling, 'ceiling:');
    assert.equal(SOURCE_PREFIXES.overlay, '', 'overlay 构件的 objectId 是裸 id');
    assert.equal(CEILING_SOURCE, 'ceiling');
  });

  it('sourceFile：单文件源返回路径，多文件源（overlay）调用即抛错', () => {
    assert.equal(sourceFile('ceiling'), 'config/model/envelope/ceiling.yaml');
    assert.equal(sourceFile('electrical'), 'config/electrical.yaml');
    assert.throws(() => sourceFile('overlay'), /合并读取入口/);
  });

  it('sourceNameOfFile：每个在册文件都能反查到源名，目录改名即失效', () => {
    for (const name of SOURCE_NAMES) {
      for (const file of SOURCES[name].files) {
        assert.equal(sourceNameOfFile(file), name, `${file} 应反查到 ${name}`);
      }
    }
    assert.equal(sourceNameOfFile('config/ceiling.yaml'), undefined, 'S1 前的旧路径不在册');
    assert.equal(sourceNameOfFile('config/house.yaml'), undefined, '未登记文件返回 undefined，不许按后缀猜');
  });

  it('element-sources / pending-ledger 的表由注册表派生（不再手抄路径）', () => {
    assert.equal(ELEMENT_SOURCES.ceiling, sourceFile('ceiling'));
    assert.equal(ELEMENT_SOURCES.electrical, sourceFile('electrical'));
    // 台账 target 的文件 → 前缀分类与注册表同源
    const ledger = parsePendingLedger([
      '| # | 数据项 | 填入文件 | 格式 | 当前值 | 精度 | 影响 |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      '| 1 | 测试项 | `config/model/envelope/ceiling.yaml` `ac_living` | — | — | pending | 待业主 |',
      '| 2 | 旧路径项 | `config/ceiling.yaml` `ac_living` | — | — | pending | 待业主 |',
    ].join('\n'));
    assert.equal(ledger.entries.length, 2);
    // 新路径被认成承载构件的 target；旧路径不在册 → 不计入 elementBearingTargets
    assert.equal(ledger.elementBearingTargets, 1);
  });

  it('collectElements 仍按注册表路径采构件（ceiling 前缀不变）', () => {
    const ids = collectElements().map((element) => element.id).filter((id) => id.startsWith('ceiling:'));
    assert.ok(ids.includes('ceiling:ceiling_living'));
    assert.ok(ids.length >= 25, `吊顶分区数应 ≥25，实际 ${ids.length}`);
    assert.ok(collectKnownTypes().has('ac_indoor'));
  });
});

describe('model-package-links authorities 与注册表一致（装载时断言）', () => {
  it('生产配置通过：authorities 的 overlay/ceiling 与注册表逐字相同', () => {
    const parsed = loadModelPackageLinks(MODEL_PACKAGE_LINKS_PATH);
    assert.equal(parsed.authorities.ceiling, SOURCES.ceiling.files[0]);
    assert.deepEqual(parsed.authorities.overlay, [...SOURCES.overlay.files]);
  });

  it('漂移即抛错：改一个字符也要红（报错指明该改注册表还是改登记表）', () => {
    const raw = readFileSync(MODEL_PACKAGE_LINKS_PATH, 'utf8');
    const drifted = raw.replace('ceiling: config/model/envelope/ceiling.yaml', 'ceiling: config/model/envelope/ceiling-typo.yaml');
    assert.notEqual(drifted, raw, '替换必须真的发生（否则本条测试在测空气）');
    const dir = mkdtempSync(path.join(tmpdir(), 's6-links-'));
    const file = path.join(dir, 'model-package-links.yaml');
    writeFileSync(file, drifted, 'utf8');
    assert.throws(() => loadModelPackageLinks(file), /与 shared\/envelope-sources\.ts 注册表不一致/);
  });
});
