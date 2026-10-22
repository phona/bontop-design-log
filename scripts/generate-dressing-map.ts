import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { FURNITURE_DIMS } from '../shared/types.js';

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

interface ElectricalPoint {
  id: string;
  room: string;
  type: string;
  x?: number;
  z?: number;
  height?: number;
  temp?: number;
  circuit?: string;
  note?: string;
}

interface FurnishingItem {
  type: string;
  x?: number;
  z?: number;
  rotation?: number;
  count?: number;
}

interface OverlayElement {
  id: string;
  type: string;
  height?: number;
  depth?: number;
  sill?: number;
  reason?: string;
}

const LIGHT_TYPES = new Set(['pendant', 'dome', 'wall_lamp', 'downlight', 'led_strip', 'track_light', 'ceiling_light']);
const LIGHT_TYPE_LABEL: Record<string, string> = {
  pendant: '吊灯',
  dome: '吸顶灯',
  wall_lamp: '壁灯',
  downlight: '筒灯',
  led_strip: '灯带',
  track_light: '明装轨道灯',
  ceiling_light: '天花灯',
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

function main(): void {
  const materials = loadYaml<{ materials: MaterialEntry[] }>('config/materials.yaml').materials;
  const electrical = loadYaml<ElectricalPoint[]>('config/electrical.yaml');
  const house = loadYaml<{ furnishings?: Record<string, FurnishingItem[]> }>('config/house.yaml');
  const overlay = loadYaml<{ elements: OverlayElement[] }>('config/layout/overlay.yaml');
  const env = loadYaml<{ location: { latitude: number; longitude: number; timezone: number } }>('config/environment.yaml');
  const scheme = JSON.parse(fs.readFileSync('data/current-scheme.json', 'utf8')) as {
    selections: Record<string, { default?: string; roomOverrides?: Record<string, string> }>;
  };

  const byId = new Map(materials.map((m) => [m.id, m]));
  const lines: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  // fact.furnishings_count 的镜像出口：house.yaml furnishings 的递归条目数（含 count-only）。
  const furnishingCount = Object.values(house.furnishings ?? {}).reduce((sum, items) => sum + items.length, 0);

  lines.push('# 装扮映射表（材质/家具/灯光的外观替换映射）');
  lines.push('');
  lines.push(`生成：${today}，数据源：materials.yaml / house.yaml furnishings / electrical.yaml / overlay.yaml / environment.yaml / data/current-scheme.json`);
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
  lines.push('glb 中家具节点名为 `furniture:{room}:{type}:{index}`，体块尺寸即下表 width×depth（米）。');
  lines.push('');
  lines.push('| 房间 | 类型 | 数量 | 宽×深 (m) | 摆位 (x, z) / 朝向 |');
  lines.push('|---|---|---|---|---|');
  for (const [roomId, items] of Object.entries(house.furnishings ?? {})) {
    const placed = items.filter((i) => i.x !== undefined && i.z !== undefined);
    const countOnly = new Map<string, number>();
    for (const i of items) {
      if (i.x === undefined) countOnly.set(i.type, (countOnly.get(i.type) ?? 0) + (i.count ?? 1));
    }
    const byType = new Map<string, FurnishingItem[]>();
    for (const i of placed) {
      const arr = byType.get(i.type) ?? [];
      arr.push(i);
      byType.set(i.type, arr);
    }
    for (const [type, arr] of byType) {
      const d = FURNITURE_DIMS[type];
      const dims = d ? `${d.width}×${d.depth}` : '（体块无尺寸记录）';
      const positions = arr.map((i) => `(${i.x}, ${i.z})${i.rotation !== undefined ? ` / ${i.rotation}°` : ''}`).join('；');
      lines.push(`| ${roomId} | ${type} | ${arr.length} | ${dims} | ${positions} |`);
    }
    for (const [type, n] of countOnly) {
      lines.push(`| ${roomId} | ${type} | ${n} | — | count-only（不在 glb，按实物补摆） |`);
    }
  }
  lines.push('');

  const lights = electrical.filter((p) => LIGHT_TYPES.has(p.type));
  lines.push(`## 3. 灯光点位（${lights.length} 个）→ 灯具与光源摆放单`);
  lines.push('');
  lines.push('| id | 房间 | 类型 | 位置 (x, z) | 高度 (m) | 色温 (K) | 回路 | 备注 |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const p of lights) {
    lines.push(`| ${p.id} | ${p.room} | ${LIGHT_TYPE_LABEL[p.type] ?? p.type} | (${p.x ?? '—'}, ${p.z ?? '—'}) | ${p.height ?? '—'} | ${p.temp ?? '—'} | ${p.circuit ?? '—'} | ${p.note ?? ''} |`);
  }
  lines.push('');
  lines.push('### 后续深化预留（当前未实施点位）');
  lines.push('厨房台面/柜底灯、主卫/客卫镜前灯、父母房床头灯、书房桌面灯均为后续深化预留/现场确认项，不属于当前已实施灯光点位。主卧南床头梳妆台的镜前灯为家具插接式部件，复用 `sock_master_bed_r`，不新增墙内灯位。');
  lines.push('');
  lines.push('**已取消、不再纳入装扮**：电视墙灯带（DEC-2026-10-13-R5，业主裁定「不搞了」）。点位与整条照明回路已从 config 删除，**不要**在渲染里摆这条灯带。取电插座 `sock_living_tv_led` 保留在电视墙，后期想要氛围光走插电式灯带挂该插座即可，零预埋零开槽。');
  lines.push('');

  const glass = overlay.elements.filter((e) => e.type === 'curtain_run' || e.type === 'glass_infill');
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
  lines.push('- glb 内嵌贴图仅打底（程序化生成，质感非最终）；人字拼须用带多版面+倒角的真人字拼材质，不得以直纹贴图冒充，拖到地面节点比对版面');
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

  fs.writeFileSync('docs/dressing-map.md', lines.join('\n'));
  console.log(`docs/dressing-map.md written: ${lights.length} lights, ${Object.keys(scheme.selections).length} topics`);
}

main();
