// config/model-package-links.yaml 的 selector 必须与 config/electrical.yaml 的实测点位对齐。
//
// 治的失效模式（已复发四次，前三次都只靠 /api/project 返回 500 才暴露）：
//   ① 2026-10-12 DEC-2026-10-12-R1 删主卧两盏壁灯 → wall_lamp 无在役点位 → selector 仍列着它
//   ② 2026-10-13 DEC-2026-10-13-R1 删客厅明装轨道灯 → track_light 无在役点位 → 同上
//   ③ 2026-10-13 DEC-2026-10-13-R5 删电视墙灯带 → led_strip 无在役点位 → 同上
//   ④ 2026-10-16 DEC-2026-10-16-R12 餐厅灯 pendant→ceiling_light
// 每一次都是 assertSelector 抛错 → loadModelPackageLinks 失败 → server/routes.ts 的
// /api/project 500。前两次靠 api.test.ts 的 500 才抓到，等于是「用一个无关测试的失败
// 去暗示一个配置腐烂」，信号太间接。
//
// 本文件把这条不变量提到台面上：删点位后忘了同步 selector，这里直接报名字，
// 不需要人去 grep，也不依赖某个 API 测试恰好也红。
//
// 2026-11-10（issue #191）：electrical 选择器已从 `types` 词汇表改为**在役点位 id 直选**
// （与 PR-4/S6 的 ids 方向一致）。断言随之改为：① 每个被点名的 id 真在 config/electrical.yaml；
// ② 每个在役灯具点位都被 MODEL-PKG-120 的 id 清单覆盖（「删点位后本文件少一件」仍会被抓住）。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { loadModelPackageLinks } from '../../server/model-package-links.js';

const links = loadModelPackageLinks();
const electrical = parseYaml(readFileSync('config/electrical.yaml', 'utf8')) as Array<{ id: string; type: string }>;

/** config 里真实存在的 electrical 点位 id 集合。 */
const liveIds = new Set(electrical.map((point) => point.id));
/** config 里真实存在的 electrical type 集合（反向覆盖断言用）。 */
const liveTypes = new Set(electrical.map((point) => point.type));

describe('model package links ↔ electrical points', () => {
  it('loads without a selector throwing (i.e. /api/project will not 500 on this)', () => {
    // loadModelPackageLinks() 在模块顶层已经跑过一次；能到这里就说明没有 selector 抛错。
    // 保留这个显式断言，是为了让「加载失败」有一个可读的失败点，而不是只看到 import 炸掉。
    assert.ok(links.links.length > 0, 'config/model-package-links.yaml 必须至少有一条 link');
  });

  it('every electrical id named by a selector really exists in config/electrical.yaml', () => {
    const named: Array<{ linkId: string; id: string }> = [];
    for (const link of links.links) {
      for (const ref of link.scope ?? []) {
        if (ref.source !== 'electrical') continue;
        for (const id of ref.select.ids ?? []) named.push({ linkId: link.id, id });
      }
    }
    assert.ok(named.length > 0, '至少该有一个 electrical selector 声明 ids');
    const orphans = named.filter((entry) => !liveIds.has(entry.id));
    assert.deepEqual(
      orphans.map((entry) => `${entry.linkId}: ${entry.id}`),
      [],
      'selector 引用了 config/electrical.yaml 里已不存在的点位 id——删点位后必须同步本文件，' +
        '否则 assertSelector 抛错、/api/project 500（wall_lamp / track_light / led_strip / pendant 的 type 版本已各犯一次）',
    );
  });

  it('every lighting point actually in use is covered by the PKG-120 id list', () => {
    // 反方向：config 里在用的灯具点位必须被 PKG-120 的 id 清单覆盖，否则一期灯具摆位单会漏构件。
    const pkg120 = links.links.find((link) => link.id === 'MODEL-PKG-120');
    assert.ok(pkg120, 'MODEL-PKG-120 必须存在');
    const vocabulary = new Set(
      (pkg120.scope ?? [])
        .filter((ref) => ref.source === 'electrical')
        .flatMap((ref) => ref.select.ids ?? []),
    );
    const lightingTypes = new Set(['pendant', 'dome', 'downlight', 'led_strip', 'track_light', 'wall_lamp', 'night_light', 'ceiling_light']);
    const lighting = electrical.filter((point) => lightingTypes.has(point.type)).map((point) => point.id);
    assert.deepEqual(
      lighting.filter((id) => !vocabulary.has(id)).sort(),
      [],
      'config 里在用的灯具点位必须都在 MODEL-PKG-120 的 id 清单里（漏了就是一期摆位单少一类构件）',
    );
    // type 词汇表断言保留：万一以后有人把 ids 改回 types，这里至少还能指出在役 type 集合。
    assert.ok(liveTypes.size > 0);
  });
});
