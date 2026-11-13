/**
 * 装扮映射表生成器（docs/dressing-map.md）。
 *
 * 两条定位契约（PR #122 Codex e44cc676 blocking / major）：
 *
 * 1. **家具三态**：resolveFurniturePlacement 返回 `{ placement, diagnostic }`——
 *    - `placement` 非空 = 有效摆位，进「已摆位」行；
 *    - `placement === null` **且** `diagnostic` 存在 = 定位失败：记入失败清单并让生成器
 *      以非零退出码拒绝写文档（显形，不许静默变成 count-only 或 `(—, —)`）；
 *    - `placement === null` 且**无** diagnostic = 正常 count-only，按声明 `count` 计数。
 *    旧实现用 `placement !== undefined` 判「已摆位」——null !== undefined 恒真，count-only
 *    与失败都被当成已摆位，数量按条目数输出（厨房 5/2/5 被写成 1/1/1）。
 *
 * 2. **冷凝链锚点已退役（2026-11-13 issue #116）**：三件 `anchor` 定位家具
 *    （condensate_pipe_ac_outlet / mb_vanity_pvc_wardrobe_entry /
 *    mb_vanity_pvc_service_chase）随 950 衣柜与三件 PVC 链件一并删除；
 *    `resolveCondensatePlacementAnchors` 在双宿主（wardrobe / wallRun）均缺席时
 *    返回空几何、无诊断（不报错），装扮映射不再列出这三件。本文件不另写派生，
 *    也不把上下文置空——退役路径即 `shared/condensate-chain.ts` 的空几何分支。
 */
import * as fs from 'fs';
import { readFileSync } from 'node:fs';
import * as yaml from 'js-yaml';
import { type ElectricalPoint, type FurnishingItem, type FurnishingsYaml } from '../shared/types.js';
import { loadOverlayDoc } from '../server/overlay-merge.js';
import { derivePointCircuits } from '../shared/point-circuits.js';
import {
  declaredFurnitureDims,
  furnitureHostIndex,
  resolveFurniturePlacement,
  type FurniturePlacementResolution,
  type PlacementAnchors,
  type PlacementItem,
  type WallLike,
} from '../shared/furniture-placement.js';
import { ProjectCatalog } from '../server/project-catalog.js';
import { loadCeilingConfig, loadElectricalConfig, loadPlumbingConfig } from '../server/config-loader.js';
import { deriveMepPenetrationAt, resolveCondensatePlacementAnchors } from '../shared/condensate-chain.js';
import { endpointSourcesFromFacts, parseMepCoordination } from '../shared/mep-hvac-coordination-schema.js';
import { parseProjectHvacFacts } from '../shared/project-render-facts-schema.js';
import { buildPlacementIndexes } from '../shared/placement-indexes.js';
import { buildHvacBuilderSources } from '../shared/render/HvacBuilder.js';
import { isLightingFixtureType } from '../shared/lighting-fixtures.js';
import { resolvePointPlacementInWalls, type PointMountHost, type PointPlacementResolution, type PointWall } from '../shared/point-placement.js';

interface MaterialEntry {
  id: string;
  topic_id: string;
  category: string;
  name: string;
  brand?: string;
  model?: string;
  spec?: string;
  status?: string;
  appearance?: Record<string, unknown>;
}

/** 回路拓扑的最小视图（issue #98 S3：点位侧 circuit 字段退役，回路归属改单一派生）。 */
interface TopologyLike {
  circuits: Array<{ id: string; member_point_ids?: string[] }>;
  controls?: Array<{ switch_point_ids?: string[]; target_point_ids?: string[] }>;
}

interface OverlayElement {
  id: string;
  type: string;
  height?: number;
  depth?: number;
  sill?: number;
  reason?: string;
}

const LIGHT_TYPE_LABEL: Record<string, string> = {
  pendant: '吊灯',
  dome: '吸顶灯',
  wall_lamp: '壁灯',
  downlight: '筒灯',
  led_strip: '灯带',
  track_light: '明装轨道灯',
  ceiling_light: '天花灯',
  night_light: '起夜灯',
};

function loadYaml<T>(path: string): T {
  return yaml.load(fs.readFileSync(path, 'utf8')) as T;
}

function appearanceToTwinmotion(a?: Record<string, unknown>): string {
  if (!a) return '按实物选材替换';
  const parts: string[] = [];
  if (a.color) parts.push(`底色 ${a.color}`);
  if (a.type === 'wood_plank') {
    parts.push(a.pattern === 'herringbone' ? '木纹·人字拼' : '木纹·直铺');
    if (Array.isArray(a.plank_mm)) parts.push(`条板 ${(a.plank_mm as number[]).join('x')}mm`);
  }
  if (a.finish) parts.push(`光泽 ${a.finish}`);
  return parts.length ? parts.join('，') : '按实物选材替换';
}

