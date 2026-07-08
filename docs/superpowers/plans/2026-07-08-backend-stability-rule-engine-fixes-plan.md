# Backend Stability & Rule Engine Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix backend P0 stability issues (MCP async errors, startup config crashes, rule engine condition parser bugs) and replace ad-hoc config loading with a unified `ConfigLoader` plus user-facing config error guidance.

**Architecture:** Introduce a reusable `ConfigLoader<T>` + `ConfigRegistry` that watches YAML/JSON files, falls back on errors, and exposes status via a new `/api/config-status` endpoint. Refactor `server/index.ts` to use the registry for `design-rules.yaml`, `materials.yaml`, and `config/budget/base.json`. Patch MCP route handlers to catch async errors and normalize session headers. Rewrite the rule condition parser to be quote-aware and whitespace-tolerant. Add a persistent frontend banner for config errors.

**Tech Stack:** TypeScript, Node.js, Express 4, chokidar, js-yaml, three.js frontend, node:test

## Global Constraints

- Every exception must be logged or returned to the client; silent swallowing is forbidden.
- The server must never exit because a config file is missing or malformed on startup.
- All file imports in server code must use `.js` extensions for ESM compatibility.
- Keep changes minimal; do not refactor unrelated code.
- SSE fallback remains out of scope.
- `config/house.yaml` and `config/layout/final.yaml` remain out of scope, but `ConfigLoader` must be extensible for them.

---

### Task 1: Create ConfigLoader module

**Files:**
- Create: `server/config-loader.ts`
- Test: `tests/server/config-loader.test.ts`

**Interfaces:**
- Consumes: `chokidar.watch`, `node:fs.readFileSync`
- Produces: `ConfigLoader<T>` class, `ConfigRegistry` class, `ConfigStatus` interface

- [ ] **Step 1: Write the failing test**

Create `tests/server/config-loader.test.ts`:

```ts
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigLoader, ConfigRegistry } from '../../server/config-loader.js';

describe('ConfigLoader', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads and invokes onChange', () => {
    const path = join(dir, 'test.json');
    writeFileSync(path, JSON.stringify({ a: 1 }));
    let called = false;
    const loader = new ConfigLoader(path, JSON.parse, (cfg) => {
      called = true;
      assert.deepEqual(cfg, { a: 1 });
    });
    loader.load();
    assert.equal(called, true);
    assert.equal(loader.getStatus().status, 'ok');
  });

  it('keeps previous config on failure', () => {
    const path = join(dir, 'test.json');
    writeFileSync(path, JSON.stringify({ a: 1 }));
    const loader = new ConfigLoader(path, JSON.parse, () => {});
    loader.load();
    writeFileSync(path, 'not json');
    loader.load();
    assert.deepEqual(loader.getConfig(), { a: 1 });
    assert.equal(loader.getStatus().status, 'failed');
    assert.ok(loader.getStatus().error);
  });

  it('registry aggregates statuses', () => {
    const path = join(dir, 'x.json');
    writeFileSync(path, 'bad');
    const registry = new ConfigRegistry();
    const loader = new ConfigLoader(path, JSON.parse, () => {});
    registry.register(loader);
    loader.load();
    const statuses = registry.getStatuses();
    assert.equal(statuses.length, 1);
    assert.equal(statuses[0].status, 'failed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx tsx --test tests/server/config-loader.test.ts
```

Expected: FAIL with `Cannot find module` or `ConfigLoader is not defined`.

- [ ] **Step 3: Implement ConfigLoader and ConfigRegistry**

Create `server/config-loader.ts`:

