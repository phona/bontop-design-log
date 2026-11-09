/**
 * 契约测试：真实 `/api/project` 响应 → 建场（issue #98 收尾，PR #122 §三.4）。
 *
 * 由来：`renderFactsProjection` 与 `furnishingsAll` 这两个字段在全部测试文件里**零命中**，
 * 16 轮审查每轮 CI 全绿却一次没抓到「响应层级漂移 / 宿主表被阶段过滤」——因为没有任何
 * 测试把服务端真正下发的响应交给建场代码。手捏响应正是绕过这个缺口的方式，所以本文件
 * **起一个真 server**（`server/index.ts`，真 config、真 ProjectCatalog、真投影），只把
 * 它 HTTP 返回的 JSON 喂给 `parseSceneInput → buildScene`（HouseScene.buildFromCatalog
 * 在 WebGL 之下的同一条链路）。
 *
 * 四条断言（与 PR #122 §三.4 逐条对应）：
 *   1. HVAC 装配源非空：投影 + electrical + 宿主索引能解出 `indoor_master` 锚点；
 *   2. 三件冷凝链遮蔽家具（condensate_pipe_ac_outlet / mb_vanity_pvc_wardrobe_entry /
 *      mb_vanity_pvc_service_chase）在建场结果里在场；
 *   3. 一期响应里 `night_corridor` 的标注坐标不是 (0,0)——它挂 `ld.wall_cabinet_tall`，
 *      一期视图排除该柜；若 `furnishingsAll` 被阶段过滤，宿主解不出，标注只能落到原点
 *      （fail-closed 之后是抛错，同样红）；
 *   4. 响应的字段与 app 侧消费的字段名逐一对应——用 TypeScript AST 扫
 *      `app/src/render/HouseScene.ts` / `app/src/App.ts` 里全部 `projectData?.x.y` 读取，
 *      逐条到真响应里取值；`renderFactsProjection` 若又漂回 `house` 内，这里当场红。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parseSceneInput } from '../../shared/render/scene-input.js';
import { buildScene, type SceneBuildResult } from '../../shared/render/SceneBuilder.js';
import { buildPlacementIndexes } from '../../shared/placement-indexes.js';
import { buildHvacBuilderSources, hvacAnchorPositions, type HvacBuilderSources } from '../../shared/render/HvacBuilder.js';
import { resolvePointPlacementInWalls } from '../../shared/point-placement.js';
import type { ProjectApiResponse } from '../../shared/api-project.js';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** 三件冷凝链遮蔽家具（house.yaml 稳定 id）。 */
const CONDENSATE_CHAIN_FURNITURE_IDS = [
  'mb.condensate_pipe',
  'mb.vanity_pvc_wardrobe_entry',
  'mb.vanity_pvc_service_chase',
] as const;

/** 一期按 ID 排除、但仍被 night_corridor 当作定位宿主的柜。 */
const PHASE_1_EXCLUDED_HOST_ID = 'ld.wall_cabinet_tall';

interface BuiltFromResponse {
  result: SceneBuildResult;
  sources?: HvacBuilderSources;
  anchors: Map<string, { x: number; z: number }>;
}

/**
 * 把 `/api/project` 响应按 HouseScene.buildFromCatalog（app/src/render/HouseScene.ts:728-779）
 * 的同一构造喂给建场链路：parseSceneInput → buildPlacementIndexes（墙几何 + 全量 furnishingsAll）
 * → buildHvacBuilderSources（投影 + electrical + 两份索引）→ buildScene。
 * 这里不手捏任何字段：输入就是 HTTP 响应本身。
 */
function buildFromApiResponse(body: ProjectApiResponse): BuiltFromResponse {
  const house = body.house;
  const input = parseSceneInput({
    rooms: house.rooms ?? [],
    platform: house.platform,
    elements: house.sceneElements,
    ceilingZones: house.ceilingZones,
    furnishings: house.furnishings,
    furnishingsAll: house.furnishingsAll,
    electrical: house.electrical,
  });
  const placementIndexes = buildPlacementIndexes({
    geometry: { walls: input.walls },
    furnishings: input.furnishingsAll ?? input.furnishings ?? {},
  });
  const projection = body.renderFactsProjection;
  const sources = projection
    ? buildHvacBuilderSources({
      projection,
      electrical: house.electrical ?? [],
      pointWalls: placementIndexes.pointWalls,
      mountHosts: placementIndexes.mountHosts,
    })
    : undefined;
  const result = buildScene({
    ...input,
    options: {
      ...(projection && sources ? { hvac: { projection, sources } } : {}),
      // 主卫冷凝链穿墙锚点（与 HouseScene 同口径）。
      condensatePenetration: house.condensatePenetration,
    },
  });
  const anchors = projection && projection.hvac.status === 'implemented'
    ? hvacAnchorPositions(projection.hvac.diagram, sources)
    : new Map<string, { x: number; z: number }>();
  return { result, sources, anchors };
}

/** 取一个空闲端口：起真 server 时不与并行测试/本机服务抢固定端口。 */
async function reserveFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port > 0 ? resolve(port) : reject(new Error('未能分配到空闲端口'))));
    });
  });
}