/** 生成器与测试共用的摆位上下文（家具 / 冷凝链 / 点位三套索引同一份，不各拼一份）。 */
export interface DressingMapContext {
  furnishings: FurnishingsYaml;
  electrical: ElectricalPoint[];
  wallSegments: Map<string, WallLike[]>;
  hosts: ReadonlyMap<string, PlacementItem>;
  anchors: PlacementAnchors;
  /** 链级诊断（穿墙点派生 + 链解算）；非空即定位失败，生成器必须显形。 */
  chainDiagnostics: string[];
  pointWalls: Map<string, PointWall>;
  mountHosts: Map<string, PointMountHost>;
}

/**
 * 读权威配置并解出装扮映射所需的全部定位上下文。
 *
 * 冷凝链锚点构造与 SceneBuilder / Node CLI 场景装配（`buildCliHouseScene`）/ verify:furniture 同一条链（issue #98 PR-10）：
 * `config/hvac.yaml` diagram（内机锚点） + `config/mep-hvac-coordination.yaml` 的
 * condensate-master 派生穿墙点 + `mb.wardrobe_950` / `mb.vanity_pvc_box` 宿主。
 * 缺任一项时锚点解不出——三件链条家具按「定位失败」显形，不回退绝对坐标。
 */
export function loadDressingMapContext(): DressingMapContext {
  const house = loadYaml<{ furnishings?: FurnishingsYaml }>('config/house.yaml');
  const furnishings = house.furnishings ?? {};
  const catalog = ProjectCatalog.load('.');
  const walls = catalog.getWalls();
  const wallSegments = new Map<string, WallLike[]>();
  for (const wall of walls) {
    const key = wall.id ?? '';
    const list = wallSegments.get(key) ?? [];
    list.push(wall);
    wallSegments.set(key, list);
  }
  const hosts = furnitureHostIndex(Object.values(furnishings).flat());
  // 点位/家具宿主索引单一产地（issue #98 疗法②）：生产消费方与脚本同一条构造。
  const { pointWalls, mountHosts } = buildPlacementIndexes({ geometry: { walls }, furnishings });

  const hvacFacts = parseProjectHvacFacts(readFileSync('config/hvac.yaml', 'utf8'));
  const electrical = loadElectricalConfig();
  const plumbing = loadPlumbingConfig();
  const ceiling = loadCeilingConfig();
  const hvacSources = buildHvacBuilderSources({ ceiling, electrical, hvac: hvacFacts, pointWalls, mountHosts });
  const penetration = deriveMepPenetrationAt(
    parseMepCoordination(readFileSync('config/mep-hvac-coordination.yaml', 'utf8')).routes.find((route) => route.id === 'condensate-master'),
    'w_mbath_south',
    {
      sources: endpointSourcesFromFacts({ electrical, plumbing, ceiling, hvac: hvacFacts }, pointWalls, mountHosts),
      walls,
    },
  );
  const { anchors, diagnostics } = resolveCondensatePlacementAnchors({
    hvacDiagram: hvacFacts.plans[0]?.diagram,
    hvacSources,
    penetration: penetration.point,
    wardrobe: hosts.get('mb.wardrobe_950'),
    wallRun: hosts.get('mb.vanity_pvc_box'),
    wallSegments,
    hosts,
  });
  return {
    furnishings,
    electrical,
    wallSegments,
    hosts,
    anchors,
    chainDiagnostics: [...(penetration.diagnostic ? [penetration.diagnostic] : []), ...diagnostics],
    pointWalls,
    mountHosts,
  };
}

export interface SectionOutput {
  lines: string[];
  /** 定位失败（placement null + diagnostic）：生成器必须显形并拒绝写文档。 */
  failures: string[];
}

/**
 * §2 家具体块清单。三态判据见文件头：placement 非空 = 已摆位；null + diagnostic =
 * 定位失败（进 failures，不出表格行）；null 无 diagnostic = 正常 count-only（按声明 count 计）。
 */