```ts
import { watch, type FSWatcher } from 'chokidar';
import { readFileSync } from 'node:fs';

export interface ConfigStatus {
  path: string;
  status: 'ok' | 'failed';
  error?: string;
}

export class ConfigLoader<T> {
  private config: T | undefined;
  private status: ConfigStatus;
  private watcher: FSWatcher | null = null;

  constructor(
    private path: string,
    private parse: (raw: string) => T,
    private onChange: (config: T) => void
  ) {
    this.status = { path, status: 'failed' };
  }

  load(): void {
    try {
      const raw = readFileSync(this.path, 'utf8');
      const config = this.parse(raw);
      this.config = config;
      this.status = { path: this.path, status: 'ok' };
      this.onChange(config);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[config-loader] Failed to load ${this.path}:`, err);
      this.status = { path: this.path, status: 'failed', error };
    }
  }

  startWatching(): void {
    this.watcher = watch(this.path, { persistent: true, ignoreInitial: true });
    this.watcher.on('change', () => this.load());
    this.watcher.on('add', () => this.load());
    this.watcher.on('error', (err: unknown) => {
      console.error(`[config-loader] Watcher error for ${this.path}:`, err);
    });
  }

  async stopWatching(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  getConfig(): T | undefined {
    return this.config;
  }

  getStatus(): ConfigStatus {
    return this.status;
  }
}

export class ConfigRegistry {
  private loaders: ConfigLoader<unknown>[] = [];

  register<T>(loader: ConfigLoader<T>): void {
    this.loaders.push(loader);
  }

