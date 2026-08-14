# 阶段 1：Blender A/B 决策管线上线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Blender 渲染从"单机位单图"升级为可复现的 A/B 决策管线：参数化太阳工况（默认蓝调时刻）、多机位×昼夜批量渲染、输出命名含版本号、Cycles 固定 seed 保证同配置两次一致，并从 `materials.yaml` 的 `appearance` 字段生成程序化材质。

**Architecture:** 三处改动协同：`gen-render-config.ts` 负责把太阳工况参数化（按日期时刻计算太阳位置）并生成多机位清单；`dress_scene.py` 改为批量渲染模式（机位循环×昼夜、版本号命名、固定采样 seed）；新增 `materials_from_yaml.py`（被 dress_scene 调用）根据 `appearance.type` 生成程序化材质（solid_color / wood_plank / ceramic_tile_v2）。Blender 端保持读 Three.js 导出的 glb，不自行生成几何。

**Tech Stack:** Python 3 (Blender 5.2 bpy), TypeScript (tsx, js-yaml), Blender Cycles + OpenImageDenoise, glTF

## Global Constraints

- 坐标系：three.js 米制 (x 东/y 高/z 南)；glTF 导入 Blender 后 `(x,y,z)_three → (x,-z,y)_blender`，`to_blender(x,y,z) = (x,-z,y)` 不可改动
- Blender 端禁止手调 .blend 保存复用；所有"好看"沉淀在脚本与配置
- 太阳默认工况 = 蓝调时刻（用户决策）：需保证 Cycles 下玻璃透出蓝天、天花板不被环境光染色
- 材质先纯程序化（不下载贴图），用 `materials.yaml` 的 `appearance` 字段驱动
- Blender 保持导入 glb（Three.js 一致性优先）
- 修改后必须 `python3 -m py_compile` 全部改动 .py 文件；TypeScript 改动跑 `npm run typecheck`
- 验收：`gen-render-config.ts` 生成的多机位配置 + `dress_scene.py` 批量模式能输出 2 机位×昼夜=4 张图；同配置两次渲染结果一致

---

### Task 1: gen-render-config.ts 太阳工况参数化 + 多机位清单

**Files:**
- Modify: `scripts/blender/gen-render-config.ts`
- Test: 新增 `tests/server/gen-render-config.test.ts`

**Interfaces:**
- Consumes: `config/environment.yaml`（location.latitude/longitude/timezone）
- Produces: `scripts/blender/render-config.json`，结构：
  ```json
  {
    "sun": { "altitude_deg": number, "azimuth_deg": number },
    "lights": [{ "id","room","type","x","z","height","temp" }],
    "scenarios": [
      { "id": "blue_hour", "label": "...", "time": "19:30", "sun": {...}, "lights_on": true },
      { "id": "night", "label": "...", "time": "21:00", "sun": {...}, "lights_on": true }
    ],
    "cameras": [{ "id","label","position":[x,y,z],"target":[x,y,z] }]
  }
  ```

- [ ] **Step 1: 写失败测试** `tests/server/gen-render-config.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import { solarPosition } from '../../scripts/blender/solar.ts';

test('solarPosition: 蓝调时刻 8/15 19:30 太阳低于地平线', () => {
  const s = solarPosition(22.82, 108.37, 227, 19.5, 8 * 15);
  assert.ok(s.altitude_deg < 0, `expected negative altitude, got ${s.altitude_deg}`);
});

test('solarPosition: 正午太阳高悬', () => {
  const s = solarPosition(22.82, 108.37, 227, 12, 8 * 15);
  assert.ok(s.altitude_deg > 70, `expected high altitude, got ${s.altitude_deg}`);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test tests/server/gen-render-config.test.ts`
Expected: FAIL —— `Cannot find module '../../scripts/blender/solar.ts'`

- [ ] **Step 3: 新建 `scripts/blender/solar.ts`，把 solarPosition 从 gen-render-config 抽出来**

