import { MODEL_PACKAGE_LINKS_PATH, loadModelPackageLinks } from '../../../server/model-package-links.js';

/**
 * 构件包 ↔ 模型交叉索引的死引用检查（model-package-links）。
 *
 * 为什么需要它：`server/model-package-links.ts` 的 `assertSelector` **早在代码里**，
 * 但它只在 `loadModelPackageLinks()` 被调用时才跑——而全仓只有 `server/routes.ts` 的
 * `/api/project` 一个调用方。于是「selector 引用了已删除的 type / id / collection」
 * 这类腐烂**平时完全不显形**，只在有人请求 `/api/project` 的那一刻炸成 500。
 *
 * 已实测的复发（同一失效模式三次，见 tests/server/model-package-links.test.ts）：
 *   wall_lamp（2026-10-12 删主卧壁灯）→ track_light（2026-10-13 删客厅轨道灯）
 *   → led_strip（2026-10-13 删电视墙灯带）。
 * 每一次都是「删了 config 里的东西、忘了同步 selector」，而门禁看不见，
 * 只能靠一个无关的 API 测试变红来暗示。本 verifier 把这条不变量搬到 `verify:all`
 * 里：**每次全量门禁都真的 load 一次**，腐烂在本地/CI 当场报名字，不等 500。
 *
 * 这里刻意不重复实现任何校验逻辑——全部委托给 `loadModelPackageLinks()`：
 * 校验规则只有一份，在 server 侧；本脚本只负责「在门禁里调它」加 CLI 契约。
 *
 * CLI 契约与 verify:penetration / verify:finish-scope 一致：
 * `--json` 不含时间戳、issue 按 `code/entity/message` 稳定排序；errors > 0 → exit 1。
 *
 * 注意 cwd：`loadModelPackageLinks` 的 authorities 读的是 cwd 相对路径，所以本脚本
 * 必须在仓库根执行（`verify:all` 正是以 ROOT 为 cwd spawn 的）。
 */

interface LinkIssue {
  level: 'error' | 'warning';
  code: string;
  entity: string;
  source: string;
  message: string;
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  const issues: LinkIssue[] = [];

  let links = 0;
  let selectors = 0;
  let authorities = 0;
  try {
    const parsed = loadModelPackageLinks(MODEL_PACKAGE_LINKS_PATH);
    links = parsed.links.length;
    selectors = parsed.links.reduce((sum, link) => sum + (link.scope ?? []).length, 0);
    authorities = Object.keys(parsed.authorities).length;
  } catch (error) {
    // 装载失败 = 有死引用（或配置不可解析）。**必须红**：这个 throw 原本只在
    // /api/project 请求路径上发生，是「平时绿、请求时 500」的典型形态。
    issues.push({
      level: 'error',
      code: 'model_package_links_unresolvable',
      entity: 'CONFIG',
      source: MODEL_PACKAGE_LINKS_PATH,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  if (links === 0 && issues.length === 0) {
    // 没有 link 的索引等于没有索引：静默通过会让「删空文件」看起来像没问题。
    issues.push({
      level: 'error',
      code: 'model_package_links_empty',
      entity: 'CONFIG',
      source: MODEL_PACKAGE_LINKS_PATH,
      message: `${MODEL_PACKAGE_LINKS_PATH} 解析成功但没有任何 link——空索引不提供任何交叉引用`,
    });
  }

  const sorted = [...issues].sort(
    (a, b) => a.code.localeCompare(b.code) || a.entity.localeCompare(b.entity) || a.message.localeCompare(b.message),
  );
  const errors = sorted.filter((issue) => issue.level === 'error');
  const warnings = sorted.filter((issue) => issue.level === 'warning');

  const output = JSON.stringify({
    version: 1,
    config: MODEL_PACKAGE_LINKS_PATH,
    counts: { errors: errors.length, warnings: warnings.length, info: sorted.length - errors.length - warnings.length },
    inputs: { links, selectors, authorities },
    issues: sorted,
  }, null, 2);

  if (args.has('--json')) console.log(output);
  else {
    console.log(`Model-package-links lint: ${errors.length} error(s), ${warnings.length} warning(s)`);
    console.log(`  ${MODEL_PACKAGE_LINKS_PATH}: ${links} link(s), ${selectors} selector(s), ${authorities} authority doc(s)`);
    for (const issue of sorted) {
      const mark = issue.level === 'error' ? 'x' : '!';
      console.log(`  ${mark} [${issue.code}] ${issue.entity}: ${issue.message}`);
    }
  }
  if (errors.length > 0) process.exitCode = 1;
}

main();