  getStatuses(): ConfigStatus[] {
    return this.loaders.map((l) => l.getStatus());
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.loaders.map((l) => l.stopWatching()));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx tsx --test tests/server/config-loader.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/config-loader.ts tests/server/config-loader.test.ts
git commit -m "feat: add unified ConfigLoader and ConfigRegistry"
```

---

### Task 2: Refactor server startup to use ConfigRegistry

**Files:**
- Modify: `server/index.ts`
- Modify: `server/project-catalog.ts`
- Modify: `server/routes.ts`
- Delete: `server/design-rules-watcher.ts`
- Test: `tests/server/api.test.ts` or `tests/server/index.test.ts`

**Interfaces:**
- Consumes: `ConfigLoader<T>`, `ConfigRegistry` from Task 1
- Produces: `ApiDeps` gains `getConfigRegistry: () => ConfigRegistry`; `ProjectCatalog.fromMaterials` static helper

- [ ] **Step 1: Add ProjectCatalog factory for materials + budget base**

Modify `server/project-catalog.ts`. After the existing `static load(...)` method, add:

```ts
static fromMaterials(
  materials: MaterialsYaml,
  budgetBase: {
    total_budget: number;
    categories: Record<string, Omit<BudgetCategory, 'key'>>;
  }
): ProjectCatalog {
  return new ProjectCatalog(materials, budgetBase);
}
```

- [ ] **Step 2: Update ApiDeps type in routes.ts**

In `server/routes.ts`, locate the `ApiDeps` interface and add:

```ts
import type { ConfigRegistry } from './config-loader.js';

interface ApiDeps {
  catalog: ProjectCatalog;
  state: DesignState;
  getRuleEngine: () => RuleEngine;
  getBudgetCalculator: () => BudgetCalculator;
  archiveStore: ArchivedSchemesStore;
  getConfigRegistry: () => ConfigRegistry;
}
```

- [ ] **Step 3: Add /api/config-status route**

In `server/routes.ts`, add after the existing router creation:

```ts
router.get('/config-status', (_req, res) => {
  res.json({ configs: apiDeps.getConfigRegistry().getStatuses() });
});
```

- [ ] **Step 4: Rewrite server/index.ts startup**

Replace the contents of `server/index.ts` with:

```ts
import express from 'express';
import { load } from 'js-yaml';
import { ProjectCatalog } from './project-catalog.js';
import { DesignState } from './design-state.js';
import { createApiRouter } from './routes.js';
import { createMcpServer } from './mcp-server.js';
import { attachMcpTransports } from './mcp-transports.js';
import { RuleEngine } from './rule-engine.js';
import { BudgetCalculator } from './budget-calculator.js';
import { ArchivedSchemesStore } from './archived-schemes.js';
import { ConfigLoader, ConfigRegistry } from './config-loader.js';
import type { DesignRulesConfig, MaterialsYaml } from '../shared/types.js';

const PORT = Number(process.env.PORT ?? 3000);
const DATA_DIR = process.env.DATA_DIR ?? './data';
const CONFIG_PATH = process.env.CONFIG_PATH ?? 'config/design-rules.yaml';

const registry = new ConfigRegistry();

let catalog = ProjectCatalog.fromMaterials(
  { materials: [] },
  { total_budget: 0, categories: {} }
);
let ruleEngine = new RuleEngine({ version: '1.0', risks: [], constraints: [] });
let budgetCalculator = new BudgetCalculator(catalog, ruleEngine.getConfig());

function rebuildDerived(): void {
  const materials = materialsLoader.getConfig() ?? { materials: [] };
  const budgetBase = budgetBaseLoader.getConfig() ?? { total_budget: 0, categories: {} };
  catalog = ProjectCatalog.fromMaterials(materials, budgetBase);
  const rulesConfig = designRulesLoader.getConfig() ?? { version: '1.0', risks: [], constraints: [] };
  ruleEngine = new RuleEngine(rulesConfig);
  budgetCalculator = new BudgetCalculator(catalog, ruleEngine.getConfig());
}

const designRulesLoader = new ConfigLoader<DesignRulesConfig>(
  CONFIG_PATH,
  (raw) => load(raw) as DesignRulesConfig,
  () => {
    rebuildDerived();
    console.log('[server] design-rules.yaml reloaded');
  }
);
registry.register(designRulesLoader);

const materialsLoader = new ConfigLoader<MaterialsYaml>(
  'config/materials.yaml',
  (raw) => load(raw) as MaterialsYaml,
  () => {
    rebuildDerived();
    console.log('[server] materials.yaml reloaded');
  }
);
registry.register(materialsLoader);

const budgetBaseLoader = new ConfigLoader<{ total_budget: number; categories: Record<string, { budget: number; actual: number; status: string; notes: string }> }>(
  'config/budget/base.json',
  (raw) => JSON.parse(raw),
  () => {
    rebuildDerived();
    console.log('[server] config/budget/base.json reloaded');
  }
);
registry.register(budgetBaseLoader);

designRulesLoader.load();
materialsLoader.load();
budgetBaseLoader.load();

let state: DesignState;
try {
  state = DesignState.load(catalog, DATA_DIR);
} catch (err) {
  console.error('[server] Failed to load design state, starting fresh:', err);
  state = new DesignState(catalog, DATA_DIR);
}

const archiveStore = new ArchivedSchemesStore(DATA_DIR);

const apiDeps = {
  catalog,
  state,
  getRuleEngine: () => ruleEngine,
  getBudgetCalculator: () => budgetCalculator,
  archiveStore,
  getConfigRegistry: () => registry,
};

const app = express();
app.use(express.json());
app.use('/api', createApiRouter(apiDeps));

attachMcpTransports(app, () => createMcpServer(apiDeps)).then(() => {
  const server = app.listen(PORT, () => {
    console.log(`Bontop design server listening on http://localhost:${PORT}`);
  });

  designRulesLoader.startWatching();
  materialsLoader.startWatching();
  budgetBaseLoader.startWatching();

  const shutdown = async () => {
    await registry.stopAll();
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
});
```

- [ ] **Step 5: Delete DesignRulesWatcher**

```bash
rm server/design-rules-watcher.ts
```

Remove any remaining imports of `DesignRulesWatcher` from `server/index.ts` (they are already gone after the rewrite).

- [ ] **Step 6: Update existing test fixtures that construct ApiDeps**

Add `import { ConfigRegistry } from '../../server/config-loader.js';` to each of:
- `tests/server/api.test.ts`
- `tests/server/budget-api.test.ts`
- `tests/server/mcp.test.ts`

In each file, locate the `createApiRouter({ ... })` call and add `getConfigRegistry: () => new ConfigRegistry()` to the object.

For example, in `tests/server/api.test.ts`:

```ts
import { ConfigRegistry } from '../../server/config-loader.js';

// ...

createApiRouter({
  catalog,
  state,
  getRuleEngine: () => engine,
  getBudgetCalculator: () => calc,
  archiveStore,
  getConfigRegistry: () => new ConfigRegistry(),
})
```

- [ ] **Step 7: Add server startup test**

Add to `tests/server/index.test.ts` (create if it does not exist):

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createApiRouter } from '../../server/routes.js';
import { attachMcpTransports } from '../../server/mcp-transports.js';
import { createMcpServer } from '../../server/mcp-server.js';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { DesignState } from '../../server/design-state.js';
import { RuleEngine } from '../../server/rule-engine.js';
import { BudgetCalculator } from '../../server/budget-calculator.js';
import { ArchivedSchemesStore } from '../../server/archived-schemes.js';
import { ConfigLoader, ConfigRegistry } from '../../server/config-loader.js';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('server startup resilience', () => {
  it('starts with missing design-rules.yaml and reports it via /api/config-status', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bontop-startup-'));
    rmSync(dir, { recursive: true, force: true });
    mkdtempSync(dir);

    const registry = new ConfigRegistry();
    const designRulesLoader = new ConfigLoader(
      join(dir, 'config', 'design-rules.yaml'),
      (raw) => JSON.parse(raw),
      () => {}
    );
    designRulesLoader.load();
    registry.register(designRulesLoader);

    const catalog = ProjectCatalog.fromMaterials({ materials: [] }, { total_budget: 0, categories: {} });
    const engine = new RuleEngine({ version: '1.0', risks: [], constraints: [] });
    const calc = new BudgetCalculator(catalog, engine.getConfig());
    const archiveStore = new ArchivedSchemesStore(dir);

    const deps = {
      catalog,
      state: new DesignState(catalog, dir),
      getRuleEngine: () => engine,
      getBudgetCalculator: () => calc,
      archiveStore,
      getConfigRegistry: () => registry,
    };

    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(deps));
    await attachMcpTransports(app, () => createMcpServer(deps));

    const response = await new Promise<any>((resolve, reject) => {
      const server = app.listen(0, async () => {
        const port = (server.address() as any).port;
        try {
          const res = await fetch(`http://localhost:${port}/api/config-status`);
          resolve(res);
        } catch (err) {
          reject(err);
        } finally {
          server.close();
        }
      });
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(Array.isArray(body.configs));
    assert.ok(body.configs.some((c: any) => c.path.includes('design-rules.yaml') && c.status === 'failed'));
  });
});
```

- [ ] **Step 8: Run typecheck and tests**

Run:

```bash
npm run typecheck
npm run test:server
```

Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add server/index.ts server/project-catalog.ts server/routes.ts tests/server/index.test.ts tests/server/api.test.ts tests/server/budget-api.test.ts tests/server/mcp.test.ts
git rm server/design-rules-watcher.ts
git commit -m "feat: integrate ConfigRegistry and add /api/config-status"
```