```ts
export function solarPosition(
  latDeg: number,
  lonDeg: number,
  dayOfYear: number,
  localHour: number,
  tzMeridian: number,
): { altitude_deg: number; azimuth_deg: number } {
  const decl = 23.45 * Math.sin(((360 / 365) * (284 + dayOfYear) * Math.PI) / 180);
  const solarTime = localHour + (lonDeg - tzMeridian) / 15;
  const H = 15 * (solarTime - 12);
  const rad = Math.PI / 180;
  const phi = latDeg * rad;
  const d = decl * rad;
  const h = H * rad;
  const sinAlt = Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(h);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt))) / rad;
  const cosA = (Math.sin(d) - sinAlt * Math.sin(phi)) / (Math.cos(alt * rad) * Math.cos(phi));
  let az = Math.acos(Math.max(-1, Math.min(1, cosA))) / rad;
  if (solarTime > 12) az = 360 - az;
  return { altitude_deg: +alt.toFixed(1), azimuth_deg: +az.toFixed(1) };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx --test tests/server/gen-render-config.test.ts`
Expected: PASS

- [ ] **Step 5: 改写 `scripts/blender/gen-render-config.ts` 支持多场景+多机位**

```ts
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { solarPosition } from './solar.ts';

interface ElectricalPoint {
  id: string; room: string; type: string;
  x?: number; z?: number; height?: number; temp?: number;
}
const LIGHT_TYPES = new Set(['pendant', 'dome', 'wall_lamp', 'downlight', 'led_strip']);

const electrical = yaml.load(fs.readFileSync('config/electrical.yaml', 'utf8')) as ElectricalPoint[];
const env = yaml.load(fs.readFileSync('config/environment.yaml', 'utf8')) as {
  location: { latitude: number; longitude: number; timezone: number };
};
const { latitude, longitude, timezone } = env.location;
const tzMeridian = timezone * 15;
const DAY = 227; // 2026-08-15

// 场景：蓝调时刻（太阳已落，天光蓝）+ 夜晚（灯为主）
// 8/15 南宁日落约 19:10，19:30 太阳低于地平线约 -6°（civil twilight 边缘）
const BLUE_HOUR = { id: 'blue_hour', label: '蓝调时刻', time: '19:30', lights_on: true };
const NIGHT = { id: 'night', label: '夜晚', time: '21:30', lights_on: true };

const scenarios = [BLUE_HOUR, NIGHT].map((sc) => {
  const [h, m] = sc.time.split(':').map(Number);
  return {
    ...sc,
    sun: solarPosition(latitude, longitude, DAY, h + m / 60, tzMeridian),
  };
});

const lights = electrical
  .filter((p) => LIGHT_TYPES.has(p.type))
  .map((p) => ({ id: p.id, room: p.room, type: p.type, x: p.x, z: p.z, height: p.height ?? 2.8, temp: p.temp ?? 3000 }));

const cameras = [
  {
    id: 'living_sofa_glass',
    label: '客厅餐桌侧南望沙发+玻璃幕（全景）',
    position: [10.3, 1.55, 2.9],
    target: [9.6, 1.2, 8.6],
  },
  {
    id: 'master_bed_looking_glass',
    label: '主卧床头看南窗',
    position: [2.6, 1.5, 7.9],
    target: [2.8, 1.2, 9.4],
  },
];

const config = { sun: scenarios[0].sun, lights, scenarios, cameras };
fs.writeFileSync('scripts/blender/render-config.json', JSON.stringify(config, null, 2));
console.log(`render-config.json: ${lights.length} lights, ${scenarios.length} scenarios, ${cameras.length} cameras`);
```

- [ ] **Step 6: 运行生成 + typecheck**

Run:
```bash
npx tsx scripts/blender/gen-render-config.ts
npm run typecheck
```
Expected: 输出 `render-config.json: 14 lights, 2 scenarios, 2 cameras`；typecheck 无错

- [ ] **Step 7: Commit**

```bash
git add scripts/blender/gen-render-config.ts scripts/blender/solar.ts tests/server/gen-render-config.test.ts scripts/blender/render-config.json
git commit -m "feat(blender): 参数化太阳工况（蓝调时刻+夜晚）+ 多机位清单"
```

---

### Task 2: dress_scene.py 批量渲染模式（机位×场景循环 + 版本号命名 + 固定 seed）

**Files:**
- Modify: `scripts/blender/dress_scene.py`
- Test: 新增 `scripts/blender/test_dress_config.py`（纯逻辑测试，不依赖 bpy）

