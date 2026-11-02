/**
 * 合同归档核查的两个共用纯函数。
 *
 * 从 scripts/schedule/cost-summary.ts 迁出（2026-11-02，自装交互审批第一步）：
 * shared/schedule-state.ts 的数据层校验要用它们，而 shared/ 不得反向依赖
 * scripts/，故下沉到此。cost-summary.ts 与 scripts/schedule/control.ts 的
 * 原有 import 路径不变（cost-summary 转发导出），行为与文案逐字不变——
 * tests/server/control-contract-validation.test.ts 钉的就是这些文案。
 */

import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

/**
 * 严格日历校验：只认真实存在的 YYYY-MM-DD。Date.parse 之类会把 2026-02-30
 * 归一化成 03-02 而不报 NaN——等于没查。故按年月日逐项构造 UTC 日期再逐项
 * 比对回读值，归一化即不相等、判假。control.ts 的 signed_at 校验共用
 * 本函数（两处同口径，禁止再各写一份）。
 */
export function isValidCalendarDateText(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

/**
 * 合同归档路径核查（复审第二轮 P1）：登记 path 光有 contracts/ 前缀不
 * 算数——`contracts/../schedule/...` 前缀合法、解析出界，仓内任意文件
 * 都能配上自洽哈希冒充原件；前缀下的 symlink 同理（statSync 会跟随）。
 * 本函数返回问题描述（以「归档路径越界 / 归档原件不存在 / 归档原件为
 * 空文件 / 归档原件是符号链接」开头）或 null（合格）：
 *  ① 文本层：必须是 contracts/ 下的规范相对路径——含 `\`、空段、`.`
 *     段、`..` 段一律越界（先规范化再判前缀，不给绕法留形态）；
 *  ② 实体层：lstat 命中符号链接直接拒绝（不跟随）；非文件、缺位、
 *     0 字节分别点名；
 *  ③ 真实路径层：realpath 后必须仍落在 realpath(contracts/) 之内——
 *     中间目录是 symlink 跳出归档区同样越界。
 * cost-summary.ts（生成时）与 schedule-state.ts（数据层）共用本函数，两处同
 * 口径；rootDir 为仓库根（生成器/控制脚本都以仓根为 cwd/根）。
 */
export function contractArchivePathProblem(archivePath: string, rootDir: string): string | null {
  if (archivePath.includes('\\')) {
    return `归档路径越界：${archivePath} 含反斜杠，不是规范的 contracts/ 相对路径——合同原件只能登记归档区内的规范路径`;
  }
  const segments = archivePath.split('/');
  if (!archivePath.startsWith('contracts/') || segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return `归档路径越界：${archivePath} 不是 contracts/ 归档区内的规范路径（含 .. / . 段或多余斜杠的写法一律不认）——合同原件只能登记归档区内的文件`;
  }
  const absolute = resolve(rootDir, archivePath);
  let lst;
  try {
    lst = lstatSync(absolute);
  } catch {
    return `归档原件不存在：contract.archive_paths 指向 ${archivePath}，磁盘上找不到该文件——原件缺位`;
  }
  if (lst.isSymbolicLink()) {
    return `归档原件是符号链接：${archivePath}——归档原件必须是 contracts/ 内的真实文件，不接受符号链接（stat 会跟随链接把区外文件算作原件）`;
  }
  if (!lst.isFile()) {
    return `归档原件不存在：contract.archive_paths 指向 ${archivePath}，该路径不是文件——原件缺位`;
  }
  if (lst.size === 0) {
    return `归档原件为空文件：${archivePath}（0 字节）——原件缺位`;
  }
  let real: string;
  let realArchiveRoot: string;
  try {
    real = realpathSync(absolute);
    realArchiveRoot = realpathSync(resolve(rootDir, 'contracts'));
  } catch {
    return `归档原件不存在：contract.archive_paths 指向 ${archivePath}，真实路径解析失败——原件缺位`;
  }
  const rel = relative(realArchiveRoot, real);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    return `归档路径越界：${archivePath} 的真实路径已离开 contracts/ 归档区（经符号链接跳转）——合同原件只能登记归档区内的文件`;
  }
  return null;
}