---

### Task 3: Harden MCP transport handlers

**Files:**
- Modify: `server/mcp-transports.ts`
- Test: `tests/server/mcp-transports.test.ts`

**Interfaces:**
- Consumes: Express route handlers, `StreamableHTTPServerTransport`
- Produces: Async route handlers with try/catch, `normalizeSessionId` helper

- [ ] **Step 1: Write the failing test**

Create `tests/server/mcp-transports.test.ts`:

```ts
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { attachMcpTransports } from '../../server/mcp-transports.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

describe('attachMcpTransports', () => {
  let app: express.Express;

  before(async () => {
    app = express();
    app.use(express.json());
    await attachMcpTransports(app, () => ({ connect: async () => {}, close: async () => {} } as unknown as McpServer));
  });

  it('returns 400 for array-valued mcp-session-id header', async () => {
    const res = await request(app)
      .get('/mcp')
      .set('mcp-session-id', ['a', 'b'])
      .send();
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid or missing session id');
  });
});
```

Run:

```bash
npx tsx --test tests/server/mcp-transports.test.ts
```

Expected: FAIL because `attachMcpTransports` does not accept array headers yet.

- [ ] **Step 2: Implement hardened handlers**

Replace `server/mcp-transports.ts` with:

```ts
import { randomUUID } from 'node:crypto';
import type { Express, Request, Response, NextFunction } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

interface McpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

function normalizeSessionId(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') return value[0];
  return undefined;
}

export async function attachMcpTransports(app: Express, createMcpServer: () => McpServer): Promise<void> {
  const sessions = new Map<string, McpSession>();

  app.post('/mcp', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionId = normalizeSessionId(req.headers['mcp-session-id']);

      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        await session.transport.handleRequest(req, res, req.body);
        return;
      }

      const newSessionId = randomUUID();
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
      });

      transport.onclose = () => {
        sessions.delete(newSessionId);
      };

      await server.connect(transport);
      sessions.set(newSessionId, { server, transport });
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      next(err);
    }
  });

  app.get('/mcp', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionId = normalizeSessionId(req.headers['mcp-session-id']);
      if (!sessionId || !sessions.has(sessionId)) {
        res.status(400).json({ error: 'invalid or missing session id' });
        return;
      }
      const session = sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res);
    } catch (err) {
      next(err);
    }
  });

  app.delete('/mcp', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionId = normalizeSessionId(req.headers['mcp-session-id']);
      if (!sessionId || !sessions.has(sessionId)) {
        res.status(400).json({ error: 'invalid or missing session id' });
        return;
      }
      const session = sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res);
      sessions.delete(sessionId);
    } catch (err) {
      next(err);
    }
  });

  app.get('/sse', async (req: Request, res: Response) => {
    const sseServer = createMcpServer();
    const sseTransport = new SSEServerTransport('/messages', res);
    await sseServer.connect(sseTransport);
    await sseTransport.start();
  });

  app.post('/messages', async (_req: Request, res: Response) => {
    res.status(503).json({ error: 'SSE session routing not implemented in Spec 1' });
  });
}
```