**Interfaces:**
- Consumes: `render-config.json`（含 `scenarios[]`、`cameras[]`）
- Produces: 命令 `python dress_scene.py --glb X --config Y --engine CYCLES --out-dir Z --version v1`，输出 `Z/<version>__<cameraId>__<scenarioId>.png`

- [ ] **Step 1: 写失败测试** `scripts/blender/test_dress_config.py`

```python
import sys
sys.path.insert(0, '.')
from dress_config import make_jobs

CONFIG = {
    'scenarios': [
        {'id': 'blue_hour', 'sun': {'altitude_deg': -6.0, 'azimuth_deg': 290}},
        {'id': 'night', 'sun': {'altitude_deg': -35.0, 'azimuth_deg': 300}},
    ],
    'cameras': [
        {'id': 'living_sofa_glass', 'position': [10.3, 1.55, 2.9], 'target': [9.6, 1.2, 8.6]},
        {'id': 'master_bed_looking_glass', 'position': [2.6, 1.5, 7.9], 'target': [2.8, 1.2, 9.4]},
    ],
}

def test_make_jobs_count():
    jobs = make_jobs(CONFIG, version='v1')
    assert len(jobs) == 4, f'expected 4 jobs, got {len(jobs)}'

def test_make_jobs_filename():
    jobs = make_jobs(CONFIG, version='v1')
    names = [j['out_name'] for j in jobs]
    assert 'v1__living_sofa_glass__blue_hour' in names
    assert 'v1__master_bed_looking_glass__night' in names

if __name__ == '__main__':
    test_make_jobs_count()
    test_make_jobs_filename()
    print('PASS')
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python3 scripts/blender/test_dress_config.py`
Expected: `ModuleNotFoundError: No module named 'dress_config'`

- [ ] **Step 3: 新建 `scripts/blender/dress_config.py`（纯逻辑，可单测）**

```python
def make_jobs(cfg: dict, version: str) -> list[dict]:
    """把 config（scenarios×cameras）展开为渲染任务列表。"""
    jobs = []
    for cam in cfg.get('cameras', []):
        for sc in cfg.get('scenarios', []):
            jobs.append({
                'camera_id': cam['id'],
                'scenario_id': sc['id'],
                'sun': sc.get('sun', cfg.get('sun', {})),
                'lights_on': sc.get('lights_on', True),
                'out_name': f"{version}__{cam['id']}__{sc['id']}",
            })
    return jobs
```

- [ ] **Step 4: 运行测试确认通过**

Run: `python3 scripts/blender/test_dress_config.py`
Expected: `PASS`

- [ ] **Step 5: 改 `dress_scene.py` 支持批量渲染**

将 `main()` 改造为：

```python
def render_scene(args, cfg, cam_cfg, sun_cfg, lights_on: bool, out_path: str) -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=args['glb'])
    scene = bpy.context.scene
    used_engine = set_engine(scene, args['engine'])
    mats = build_materials(used_engine)
    stats = assign_materials(mats)
    if lights_on:
        add_lights(cfg)
    add_sun(sun_cfg)
    setup_world(used_engine, sun_cfg)
    add_camera(cam_cfg)
    if used_engine in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
        add_sky_planes()
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.render.filepath = out_path
    scene.view_settings.view_transform = 'AgX'
    try:
        scene.view_settings.exposure = 0.3 if used_engine == 'CYCLES' else 0.6
    except Exception:
        pass
    try:
        scene.render.image_settings.file_format = 'PNG'
    except Exception:
        pass
    print(f'[dress_scene] {out_path} engine={used_engine} lights={stats}')
    bpy.ops.render.render(write_still=True)


def main() -> None:
    argv = sys.argv[sys.argv.index('--') + 1:]
    args = {}
    for i in range(0, len(argv), 2):
        args[argv[i].lstrip('-')] = argv[i + 1]
    glb_path = args['glb']
    cfg_path = args['config']
    engine = args.get('engine', 'EEVEE')
    version = args.get('version', 'v1')
    out_dir = args.get('out-dir', '.')

    with open(cfg_path, 'r', encoding='utf-8') as f:
        cfg = json.load(f)

    from dress_config import make_jobs
    jobs = make_jobs(cfg, version=version)
    print(f'[dress_scene] {len(jobs)} jobs (cameras×scenarios)')
    os.makedirs(out_dir, exist_ok=True)
    for job in jobs:
        cam_cfg = next(c for c in cfg['cameras'] if c['id'] == job['camera_id'])
        out_path = os.path.join(out_dir, job['out_name'] + '.png')
        render_scene(args, cfg, cam_cfg, job['sun'], job['lights_on'], out_path)
```

