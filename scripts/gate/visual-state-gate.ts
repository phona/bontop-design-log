/**
 * 视觉改动状态门 · CLI（可归档、可追溯）。
 *
 * 用法：
 *   npm run gate:visual              # 对账 dev server 吐给浏览器的数据 vs 当前 config
 *
 * 回答一个问题：**客户端现在渲染的，是不是当前 config？**
 * 背景：ProjectRenderFactsLoader 的 chokidar watch 在本环境不可靠，且失败是静默的——
 * schema 拒绝新字段（如新增声明）时 load() 失败、旧 facts 原样保留，浏览器继续渲染旧状态。
 * 该事故曾把一次 2 轮返工放大成 6 轮（DEC-2026-10-08-R01~R05）。STALE 时重启 server 即可：
 *   停掉 `tsx server/index.ts` → `npx tsx server/index.ts` → 浏览器硬刷新。
 *
 * 退出码：0 = CLEAR（三域全部一致）；1 = STALE（有不一致域）；2 = server 不可达。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseCeilingZones, parseElectricalPoints, parsePlumbingPoints } from '../../shared/project-render-facts-schema.js';

const BASES = [process.env.VISUAL_GATE_API, 'http://127.0.0.1:5173', 'http://localhost:4000'].filter(Boolean) as string[];
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);

/** 三个域都走 loader 缓存 facts（/api/annotations/*），用同一 parser 本地重算即可对账。 */
const DOMAINS: Array<{ name: string; file: string; parse: (text: string) => unknown }> = [
  { name: 'ceiling', file: 'config/ceiling.yaml', parse: parseCeilingZones as (text: string) => unknown },
  { name: 'electrical', file: 'config/electrical.yaml', parse: parseElectricalPoints as (text: string) => unknown },
  { name: 'plumbing', file: 'config/plumbing.yaml', parse: parsePlumbingPoints as (text: string) => unknown },
];

async function findServer(): Promise<string | null> {
  for (const base of BASES) {
    try {
      const response = await fetch(`${base}/api/annotations/ceiling`);
      if (response.ok) return base;
    } catch { /* 换下一个基址 */ }
  }
  return null;
}

const base = await findServer();
if (!base) {
  console.error('gate:visual → server 不可达（试过 ' + BASES.join(' / ') + '）。先起服务：npm run dev');
  process.exit(2);
}

let stale = 0;
for (const domain of DOMAINS) {
  const localText = readFileSync(domain.file, 'utf8');
  let localDigest: string;
  try {
    localDigest = digest(domain.parse(localText));
  } catch (err) {
    console.error(`STALE  ${domain.name.padEnd(10)} 本地 config 解析失败：${err instanceof Error ? err.message : String(err)}（${domain.file}）`);
    stale += 1;
    continue;
  }
  let servedDigest: string;
  try {
    const served = await (await fetch(`${base}/api/annotations/${domain.name}`)).json();
    servedDigest = digest(served);
  } catch (err) {
    console.error(`gate:visual → ${domain.name} 拉取失败：${err instanceof Error ? err.message : String(err)}`);
    stale += 1;
    continue;
  }
  if (localDigest === servedDigest) {
    console.log(`CLEAR  ${domain.name.padEnd(10)} ${localDigest}  ${domain.file}`);
  } else {
    console.error(`STALE  ${domain.name.padEnd(10)} 磁盘 ${localDigest} ≠ server ${servedDigest}  ${domain.file}`);
    stale += 1;
  }
}

if (stale > 0) {
  console.error('');
  console.error('gate:visual → STALE：客户端渲染的不是当前 config。修复：重启 dev server 后硬刷新浏览器。');
  console.error('  1) 停掉 tsx server/index.ts   2) npx tsx server/index.ts   3) 浏览器 Ctrl+Shift+R   4) 重跑本命令');
  process.exit(1);
}
console.log('gate:visual → CLEAR：浏览器渲染的就是当前 config，可以叫业主看了。');