- [ ] **Step 3: Run tests**

Run:

```bash
npx tsx --test tests/server/mcp-transports.test.ts
npx tsx --test tests/server/mcp.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/mcp-transports.ts tests/server/mcp-transports.test.ts
git commit -m "fix: harden MCP transport async error handling and session lifecycle"
```

---

### Task 4: Fix RuleEngine condition parser

**Files:**
- Modify: `server/rule-engine.ts`
- Test: `tests/server/rule-engine.test.ts`

**Interfaces:**
- Consumes: existing `parseLiteral`, `parseList`, `resolveVariable`
- Produces: quote-aware `evaluateCondition` function, exported for tests

- [ ] **Step 1: Write the failing test**

Append to `tests/server/rule-engine.test.ts`:

```ts
it('handles quoted strings containing operator substrings', () => {
  assert.equal(evaluateCondition('$topic == "a >= b"', makeContext()), false);
  assert.equal(evaluateCondition('$topic == "a >= b"', makeContext({ topic: 'a >= b' })), true);
});

it('handles operators without surrounding spaces', () => {
  assert.equal(evaluateCondition('$topic=="A2"', makeContext()), true);
  assert.equal(evaluateCondition('$topic!="A2"', makeContext()), false);
});

it('throws when no operator is recognized', () => {
  assert.throws(() => evaluateCondition('$topic "A2"', makeContext()), /No recognized operator/);
});
```

Run:

```bash
npx tsx --test tests/server/rule-engine.test.ts
```

Expected: FAIL on the new tests.

- [ ] **Step 2: Implement quote-aware parser**

In `server/rule-engine.ts`, replace `evaluateCondition` with:

