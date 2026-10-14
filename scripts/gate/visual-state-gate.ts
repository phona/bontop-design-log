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
 * 退出码：0 = CLEAR（配置/材料资产一致）；1 = STALE（有不一致域或缺失资产）；2 = server 不可达。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { parseCeilingZones, parseElectricalPoints, parsePlumbingPoints } from '../../shared/project-render-facts-schema.js';

const BASES = [process.env.VISUAL_GATE_API, 'http://127.0.0.1:5173', 'http://localhost:4000'].filter(Boolean) as string[];
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);

/** 三个标注域都走 loader 缓存 facts（/api/annotations/*），用同一 parser 本地重算即可对账。 */
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

// 材料预演由 /api/project 的 materialPreview projection 提供；同时核对本地 atlas 文件内容，
// 避免 config 指纹没变但同名图片被替换后浏览器仍被误判为 current。
try {
  const localMaterials = parseYaml(readFileSync('config/materials.yaml', 'utf8')) as {
    materials?: Array<{ id: string; topic_id?: string; appearance?: unknown }>;
    preview_assets?: Array<{
      id: string;
      atlasUrl: string;
      atlasHash?: string;
      status: string;
      declaredFaceCount?: number;
      grid: { x: number; y: number; columns: number; rows: number; cellWidth: number; cellHeight: number; gapX: number; gapY: number; inset?: number };
    }>;
  };
  const localProjection = {
    materials: (localMaterials.materials ?? [])
      .filter((item) => item.topic_id === 'floor' || item.topic_id === 'paint')
      .map((item) => ({ id: item.id, topic_id: item.topic_id, appearance: item.appearance })),
    atlases: localMaterials.preview_assets ?? [],
  };
  const response = await fetch(`${base}/api/project`);
  if (!response.ok) throw new Error(`/api/project returned HTTP ${response.status}`);
  const project = await response.json() as { materialPreview?: unknown };
  const localDigest = digest(localProjection);
  const servedDigest = digest(project.materialPreview);
  if (localDigest !== servedDigest) {
    console.error(`STALE  materials  本地 ${localDigest} ≠ server ${servedDigest}  config/materials.yaml`);
    stale += 1;
  } else {
    for (const atlas of localProjection.atlases) {
      const publicRoot = resolve('app/public');
      const assetPath = resolve(publicRoot, atlas.atlasUrl.replace(/^\/+/, ''));
      if (!assetPath.startsWith(`${publicRoot}/`) || !existsSync(assetPath)) {
        throw new Error(`preview atlas asset missing or outside app/public: ${atlas.atlasUrl}`);
      }
      const bytes = readFileSync(assetPath);
      const fileHash = createHash('sha256').update(bytes).digest('hex');
      if (atlas.atlasHash && atlas.atlasHash !== fileHash) {
        throw new Error(`${atlas.id}: atlasHash ${atlas.atlasHash} does not match file ${fileHash}`);
      }
      if (bytes.length < 24 || bytes.toString('ascii', 1, 4) !== 'PNG') {
        throw new Error(`${atlas.id}: expected a PNG atlas asset`);
      }
      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);
      const grid = atlas.grid;
      const inset = grid.inset ?? 0;
      const right = grid.x + (grid.columns - 1) * (grid.cellWidth + grid.gapX) + grid.cellWidth - inset;
      const bottom = grid.y + (grid.rows - 1) * (grid.cellHeight + grid.gapY) + grid.cellHeight - inset;
      if (grid.x < 0 || grid.y < 0 || grid.columns < 1 || grid.rows < 1 || right > width || bottom > height) {
        throw new Error(`${atlas.id}: face grid ${right}×${bottom} exceeds atlas ${width}×${height}`);
      }
      if (atlas.status === 'complete' && atlas.declaredFaceCount !== grid.columns * grid.rows) {
        throw new Error(`${atlas.id}: complete face count disagrees with declared grid`);
      }
    }
    console.log(`CLEAR  materials  ${localDigest}  config/materials.yaml + preview atlas assets`);
  }
} catch (err) {
  console.error(`STALE  materials  ${err instanceof Error ? err.message : String(err)}  config/materials.yaml`);
  stale += 1;
}

if (stale > 0) {
  console.error('');
  console.error('gate:visual → STALE：浏览器渲染的不是当前 config / material assets。修复：重启 dev server 后硬刷新浏览器。');
  console.error('  1) 停掉 tsx server/index.ts   2) npx tsx server/index.ts   3) 浏览器 Ctrl+Shift+R   4) 重跑本命令');
  process.exit(1);
}
console.log('gate:visual → CLEAR：浏览器渲染的就是当前 config，可以叫业主看了。');