/**
 * 用 TypeScript AST 收集 app 侧对 `/api/project` 响应的**全部字段读取路径**。
 * 扫描 `projectData.house.rooms` / `this.projectData?.materialPreview?.atlases` 这类属性链，
 * 返回去掉根标识符后的路径（如 `house.rooms`）。注释与类型位置不会被计入，
 * 因此这里列出的就是「app 真正消费的字段名」。
 */
function collectConsumedProjectPaths(filePath: string): string[] {
  const source = ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const paths = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) {
      const segments: string[] = [];
      let current: ts.Expression = node;
      while (ts.isPropertyAccessExpression(current)) {
        segments.unshift(current.name.text);
        current = current.expression;
      }
      // 两种根形态：`projectData.house.x`（形参/局部量）与 `this.projectData?.house?.x`。
      let consumed: string | undefined;
      if (ts.isIdentifier(current) && current.text === 'projectData') consumed = segments.join('.');
      else if (current.kind === ts.SyntaxKind.ThisKeyword && segments[0] === 'projectData') consumed = segments.slice(1).join('.');
      if (consumed) paths.add(consumed);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...paths].sort();
}

/** 按 `a.b.c` 逐级查自有属性；返回 undefined 表示该路径在响应里不存在。 */
function lookupPath(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

describe('契约：真实 /api/project 响应 → 建场', { timeout: 180_000 }, () => {
  let server: ChildProcess | undefined;
  let dataDir = '';
  let full: ProjectApiResponse;
  let phase1: ProjectApiResponse;
  let fullBuild: BuiltFromResponse;
  let phase1Build: BuiltFromResponse;

  const serverLogs: string[] = [];
  const serverExited = (): boolean => server !== undefined && (server.exitCode !== null || server.signalCode !== null);

  before(async () => {
    const port = await reserveFreePort();
    dataDir = mkdtempSync(join(tmpdir(), 'bontop-contract-scene-'));
    server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: '127.0.0.1',
        DATA_DIR: dataDir,
        // 固定 token：避免测试在仓库根生成 .bontop-write-token（GET 不校验，仅防副作用）。
        BONTOP_WRITE_TOKEN: 'contract-test-token',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout?.on('data', (chunk) => serverLogs.push(String(chunk)));
    server.stderr?.on('data', (chunk) => serverLogs.push(String(chunk)));

    const base = `http://127.0.0.1:${port}/api/project`;
    const deadline = Date.now() + 150_000;
    let lastError = '尚无响应';
    let fullBody: ProjectApiResponse | undefined;
    while (Date.now() < deadline) {
      if (serverExited()) {
        throw new Error(`真实 server 提前退出（exitCode=${server.exitCode ?? server.signalCode}）：\n${serverLogs.join('')}`);
      }
      try {
        const response = await fetch(base);
        if (response.ok) {
          fullBody = (await response.json()) as ProjectApiResponse;
          break;
        }
        lastError = `HTTP ${response.status}: ${(await response.text()).slice(0, 2000)}`;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!fullBody) {
      throw new Error(`真实 server 未在超时内就绪（${lastError}）：\n${serverLogs.join('')}`);
    }
    full = fullBody;

    const phaseResponse = await fetch(`${base}?phase=phase_1_basic_occupancy`);
    assert.equal(phaseResponse.status, 200, 'GET /api/project?phase=phase_1_basic_occupancy 必须 200');
    phase1 = (await phaseResponse.json()) as ProjectApiResponse;

    fullBuild = buildFromApiResponse(full);
    phase1Build = buildFromApiResponse(phase1);
  });

  after(async () => {
    const child = server;
    if (child && !serverExited()) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 5_000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        child.kill('SIGTERM');
      });
    }
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  it('断言 1：HVAC 装配源非空，三件冷凝链遮蔽家具能解出 indoor_master 锚点', () => {
    assert.ok(full.renderFactsProjection, '响应顶层缺 renderFactsProjection：HVAC 装配源为空，三件冷凝链家具会静默缺失');
    assert.equal(full.renderFactsProjection.hvac.status, 'implemented', 'renderFactsProjection.hvac 未就绪');
    assert.ok(fullBuild.sources, 'buildHvacBuilderSources 未产出装配源');
    assert.ok((fullBuild.sources.ceiling?.length ?? 0) > 0, 'HVAC 装配源 ceiling 为空');
    assert.ok((fullBuild.sources.electrical?.length ?? 0) > 0, 'HVAC 装配源 electrical 为空（power anchor 会静默丢掉）');

    const indoorMaster = fullBuild.anchors.get('indoor_master');
    assert.ok(indoorMaster, `indoor_master 锚点解不出（已解出：${[...fullBuild.anchors.keys()].join(', ')}）——三件冷凝链家具没有起点`);
    assert.ok(Number.isFinite(indoorMaster.x) && Number.isFinite(indoorMaster.z), 'indoor_master 锚点坐标非有限数');

    const chainDiagnostics = fullBuild.result.report.placementDiagnostics.filter((item) => item.startsWith('condensate chain:'));
    assert.deepEqual(chainDiagnostics, [], `冷凝链锚点解算失败：\n${chainDiagnostics.join('\n')}`);
  });

  it('断言 2：三件冷凝链遮蔽家具在建场结果里在场', () => {
    const objectIds = fullBuild.result.index.furnitureMeshes.map((mesh) => String(mesh.userData.objectId));
    const missing = CONDENSATE_CHAIN_FURNITURE_IDS.filter((id) => !objectIds.includes(id));
    assert.deepEqual(missing, [], `建场结果缺冷凝链家具（共 ${objectIds.length} 件家具）：\n${objectIds.filter((id) => id.startsWith('mb.')).join('\n')}`);
  });

  it('断言 3：一期响应里 night_corridor 的标注坐标不是 (0,0)', () => {
    assert.equal(phase1.phase, 'phase_1_basic_occupancy');
    const phase1VisibleIds = Object.values(phase1.house.furnishings).flat().map((item) => item.id);
    assert.ok(
      !phase1VisibleIds.includes(PHASE_1_EXCLUDED_HOST_ID),
      `${PHASE_1_EXCLUDED_HOST_ID} 若不再被一期排除，本断言就测不到「宿主表被阶段过滤」这个失效形态`,
    );
    const phase1AllIds = Object.values(phase1.house.furnishingsAll).flat().map((item) => item.id);
    assert.ok(phase1AllIds.includes(PHASE_1_EXCLUDED_HOST_ID), 'house.furnishingsAll 缺一期排除的宿主柜：定位宿主表被阶段过滤');
    assert.ok(phase1Build.result.index.mountHosts.has(PHASE_1_EXCLUDED_HOST_ID), '建场 mountHosts 缺一期排除的宿主柜（furnishingsAll 未穿透到 SceneBuilder）');

    const nightCorridor = phase1.house.electrical.find((point) => point.id === 'night_corridor');
    assert.ok(nightCorridor, '一期电气清单缺 night_corridor（被交付点位不许因阶段过滤消失）');
    assert.equal(nightCorridor.x, undefined, 'night_corridor 仍带声明 x/z：本测试要验证的是关系派生，不是回落声明坐标');
    assert.equal(nightCorridor.z, undefined, 'night_corridor 仍带声明 x/z：本测试要验证的是关系派生，不是回落声明坐标');

    // 与 AnnotationRenderer.planOf（app/src/render/annotations/AnnotationRenderer.ts:98）同一解算：
    // 索引取 buildScene 产物 index.pointWalls / index.mountHosts——正是 HouseScene 注入标注层的那两份。
    const { placement, diagnostic } = resolvePointPlacementInWalls(
      nightCorridor,
      phase1Build.result.index.pointWalls,
      phase1Build.result.index.mountHosts,
    );
    assert.ok(placement, `night_corridor 标注坐标解不出（${diagnostic ?? '无诊断'}）——宿主表若被阶段过滤，标注只能落到原点`);
    assert.notDeepEqual([placement.x, placement.z], [0, 0], 'night_corridor 标注坐标落回原点：宿主表被阶段过滤');
    // config/electrical.yaml 的 NP-5 口径：wall_cabinet_tall 北脸 x=7.20+0.25、z=5.55。
    assert.ok(Math.abs(placement.x - 7.45) < 1e-6 && Math.abs(placement.z - 5.55) < 1e-6,
      `night_corridor 标注坐标 (${placement.x}, ${placement.z}) 偏离宿主脸声明值 (7.45, 5.55)`);
  });

  it('断言 4：响应字段与 app 侧消费的字段名逐一对应（renderFactsProjection 层级漂移守护）', () => {
    const consumedPaths = [
      ...collectConsumedProjectPaths(join(ROOT, 'app/src/render/HouseScene.ts')),
      ...collectConsumedProjectPaths(join(ROOT, 'app/src/App.ts')),
    ];
    const uniquePaths = [...new Set(consumedPaths)].sort();
    // 扫描必须扫到这两个「零命中」过的字段，否则本断言自身失效。
    assert.ok(uniquePaths.includes('renderFactsProjection'), `app 侧字段扫描未发现 renderFactsProjection（扫到：${uniquePaths.join(', ')}）`);
    assert.ok(uniquePaths.includes('house.furnishingsAll'), `app 侧字段扫描未发现 house.furnishingsAll（扫到：${uniquePaths.join(', ')}）`);

    const missing = uniquePaths.filter((path) => lookupPath(full, path) === undefined);
    assert.deepEqual(missing, [], `app 消费但响应里不存在的字段路径：\n${missing.join('\n')}\n（renderFactsProjection 必须在响应顶层；house 内不再有副本）`);

    // 层级漂移的直接守卫：顶层有，house 内没有。
    assert.ok('renderFactsProjection' in full, 'renderFactsProjection 不在响应顶层');
    assert.ok(!('renderFactsProjection' in full.house), 'house 内出现了 renderFactsProjection 副本：层级重新漂移，消费方读顶层会拿到 undefined');
  });
});