```ts
function extractQuotedLiterals(condition: string): { text: string; literals: string[] } {
  const literals: string[] = [];
  const text = condition.replace(/(["'])(.*?)\1/g, (match, _quote, content) => {
    const index = literals.length;
    literals.push(content);
    return `__QUOTED_${index}__`;
  });
  return { text, literals };
}

function restoreQuotedLiterals(text: string, literals: string[]): string {
  return text.replace(/__QUOTED_(\d+)__/g, (_, index) => literals[Number(index)]);
}

export function evaluateCondition(condition: string, ctx: ConditionContext): boolean {
  const { text, literals } = extractQuotedLiterals(condition);
  const operators = ['not in', 'in', '>=', '<=', '!=', '==', '>', '<'];
  for (const op of operators) {
    const escaped = op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\s*${escaped}\\s*`);
    const match = text.match(regex);
    if (!match || match.index === undefined) continue;
    const leftStr = text.slice(0, match.index).trim();
    const rightStr = text.slice(match.index + match[0].length).trim();
    const leftVal = resolveVariable(leftStr, ctx);
    const restoredRight = restoreQuotedLiterals(rightStr, literals);
    if (op === 'in') {
      const list = parseList(restoredRight);
      return list.some((item) => String(item) === String(leftVal));
    }
    if (op === 'not in') {
      const list = parseList(restoredRight);
      return !list.some((item) => String(item) === String(leftVal));
    }
    const rightVal = parseLiteral(restoredRight);
    switch (op) {
      case '==': return leftVal == rightVal;
      case '!=': return leftVal != rightVal;
      case '>': return Number(leftVal) > Number(rightVal);
      case '<': return Number(leftVal) < Number(rightVal);
      case '>=': return Number(leftVal) >= Number(rightVal);
      case '<=': return Number(leftVal) <= Number(rightVal);
    }
  }
  throw new Error(`No recognized operator in condition: ${condition}`);
}
```

- [ ] **Step 3: Run tests**

Run:

```bash
npx tsx --test tests/server/rule-engine.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/rule-engine.ts tests/server/rule-engine.test.ts
git commit -m "fix: make rule condition parser quote-aware and whitespace-tolerant"
```

---

### Task 5: Add frontend config error banner

**Files:**
- Modify: `app/src/state/StateSync.ts`
- Modify: `app/src/App.ts`
- Modify: `app/style.css`
- Test: `app/src/state/StateSync.test.ts`

**Interfaces:**
- Consumes: `GET /api/config-status` endpoint from Task 2
- Produces: `configError` event from `StateSync`, persistent banner in `App`

- [ ] **Step 1: Add config status polling to StateSync**

Modify `app/src/state/StateSync.ts`:

Add at the top:

```ts
type ConfigErrorCallback = (errors: Array<{ path: string; error: string }>) => void;
```

Add to the class:

```ts
private configErrorCallbacks: ConfigErrorCallback[] = [];
private configStatusInterval: ReturnType<typeof setTimeout> | null = null;
```

Add methods:

```ts
async fetchConfigStatus(): Promise<{ configs: Array<{ path: string; status: 'ok' | 'failed'; error?: string }> }> {
  const response = await fetch('/api/config-status');
  if (!response.ok) throw new Error('Failed to fetch config status');
  return response.json();
}

onConfigError(callback: ConfigErrorCallback): void {
  this.configErrorCallbacks.push(callback);
}
```

Update `start()`:

```ts
start(): void {
  this.pollScheme();
  this.pollVisualCommands();
  this.pollConfigStatus();
}
```

Add poll method:

```ts
private async pollConfigStatus(): Promise<void> {
  try {
    const result = await this.fetchConfigStatus();
    const errors = result.configs
      .filter((c) => c.status === 'failed')
      .map((c) => ({ path: c.path, error: c.error ?? 'unknown error' }));
    this.configErrorCallbacks.forEach((cb) => cb(errors));
    this.configStatusInterval = setTimeout(() => this.pollConfigStatus(), this.schemeBackoff);
  } catch {
    this.configStatusInterval = setTimeout(() => this.pollConfigStatus(), this.schemeBackoff);
  }
}
```

Update `dispose()`:

```ts
dispose(): void {
  if (this.schemeInterval) clearTimeout(this.schemeInterval);
  if (this.visualCommandInterval) clearTimeout(this.visualCommandInterval);
  if (this.configStatusInterval) clearTimeout(this.configStatusInterval);
}
```

- [ ] **Step 2: Add StateSync test for config error event**

Append to `app/src/state/StateSync.test.ts`:

```ts
it('emits configError when a config is failed', async () => {
  vi.spyOn(global, 'fetch').mockImplementation(async (url: string | URL | Request) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    if (urlStr.includes('/api/config-status')) {
      return { ok: true, json: async () => ({ configs: [{ path: 'config/x.yaml', status: 'failed', error: 'bad' }] }) } as Response;
    }
    return { ok: true, json: async () => [] } as Response;
  });

  const sync = new StateSync();
  const configErrorCallback = vi.fn();
  sync.onConfigError(configErrorCallback);
  sync.start();
  await vi.advanceTimersByTimeAsync(0);
  sync.dispose();
  expect(configErrorCallback).toHaveBeenCalledWith([{ path: 'config/x.yaml', error: 'bad' }]);
});
```

- [ ] **Step 3: Add banner rendering to App**

Modify `app/src/App.ts`:

In the constructor after `this.stateSync.onSchemeChange(...)` block, add:

```ts
this.stateSync.onConfigError((errors) => {
  if (errors.length > 0) {
    this.showConfigErrorBanner(errors);
  } else {
    this.hideConfigErrorBanner();
  }
});
```

Add methods:

```ts
private showConfigErrorBanner(errors: Array<{ path: string; error: string }>): void {
  let banner = document.getElementById('config-error-banner') as HTMLDivElement | null;
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'config-error-banner';
    document.body.prepend(banner);
  }
  banner.textContent = `配置文件加载失败：${errors.map((e) => `${e.path} — ${e.error}`).join('; ')}`;
  banner.style.display = 'block';
}