同时给 `set_engine` 的 Cycles 分支加固定 seed（保证 A/B 一致性）：

```python
def set_engine(scene, engine: str) -> str:
    if engine.upper() == 'CYCLES':
        scene.render.engine = 'CYCLES'
        scene.cycles.samples = 256
        try:
            scene.cycles.use_denoising = True
        except Exception:
            pass
        try:
            scene.cycles.seed = 42
        except Exception:
            pass
        return 'CYCLES'
    ...
```

- [ ] **Step 6: py_compile + 测试**

Run:
```bash
python3 -m py_compile scripts/blender/dress_scene.py scripts/blender/dress_config.py
python3 scripts/blender/test_dress_config.py
```
Expected: 无语法错误；输出 `PASS`

- [ ] **Step 7: Commit**

```bash
git add scripts/blender/dress_scene.py scripts/blender/dress_config.py scripts/blender/test_dress_config.py
git commit -m "feat(blender): 批量渲染机位×场景，固定 Cycles seed，版本号命名"
```

---

### Task 3: 从 materials.yaml appearance 生成程序化材质

**Files:**
- Create: `scripts/blender/materials_from_yaml.py`
- Modify: `scripts/blender/dress_scene.py`（在 `build_materials` 之前注入 yaml 材质）
- Test: `scripts/blender/test_materials_from_yaml.py`

**Interfaces:**
- Consumes: `config/materials.yaml` + `data/current-scheme.json`（当前选材），`dress_scene.py` 的 `new_principled`/`hex_rgb`/`_srgb_to_linear_tuple`
- Produces: `build_yaml_materials(mats_yaml, scheme, engine) -> dict[str, bpy.types.Material]`，key 与 classify() 输出对应（floor/wall/ceiling/furniture/glass/...）

- [ ] **Step 1: 写失败测试** `scripts/blender/test_materials_from_yaml.py`

```python
import sys
sys.path.insert(0, '.')
from materials_from_yaml import resolve_scheme

def test_resolve_scheme():
    scheme = {'selections': {'floor': {'default': 'floor_tile_01'}, 'paint': {'default': 'latex_paint_01'}}}
    mats = {
        'floor_tile_01': {'id': 'floor_tile_01', 'appearance': {'type': 'wood_plank', 'color': '#c49a6c'}},
        'latex_paint_01': {'id': 'latex_paint_01', 'appearance': {'type': 'solid_color', 'color': '#f7f5ef'}},
    }
    resolved = resolve_scheme(scheme, mats)
    assert resolved['floor'] == 'floor_tile_01', resolved
    assert resolved['wall'] == 'latex_paint_01', resolved

if __name__ == '__main__':
    test_resolve_scheme()
    print('PASS')
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python3 scripts/blender/test_materials_from_yaml.py`
Expected: `ModuleNotFoundError: No module named 'materials_from_yaml'`

- [ ] **Step 3: 新建 `scripts/blender/materials_from_yaml.py`（纯逻辑部分 + 材质构建）**