export function buildFurnishingSection(
  furnishings: FurnishingsYaml,
  resolve: (item: FurnishingItem) => FurniturePlacementResolution,
): SectionOutput {
  const lines: string[] = [];
  const failures: string[] = [];
  for (const [roomId, items] of Object.entries(furnishings)) {
    // 每类体块尺寸取首件的 declaredFurnitureDims（行内 width/depth > 目录，与
    // SceneBuilder / verify:furniture 同一口径）：行内参数化柜（如 issue #116 通顶柜）
    // 无目录条目，旧写法只读目录会写成「体块无尺寸记录」。
    const dimsByType = new Map<string, string>();
    const placedByType = new Map<string, Array<{ x: number; z: number; rotation?: number; resolved: boolean }>>();
    const countOnly = new Map<string, number>();
    for (const item of items) {
      const { placement, diagnostic } = resolve(item);
      if (diagnostic !== undefined) {
        // 声明了定位却解不出来：显形，禁止按 count-only 静默吞掉（PR #122 Codex e44cc676）。
        failures.push(`${roomId}:${item.type}${item.id ? ` (${item.id})` : ''}: ${diagnostic}`);
        continue;
      }
      if (placement === null) {
        countOnly.set(item.type, (countOnly.get(item.type) ?? 0) + (item.count ?? 1));
        continue;
      }
      if (!dimsByType.has(item.type)) {
        const dd = declaredFurnitureDims(item as unknown as PlacementItem);
        if (dd.width !== undefined && dd.depth !== undefined) dimsByType.set(item.type, `${dd.width}×${dd.depth}`);
      }
      const list = placedByType.get(item.type) ?? [];
      list.push({
        x: placement.x,
        z: placement.z,
        rotation: item.rotation,
        resolved: item.x === undefined || item.z === undefined,
      });
      placedByType.set(item.type, list);
    }
    for (const [type, list] of placedByType) {
      const dims = dimsByType.get(type) ?? '（体块无尺寸记录）';
      const positions = list.map((p) => {
        const coord = p.resolved ? `(${p.x.toFixed(3)}, ${p.z.toFixed(3)})` : `(${p.x}, ${p.z})`;
        return `${coord}${p.rotation !== undefined ? ` / ${p.rotation}°` : ''}${p.resolved ? '（解算）' : ''}`;
      }).join('；');
      lines.push(`| ${roomId} | ${type} | ${list.length} | ${dims} | ${positions} |`);
    }
    for (const [type, n] of countOnly) {
      lines.push(`| ${roomId} | ${type} | ${n} | — | count-only（无家具体块，按实物补摆） |`);
    }
  }
  return { lines, failures };
}

/**
 * §3 灯光点位。位置一律走 shared/point-placement.ts 单一解算（与 3D/DXF/MEP/标注同口径）：
 * 沿墙灯读 wall+along、挂载灯读宿主脸，声明 x/z 只是绝对定位来源的取值——不再直接回显
 * `p.x/p.z`（删除后沿墙/挂载灯会显示 `(—, —)`）。
 */
export function buildLightingSection(
  lights: ElectricalPoint[],
  circuitOf: (pointId: string) => string,
  resolve: (point: ElectricalPoint) => PointPlacementResolution,
): SectionOutput {
  const lines: string[] = [];
  const failures: string[] = [];
  lines.push(`## 3. 灯光点位（${lights.length} 个）→ 灯具与光源摆放单`);
  lines.push('');
  lines.push('| id | 房间 | 类型 | 位置 (x, z) | 高度 (m) | 色温 (K) | 回路 | 备注 |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const point of lights) {
    const { placement, diagnostic } = resolve(point);
    if (placement === null) {
      failures.push(`灯光 ${point.id}: ${diagnostic ?? '点位定位解算失败（解算器未返回诊断）'}`);
    }
    const position = placement === null
      ? '（解算失败）'
      : `(${formatCoord(placement.x)}, ${formatCoord(placement.z)})`;
    lines.push(`| ${point.id} | ${point.room} | ${LIGHT_TYPE_LABEL[point.type] ?? point.type} | ${position} | ${point.height ?? '—'} | ${point.temp ?? '—'} | ${circuitOf(point.id)} | ${point.note ?? ''} |`);
  }
  lines.push('');
  return { lines, failures };
}

/** 坐标显示精度：3 位小数、去掉浮点尾巴（解算值 7.450000000000001 → 7.45）。 */
function formatCoord(value: number): string {
  return String(Number(value.toFixed(3)));
}

