import {
  runFinishScopeChecks,
  loadFinishLintConfig,
  CONFIG_PATH,
  type FinishIssue,
} from '../../../shared/finish/registry.js';
// 输入装配唯一实现在 shared/finish/input.ts（verifier 与测试共用，配方来源改了只改一处）
import { buildFinishScopeInput } from '../../../shared/finish/input.js';

/**
 * 面层范围核查（finish-scope）入口：面层声明之间是否互相压、重复、挂错房间。
 *
 * 为什么需要它：漆/砖/防水台/吊顶都是面层声明，各自圈一片墙或一片顶。声明互相压时
 * **面积数字不报错、3D 里也看不出来**——漆是 inspection-only 半透明叠加层，要开
 * 开关转视角，而且「压了 0.3㎡」肉眼判不了。浏览器核对面层归属不可行，必须有一层
 * 专职 linter。
 *
 * CLI 契约与 verify:penetration 一致：`--json` 不含时间戳、issue 按
 * `code/entity/message` 稳定排序；errors > 0 → exit 1。
 */

/**
 * 豁免到期用的「今天」。与 verify:penetration 一致提供 `--today YYYY-MM-DD`：
 * 否则同一份配置在不同日子跑出不同结论（到期豁免复活），输出不可复现、也没法写进
 * 需要固定日期的回归测试。不给参数时用系统当天。
 */
function resolveToday(): string {
  const index = process.argv.indexOf('--today');
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      console.error('verify:finish-scope --today requires YYYY-MM-DD');
      process.exitCode = 2;
      return '1970-01-01';
    }
    return value;
  }
  return new Date().toISOString().slice(0, 10);
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  const today = resolveToday();
  const issues: FinishIssue[] = [];

  let input;
  try {
    input = buildFinishScopeInput();
  } catch (error) {
    console.error(`finish-scope: 权威配置读不动时必须红——${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  const result = runFinishScopeChecks(input, today, loadFinishLintConfig());
  issues.push(...result.registryIssues, ...result.issues);

  const sorted = [...issues].sort((a, b) => a.code.localeCompare(b.code) || a.entity.localeCompare(b.entity) || a.message.localeCompare(b.message));
  const errors = sorted.filter((issue) => issue.level === 'error');
  const warnings = sorted.filter((issue) => issue.level === 'warning');
  const infos = sorted.filter((issue) => issue.level === 'info');

  const output = JSON.stringify({
    version: 1,
    config: CONFIG_PATH,
    counts: { errors: errors.length, warnings: warnings.length, info: infos.length },
    inputs: {
      wallFinishDeclarations: input.walls.length,
      sillFinishDeclarations: input.sills.length,
      ceilingZones: (input.ceilings ?? []).length,
      openings: (input.openings ?? []).length,
      ceilingPaintRooms: [...(input.ceilingPaintRooms ?? [])].length,
      rooms: input.rooms.length,
      walls: Object.keys(input.wallGeometry).length,
      sceneMeshes: input.sceneMeshes?.length ?? 0,
      bayFootprints: input.sceneBayOutlines?.size ?? 0,
    },
    issues: sorted,
  }, null, 2);

  if (args.has('--json')) console.log(output);
  else {
    console.log(`Finish-scope lint: ${errors.length} error(s), ${warnings.length} warning(s), ${infos.length} info`);
    for (const issue of sorted) {
      const mark = issue.level === 'error' ? 'x' : issue.level === 'warning' ? '!' : '.';
      console.log(`  ${mark} [${issue.code}] ${issue.entity}: ${issue.message}`);
    }
  }
  if (errors.length > 0) process.exitCode = 1;
}

main();