```python
"""从 materials.yaml appearance 生成 Blender 程序化材质。"""
import math
import bpy


def resolve_scheme(scheme: dict, mats: dict) -> dict[str, str]:
    """把 current-scheme.json 的 selections 映射为 topic -> material_id。
    未选中的主题回落到与 classify() 兼容的默认 key。"""
    sel = scheme.get('selections', {})
    fallback = {'floor': 'floor_tile_01', 'paint': 'latex_paint_01', 'wall': 'wall_tile_01'}
    result: dict[str, str] = {}
    for topic, m in sel.items():
        mid = m.get('default') if isinstance(m, dict) else m
        if isinstance(mid, str) and mid in mats:
            result[topic] = mid
    # 主题名 -> classify key 别名
    alias = {'floor': 'floor', 'paint': 'wall', 'wall': 'wall', 'curtain': 'curtain_fabric',
             'cabinet': 'furniture', 'sofa': 'furniture', 'bed': 'furniture'}
    resolved = {}
    for topic, mid in result.items():
        key = alias.get(topic, topic)
        resolved[key] = mid
    return resolved


def build_yaml_materials(mats: dict, resolved: dict, engine: str, helpers) -> dict:
    """resolved: topic_key -> material_id。返回 classify key -> bpy material。
    helpers: {new_principled, hex_rgb}，从 dress_scene 注入避免循环依赖。"""
    out: dict[str, bpy.types.Material] = {}
    np_, hexrgb = helpers['new_principled'], helpers['hex_rgb']
    for key, mid in resolved.items():
        rec = mats[mid]
        app = rec.get('appearance', {})
        typ = app.get('type', 'solid_color')
        color = hexrgb(app.get('color', '#bfbfbf'))
        finish = app.get('finish', 'soft')
        rough = {'glossy': 0.15, 'soft': 0.35, 'matte': 0.6}.get(finish, 0.4)
        if key == 'wall' or key == 'ceiling':
            rough = 0.9
        if typ == 'solid_color':
            mat = np_(f'方案_{mid}', color, rough=rough)
        elif typ == 'wood_plank':
            mat = np_(f'方案_{mid}', color, rough=rough, coat=0.15)
        elif typ == 'ceramic_tile_v2':
            mat = np_(f'方案_{mid}', color, rough=0.2 if finish != 'matte' else 0.5, coat=0.3)
        else:
            mat = np_(f'方案_{mid}', color, rough=rough)
        out[key] = mat
    return out
```

- [ ] **Step 4: 运行测试确认通过**

Run: `python3 scripts/blender/test_materials_from_yaml.py`
Expected: `PASS`

- [ ] **Step 5: 在 `dress_scene.py` 中接入 yaml 材质**

在 `build_materials(engine)` 之后、`assign_materials` 之前，加载 yaml 材质并覆盖同名 key：

```python
def load_scheme_materials(engine: str, mats: dict) -> dict:
    """用 materials.yaml + current-scheme.json 覆盖基础材质。"""
    import yaml as pyyaml
    base = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'config')
    mats_path = os.path.join(base, 'materials.yaml')
    scheme_path = os.path.join(base, '..', 'data', 'current-scheme.json')
    with open(mats_path, 'r', encoding='utf-8') as f:
        mats_yaml = {m['id']: m for m in pyyaml.safe_load(f)['materials']}
    if os.path.exists(scheme_path):
        with open(scheme_path, 'r', encoding='utf-8') as f:
            scheme = json.load(f)
    else:
        scheme = {}
    from materials_from_yaml import resolve_scheme, build_yaml_materials
    resolved = resolve_scheme(scheme, mats_yaml)
    helpers = {'new_principled': new_principled, 'hex_rgb': hex_rgb}
    yaml_mats = build_yaml_materials(mats_yaml, resolved, engine, helpers)
    mats.update(yaml_mats)  # yaml 材质优先
    return mats
```

在 `render_scene` 中改为：`mats = load_scheme_materials(used_engine, build_materials(used_engine))`

- [ ] **Step 6: py_compile + 测试**

Run:
```bash
python3 -m py_compile scripts/blender/dress_scene.py scripts/blender/materials_from_yaml.py
python3 scripts/blender/test_materials_from_yaml.py scripts/blender/test_dress_config.py
```
Expected: 无语法错误；两个测试均 PASS

- [ ] **Step 7: Commit**

```bash
git add scripts/blender/materials_from_yaml.py scripts/blender/test_materials_from_yaml.py scripts/blender/dress_scene.py
git commit -m "feat(blender): 从 materials.yaml appearance 生成程序化材质"
```

---

### Task 4: 端到端验收——4 张图 + 两次一致性

**Files:**
- Test: `scripts/blender/verify_render_pipeline.sh`（或手动命令）

**Interfaces:**
- Consumes: Task 1 的 `render-config.json`、Task 2/3 的 `dress_scene.py`、`/tmp/house-patched.glb`

- [ ] **Step 1: 生成 glb（若 /tmp 无现成文件）**

```bash
ls /tmp/house-patched.glb || echo "need glb export from app (App.ts:285 exportSceneToGlb)"
```

- [ ] **Step 2: 用 EEVEE 快速跑通批量管线（快，验证 job 展开+命名）**