function main(): void {
  const materials = loadYaml<{ materials: MaterialEntry[] }>('config/materials.yaml').materials;
  const topology = loadYaml<TopologyLike>('config/electrical-topology.yaml');
  const overlay = loadOverlayDoc() as unknown as { elements: OverlayElement[] };
  const env = loadYaml<{ location: { latitude: number; longitude: number; timezone: number } }>('config/environment.yaml');
  const scheme = JSON.parse(fs.readFileSync('data/current-scheme.json', 'utf8')) as {
    selections: Record<string, { default?: string; roomOverrides?: Record<string, string> }>;
  };
  const context = loadDressingMapContext();

  // 点位 → 回路 单一派生（issue #98 S3）：本表「回路」列不再读点位侧 circuit 字段（已退役）。
  const pointCircuits = derivePointCircuits(topology).pointCircuits;

  const byId = new Map(materials.map((m) => [m.id, m]));
  const failures: string[] = context.chainDiagnostics.map((diagnostic) => `condensate chain: ${diagnostic}`);
  const lines: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  // fact.furnishings_count 的镜像出口：house.yaml furnishings 的递归条目数（含 count-only）。
  const furnishingCount = Object.values(context.furnishings).reduce((sum, items) => sum + items.length, 0);

  lines.push('# 装扮映射表（材质/家具/灯光的外观替换映射）');
  lines.push('');
  lines.push(`生成：${today}，数据源：materials.yaml / house.yaml furnishings（摆位走 shared/furniture-placement 解算器）/ electrical.yaml（灯具位置走 shared/point-placement 解算器）/ electrical-topology.yaml（回路列，S3 起单一派生）/ hvac.yaml + mep-hvac-coordination.yaml（冷凝链家具锚点）/ config/model/envelope/（openings+floor-zones+ceiling+finish-defaults）/ environment.yaml / data/current-scheme.json`);
  lines.push('');
  lines.push(`数据规模：house.yaml furnishings 共 ${furnishingCount} 件（与 \`fact.furnishings_count\` 对账）。`);
  lines.push('');
  lines.push('用法：渲染时按本表替换材质/家具/灯光外观；节点名即映射键。渲染线现状（2026-10-22 批 2 审阅修复）：Twinmotion/Blender 线已退场（其验收文档已删除，历史见 git），现行定妆走 Web 渲染线（app/ Three.js）；本表只保留与渲染器无关的映射数据与外观意图，§6 为现行回传流程。');
  lines.push('');

  lines.push('## 1. 房间/地面材料 → 渲染材质替换建议');
  lines.push('');
  lines.push('| 主题 | 当前选择 | 名称 | 品牌/型号 | 规格 | 渲染替换建议 |');
  lines.push('|---|---|---|---|---|---|');
  for (const [topicId, sel] of Object.entries(scheme.selections)) {
    const ids = new Set<string>();
    if (sel.default) ids.add(sel.default);
    for (const v of Object.values(sel.roomOverrides ?? {})) ids.add(v);
    for (const id of ids) {
      const m = byId.get(id);
      if (!m) {
        lines.push(`| ${topicId} | ${id} | ⚠ materials.yaml 未找到 | | | |`);
        continue;
      }
      lines.push(`| ${topicId} | ${id} | ${m.name} | ${[m.brand, m.model].filter(Boolean).join(' / ')} | ${m.spec ?? ''} | ${appearanceToTwinmotion(m.appearance)} |`);
    }
  }
  lines.push('');

  lines.push('## 2. 家具体块清单 → 库家具替换参照');
  lines.push('');
  lines.push('3D 场景中未声明 id 的家具节点名为 `furniture:{room}:{type}:{index}`，体块尺寸即下表 width×depth（米）。');
  lines.push('');
  lines.push('| 房间 | 类型 | 数量 | 宽×深 (m) | 摆位 (x, z) / 朝向 |');
  lines.push('|---|---|---|---|---|');
  // 摆位一律走共享解算器（与 3D/DXF/verify:furniture 同一构造），三态判据见文件头。
  const furnishingSection = buildFurnishingSection(
    context.furnishings,
    (item) => resolveFurniturePlacement(item, context.wallSegments, context.hosts, context.anchors),
  );
  lines.push(...furnishingSection.lines);
  failures.push(...furnishingSection.failures);
  lines.push('');

  // 灯具类型判定走 shared/lighting-fixtures.ts 单一清单（此前本文件私有一份，漏了 night_light，
  // 六个起夜灯因此完全缺席；位置也必须走共享点位解算器而不是回显已删除的 x/z）。
  const lights = context.electrical.filter((point) => isLightingFixtureType(point.type));
  const lightingSection = buildLightingSection(
    lights,
    (pointId) => pointCircuits.get(pointId) ?? '—',
    (point) => resolvePointPlacementInWalls(point, context.pointWalls, context.mountHosts),
  );
  lines.push(...lightingSection.lines);
  failures.push(...lightingSection.failures);
  lines.push('### 后续深化预留（当前未实施点位）');
  lines.push('厨房台面/柜底灯、主卫/客卫镜前灯、父母房床头灯、书房桌面灯均为后续深化预留/现场确认项，不属于当前已实施灯光点位。主卧南床头梳妆台的镜前灯为家具插接式部件，复用 `sock_master_bed_r`，不新增墙内灯位。');
  lines.push('');
  lines.push('**已取消、不再纳入装扮**：电视墙灯带（DEC-2026-10-13-R5，业主裁定「不搞了」）。点位与整条照明回路已从 config 删除，**不要**在渲染里摆这条灯带。取电插座 `sock_living_tv_led` 保留在电视墙，后期想要氛围光走插电式灯带挂该插座即可，零预埋零开槽。');
  lines.push('');

  const glass = overlay.elements.filter((e) => e.type === 'curtain_run');
  const bays = overlay.elements.filter((e) => e.type === 'bay_sill');
  lines.push('## 4. 玻璃幕/飘窗清单 → 玻璃材质（Low-E 微反）');
  lines.push('');
  lines.push('| id | 类型 | 参数 | 备注 |');
  lines.push('|---|---|---|---|');
  for (const e of glass) {
    lines.push(`| ${e.id} | ${e.type === 'curtain_run' ? '玻璃幕墙' : '玻璃填充'} | 高 ${e.height ?? '—'}m | Low-E 微反玻璃 |`);
  }
  for (const e of bays) {
    lines.push(`| ${e.id} | 飘窗 | 深 ${e.depth ?? '—'}m / 台高 ${e.sill ?? '—'}m | ${e.reason ?? ''} |`);
  }
  lines.push('');

  lines.push('## 5. 太阳定位参数');
  lines.push('');
  lines.push(`- 地点：南宁 ${env.location.latitude}°N, ${env.location.longitude}°E（UTC+${env.location.timezone}）`);
  lines.push('- 建议工况 A：8 月 17:30 西晒（检验玻璃幕/西墙眩光与掠射光）');
  lines.push('- 建议工况 B：20:00 夜景（检验全屋 3000K 暖光氛围，厨卫 4000K）');
  lines.push('');

  lines.push('## 6. 渲染与回传指引（现行）');
  lines.push('');
  lines.push('### 地面（含人字拼 A/B）');
  lines.push('- Web 渲染的程序化贴图仅打底（程序化生成，质感非最终）；人字拼须用带多版面+倒角的真人字拼材质，不得以直纹贴图冒充，拖到地面节点比对版面');
  lines.push('- 直铺选浅胡桃色（#c49a6c 方向）柔光木地板款；替换后对比人字拼/直铺，作为 DEC-011 门店终审前的证据');
  lines.push('');
  lines.push('### 玻璃幕（5 段 curtain_run + 9 处飘窗）');
  lines.push('- 玻璃节点（`west_curtain` 等）质感目标：反射率微升、微绿着色 ≈ Low-E 微反');
  lines.push('- 框料：导出为整片玻璃面，开发商幕墙的竖梃/横梁分格需手动补，分格尺寸按现场照片');
  lines.push('- **外景必须配**：城市/天空环境，否则玻璃无反射内容显假（"镜子+灰片"观感的根因）');
  lines.push('');
  lines.push('### 回传审阅');
  lines.push('- 静帧建议两工况各一张：17:30 西晒 / 20:00 夜景（见 §5 太阳定位参数），4K 导出 PNG');
  lines.push('- PNG 先放本地 `tmp/capture/`（过程图不进 git，批 0 铁律）；定稿每视角 ≤1 张入对应 design-iterations 轮次的 evidence/final/ 留档，再把文件路径发给 AI 逐张审阅并给调整建议');
  lines.push('- 已退场的 Twinmotion Cloud 发布链路不再使用');
  lines.push('');

  // 定位失败必须显形：拒绝写出一份缺件/错数的文档（PR #122 Codex e44cc676）。
  // 只打印不写盘——旧文档保留在原地，调用方按非零退出码失败，修复后再重跑。
  if (failures.length > 0) {
    console.error(`docs/dressing-map.md 未生成：${failures.length} 条定位失败（禁止把失败写成 count-only 或（—, —））：`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync('docs/dressing-map.md', lines.join('\n'));
  console.log(`docs/dressing-map.md written: ${lights.length} lights, ${Object.keys(scheme.selections).length} topics`);
}

if (process.argv[1] && /generate-dressing-map\.(ts|js)$/u.test(process.argv[1])) main();
