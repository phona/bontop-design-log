// config/model-package-links.yaml 的 selector 必须与 config/electrical.yaml 的实测 type 对齐。
//
// 治的失效模式（已复发三次，前两次都只靠 /api/project 返回 500 才暴露）：
//   ① 2026-10-12 DEC-2026-10-12-R1 删主卧两盏壁灯 → wall_lamp 无在役点位 → selector 仍列着它
//   ② 2026-10-13 DEC-2026-10-13-R1 删客厅明装轨道灯 → track_light 无在役点位 → 同上
//   ③ 2026-10-13 DEC-2026-10-13-R5 删电视墙灯带 → led_strip 无在役点位 → 同上
// 每一次都是 assertSelector 抛错 → loadModelPackageLinks 失败 → server/routes.ts 的
// /api/project 500。前两次靠 api.test.ts 的 500 才抓到，等于是「用一个无关测试的失败
// 去暗示一个配置腐烂」，信号太间接。
//
// 本文件把这条不变量提到台面上：删点位 type 后忘了同步 selector，这里直接报名字，
// 不需要人去 grep，也不依赖某个 API 测试恰好也红。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { loadModelPackageLinks } from '../../server/model-package-links.js';

const links = loadModelPackageLinks();
const electrical = parseYaml(readFileSync('config/electrical.yaml', 'utf8')) as Array<{ id: string; type: string }>;

/** config 里真实存在的 electrical type 集合。 */
const liveTypes = new Set(electrical.map((point) => point.type));

describe('model package links ↔ electrical types', () => {
  it('loads without a selector throwing (i.e. /api/project will not 500 on this)', () => {
    // loadModelPackageLinks() 在模块顶层已经跑过一次；能到这里就说明没有 selector 抛错。
    // 保留这个显式断言，是为了让「加载失败」有一个可读的失败点，而不是只看到 import 炸掉。
    assert.ok(links.links.length > 0, 'config/model-package-links.yaml 必须至少有一条 link');
  });

  it('every electrical type named by a selector really exists in config/electrical.yaml', () => {
    const named: Array<{ linkId: string; type: string }> = [];
    for (const link of links.links) {
      for (const ref of link.scope ?? []) {
        if (ref.source !== 'electrical') continue;
        for (const type of ref.select.types ?? []) named.push({ linkId: link.id, type });
      }
    }
    assert.ok(named.length > 0, '至少该有一个 electrical selector 声明 types');
    const orphans = named.filter((entry) => !liveTypes.has(entry.type));
    assert.deepEqual(
      orphans.map((entry) => `${entry.linkId}: ${entry.type}`),
      [],
      'selector 引用了 config/electrical.yaml 里已不存在的 type——删点位类型后必须同步本文件，' +
        '否则 assertSelector 抛错、/api/project 500（wall_lamp / track_light / led_strip 已各犯一次）',
    );
  });

  it('every lighting type actually in use is covered by the PKG-120 vocabulary', () => {
    // 反方向：config 里在用的灯具 type 必须被 PKG-120 的词汇表覆盖，否则一期灯具摆位单会漏构件。
    const pkg120 = links.links.find((link) => link.id === 'MODEL-PKG-120');
    assert.ok(pkg120, 'MODEL-PKG-120 必须存在');
    const vocabulary = new Set(
      (pkg120.scope ?? [])
        .filter((ref) => ref.source === 'electrical')
        .flatMap((ref) => ref.select.types ?? []),
    );
    const lighting = [...liveTypes].filter((type) =>
      ['pendant', 'dome', 'downlight', 'led_strip', 'track_light', 'wall_lamp', 'night_light', 'ceiling_light'].includes(type),
    );
    assert.deepEqual(
      lighting.filter((type) => !vocabulary.has(type)).sort(),
      [],
      'config 里在用的灯具 type 必须都在 MODEL-PKG-120 的词汇表里（漏了就是一期摆位单少一类构件）',
    );
  });
});