private hideConfigErrorBanner(): void {
  const banner = document.getElementById('config-error-banner') as HTMLDivElement | null;
  if (banner) banner.style.display = 'none';
}
```

- [ ] **Step 4: Add banner CSS**

Append to `app/style.css`:

```css
#config-error-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  background: rgba(180, 60, 60, 0.92);
  color: white;
  padding: 12px 16px;
  text-align: center;
  z-index: 10000;
  font-size: 14px;
  display: none;
}
```

- [ ] **Step 5: Run app typecheck and tests**

Run:

```bash
cd app && npm run typecheck
npm test
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/src/state/StateSync.ts app/src/state/StateSync.test.ts app/src/App.ts app/style.css
git commit -m "feat: show persistent banner for config load failures"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run full typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 2: Run full server test suite**

```bash
npm run test:server
```

Expected: all tests pass

- [ ] **Step 3: Run full app test suite**

```bash
cd app && npm test
```

Expected: all tests pass

- [ ] **Step 4: Manual smoke test**

```bash
npm run dev:server
```

In another terminal:

```bash
mv config/design-rules.yaml config/design-rules.yaml.bak
```

Verify server stays running and logs an error.

Visit `http://localhost:3000/api/config-status` and confirm `design-rules.yaml` is `failed`.

Restore the file:

```bash
mv config/design-rules.yaml.bak config/design-rules.yaml
```

Confirm server logs reload and config status returns to `ok`.

- [ ] **Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "fix: address review feedback and finalize backend stability fixes"
```

---

## Self-Review Checklist

### Spec Coverage

| Spec Section | Implementing Task |
|--------------|-------------------|
| Unified ConfigLoader / ConfigRegistry | Task 1 |
| Startup resilience for design-rules.yaml | Task 2 |
| Startup resilience for materials.yaml | Task 2 |
| Startup resilience for config/budget/base.json | Task 2 |
| Startup resilience for DesignState | Task 2 |
| `/api/config-status` endpoint | Task 2 |
| MCP POST/GET/DELETE error handling | Task 3 |
| MCP session ID header normalization | Task 3 |
| RuleEngine quote-aware parser | Task 4 |
| RuleEngine whitespace-tolerant operators | Task 4 |
| RuleEngine throw on missing operator | Task 4 |
| Frontend config error banner | Task 5 |

### Placeholder Scan

- No TBD, TODO, or "implement later".
- Every test step includes actual test code.
- Every implementation step includes actual code.
- Every command includes expected output.

### Type Consistency

- `ApiDeps` consistently includes `getConfigRegistry: () => ConfigRegistry` after Task 2.
- `ConfigStatus` shape is consistent across `server/config-loader.ts`, `server/routes.ts`, and `app/src/state/StateSync.ts`.
- `evaluateCondition` remains exported with the same signature.