```bash
cd /home/tao/projects/bontop-design-log
cp scripts/blender/dress_scene.py scripts/blender/dress_config.py scripts/blender/materials_from_yaml.py /mnt/e/render-tmp/
npx tsx scripts/blender/gen-render-config.ts
cp scripts/blender/render-config.json /mnt/e/render-tmp/
"/mnt/e/Blender Foundation/Blender 5.2/blender.exe" --background --python "E:/render-tmp/dress_scene.py" -- \
  --glb "E:/render-tmp/house-patched.glb" --config "E:/render-tmp/render-config.json" \
  --engine EEVEE --out-dir "E:/render-tmp/renders" --version v1
```
Expected: 输出 4 个文件：`v1__living_sofa_glass__blue_hour.png`、`v1__living_sofa_glass__night.png`、`v1__master_bed_looking_glass__blue_hour.png`、`v1__master_bed_looking_glass__night.png`

- [ ] **Step 3: 用 Cycles 跑蓝调时刻单机位验证玻璃透蓝天（1 张即可）**

```bash
"/mnt/e/Blender Foundation/Blender 5.2/blender.exe" --background --python "E:/render-tmp/dress_scene.py" -- \
  --glb "E:/render-tmp/house-patched.glb" --config "E:/render-tmp/render-config.json" \
  --engine CYCLES --out-dir "E:/render-tmp/renders" --version v1
```
Expected: 4 张 Cycles 图；检查 `v1__living_sofa_glass__blue_hour.png` 玻璃区域 B>R+15（采样确认）

- [ ] **Step 4: 一致性验证（同配置两次渲染 seed 相同应逐像素一致或极近）**

```bash
cp /mnt/e/render-tmp/renders/v1__living_sofa_glass__blue_hour.png /tmp/a.png
# 重跑一遍再复制 b.png
md5sum /tmp/a.png /tmp/b.png
```
Expected: 因 OIDN 确定性 + 固定 seed，两张图 md5 相同或接近（允许 <0.5% 像素差异，先记录实测差异率）

- [ ] **Step 5: 输出验收记录到 docs**

新建 `docs/renders/pipeline-acceptance.md`，记录：命令、4 张图路径、Cycles 耗时（每张）、一致性命中情况、玻璃蓝/天花板中性采样数据。

- [ ] **Step 6: Commit**

```bash
git add docs/renders/pipeline-acceptance.md
git commit -m "docs(renders): 阶段1 管线验收记录（机位×场景批量、Cycles一致性）"
```

---

## Self-Review

**1. Spec coverage（对照用户确认的三决策 + 阶段 1 目标）：**
- 太阳默认蓝调时刻 → Task 1（scenarios.blue_hour，19:30 太阳 alt<0）
- 贴图先纯程序化 → Task 3（appearance.type 驱动，无贴图下载）
- Blender 保持导入 glb → 贯穿（render_scene 仍 `import_scene.gltf`，无自建几何）
- 机位清单 × 昼夜批量 → Task 1（cameras[2]）+ Task 2（make_jobs 展开 2×2=4）
- 输出命名含版本号 → Task 2（`{version}__{camera}__{scenario}.png`）
- 同配置两次一致 → Task 2（Cycles seed=42）+ Task 4（md5 对比）
- 从 materials.yaml appearance 生成材质 → Task 3

**2. Placeholder scan：** 无 TBD/TODO；每步含具体代码或命令。Step 5 的 dress_scene 改动用了"改造为"句式但给出了完整 render_scene/main 代码块。Task 4 的 glb 来源以 `ls` 检测并提示从 App.ts 导出，符合现状（/tmp 已有 house-patched.glb）。

**3. Type consistency：**
- `make_jobs(cfg, version)` 在 Task 2 定义与测试一致；Task 4 Step 2 用同名。
- `resolve_scheme(scheme, mats)` / `build_yaml_materials(mats, resolved, engine, helpers)` 在 Task 3 定义，Task 3 Step 5 的 `load_scheme_materials` 按此调用。
- `solarPosition` 在 Task 1 从 gen-render-config 抽出后签名 `(lat, lon, dayOfYear, localHour, tzMeridian)`，测试与 gen-render-config 调用一致。
- render-config.json 的 `scenarios[].sun` 与 `make_jobs` 读取的 `sc.get('sun', cfg.get('sun'))` 一致。
