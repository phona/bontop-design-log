# Backend Stability & Rule Engine Fixes

## Status

Draft → pending implementation

## Scope

This spec covers the first iteration of bug fixes following the code review of commits `3847607` through `ff800b2`. The goal is to eliminate backend P0 issues and replace the existing ad-hoc config loading with a single, consistent mechanism.

### In Scope

- A unified `ConfigLoader` / `ConfigRegistry` for all server-side configuration files
- Consistent startup resilience and hot-reload for:
  - `config/design-rules.yaml`
  - `config/materials.yaml`
  - `config/budget/base.json`
- Server startup resilience for `DesignState.load` failures
- MCP Streamable HTTP transport error handling and session lifecycle
- `RuleEngine` condition parser: quoted strings containing operator-like substrings
- `RuleEngine` condition parser: operator expressions without surrounding spaces
- New `/api/config-status` endpoint exposing per-file load status
- Frontend user guidance when a configuration file fails to load

### Out of Scope

- SSE fallback implementation (`/sse` + `/messages`)
- Full DSL rewrite for rule conditions
- Large-scale MCP refactoring
- Header authentication or authorization
- Loading `config/house.yaml` or `config/layout/final.yaml` (pre-existing gap; loader must be extensible for them)

## Background

The recent backend additions introduced several problems:

1. **Ad-hoc config loading:** `design-rules.yaml` has a custom watcher, while `materials.yaml` and `budget/base.json` are loaded once by `ProjectCatalog` with no reload path. Some required config files are not loaded at all.
2. **No user guidance:** When a config file fails, only a server-side `console.error` is produced. The user has no indication in the UI that the config is broken or how to repair it.
3. **MCP fragility:** The Express 4 routes for MCP discard async errors and delete sessions before requests finish, leading to hanging requests and potential process crashes.
4. **Rule parser bugs:** The condition parser splits on operator substrings without respecting quoted literals, so a value like `"a >= b"` is mis-parsed.

These issues are foundational: if the server cannot start, cannot notify the user of config problems, or MCP requests hang, the rest of the system is unusable.

## Design

### 1. Unified Config Loading

**New file:** `server/config-loader.ts`

Introduce a `ConfigLoader<T>` class with the following responsibilities:

- Load a single file (YAML or JSON) synchronously on first access.
- Parse the file through a caller-supplied parser function.
- Watch the file for `change` and `add` events using `chokidar`.
- On successful load/parse:
  - Store the parsed config.
  - Set status to `ok`.
  - Invoke the caller-supplied `onChange(config)` callback.
- On failure:
  - Keep the previously loaded config if one exists; otherwise keep `undefined`.
  - Set status to `failed` and record the error message.
  - Log the failure with `console.error`, including the file path and the original error.
  - Continue watching so a corrected file is picked up later.
- Expose:
  - `getConfig(): T | undefined`
  - `getStatus(): ConfigStatus` where `ConfigStatus = { path: string; status: 'ok' | 'failed'; error?: string }`
  - `load(): void`
  - `startWatching(): void`
  - `stopWatching(): void` (await close)

Introduce a `ConfigRegistry` that holds all loaders and exposes `getStatuses(): ConfigStatus[]`.

**Error handling policy for config loading:**

- No empty `catch {}` blocks.
- Every failure is logged with full context.
- The server must never exit because a config file is missing or malformed on startup.

### 2. Server Integration

**File:** `server/index.ts`

Refactor startup to use the registry:

1. Create a `ConfigRegistry` instance.
2. Register loaders for:
   - `config/design-rules.yaml` → parse with `js-yaml.load`, on change rebuild `ruleEngine` and `budgetCalculator`.
   - `config/materials.yaml` → parse with `js-yaml.load`, on change rebuild `ProjectCatalog` and dependent `BudgetCalculator`.
   - `config/budget/base.json` → parse with `JSON.parse`, on change rebuild `ProjectCatalog` and dependent `BudgetCalculator`.
   - Loaders are independent. If one config is failed, its loader retains the last successful value (or `undefined`) and other loaders continue to reload normally. Rebuild callbacks must be prepared to run with the current available data.
3. Call `load()` on every registered loader before constructing Express routes.
4. Call `startWatching()` on every loader after the server starts listening.
5. Wrap `DesignState.load(catalog, DATA_DIR)` in `try/catch`:
   - On failure, log the error and create a fresh `DesignState` with empty selections and decision log.
   - Continue server startup.

Remove the existing `DesignRulesWatcher` file and its usage, or refactor it to use `ConfigLoader` internally. The preferred path is removal in favor of `ConfigLoader`.

### 3. Config Status API

**File:** `server/routes.ts`

Add a read-only endpoint:

```
GET /api/config-status
```

Response body:

```json
{
  "configs": [
    { "path": "config/design-rules.yaml", "status": "ok" },
    { "path": "config/materials.yaml", "status": "failed", "error": "ENOENT: no such file or directory" }
  ]
}
```

The endpoint reads statuses from the shared `ConfigRegistry` instance passed through `ApiDeps`.

### 4. Frontend User Guidance

**Files:** `app/src/state/StateSync.ts`, `app/src/App.ts`, `app/src/ui/OfflineIndicator.ts` or a new banner

- `StateSync` polls `/api/config-status` at the same interval as the scheme poll (initially 1 second, with backoff on errors).
- If any config has `status === 'failed'`, `StateSync` emits a `configError` event carrying the list of failed files and error messages.
- `App` listens for `configError` and displays a **persistent** non-blocking banner at the top of the viewport.
- The banner shows text such as:
  - "配置文件加载失败：config/design-rules.yaml — YAML 解析错误"
- The banner remains visible while any config is `failed` and disappears once all configs return to `ok`.
- Do not reuse the existing 3-second auto-hide toast for this; config errors need continuous visibility.

### 5. MCP Transport Robustness

**File:** `server/mcp-transports.ts`

#### POST /mcp

- Wrap `server.connect(transport)` and `transport.handleRequest(req, res, req.body)` in `try/catch`.
- On error, call `next(err)` so Express can respond with 500.
- Do not silently discard the error.

#### GET /mcp and DELETE /mcp

- Change `void session.transport.handleRequest(req, res)` to `await session.transport.handleRequest(req, res)` inside `try/catch`.
- For `DELETE`, wait until `handleRequest` completes before removing the session from `sessions`.
- On error, call `next(err)` or send a 500 response.

#### Session ID Header Normalization

- Read `req.headers['mcp-session-id']` and normalize it:
  - `undefined` → `undefined`
  - `string` → use as-is
  - `string[]` → use the first element
  - Any other value → respond with 400
- If the normalized session ID is missing or not found, respond with 400 as today.

#### Session Lifecycle

- Keep `transport.onclose = () => sessions.delete(newSessionId)` for automatic cleanup.
- Explicit `DELETE /mcp` cleans up the session after the transport finishes handling the request.

### 6. Rule Engine Condition Parser

**File:** `server/rule-engine.ts`

#### Current Behavior

`evaluateCondition` searches for operators using `condition.indexOf(' ${op} ')`. This:
- Mis-splits quoted literals containing operator text (e.g., `$topic == "a >= b"`).
- Fails to match operators without surrounding spaces (e.g., `$topic=="A1"`).
- Silently returns `false` when no operator is found.

#### New Behavior

1. **Quote-aware tokenization:**
   - Extract quoted substrings (single or double quotes) first and replace them with deterministic placeholders such as `__QUOTED_0__`.
   - Split the remaining string by operators.
   - Restore the quoted literals before evaluating the right-hand side.
2. **Whitespace-tolerant operator matching:**
   - Allow operators with optional surrounding whitespace (e.g., `==`, `>=`, `in`, `not in`).
3. **No silent fallback on missing operator:**
   - If no operator is found, throw a descriptive error instead of returning `false`.
   - This prevents misconfigured rules from silently never triggering.

#### Supported Operators

Keep the existing operator set:

- `not in`
- `in`
- `>=`
- `<=`
- `!=`
- `==`
- `>`
- `<`

## Testing Strategy

### Config Loader Tests (`tests/server/config-loader.test.ts`)

- Successful load invokes `onChange` with parsed config.
- Failed load keeps previous config and records status `failed`.
- Failed load followed by successful reload invokes `onChange` with the new config and updates status to `ok`.
- `startWatching`/`stopWatching` lifecycle works without leaking watchers.

### Server Startup Tests

- Server starts when `config/design-rules.yaml` is missing.
- Server starts when `config/materials.yaml` is missing.
- Server starts when `config/budget/base.json` is malformed.
- `/api/config-status` reflects each failure.

### Config Status API Tests

- `GET /api/config-status` returns 200 with a `configs` array.
- Each entry has `path`, `status`, and optional `error`.

### MCP Tests (`tests/server/mcp.test.ts`)

- Simulate a transport error during `POST /mcp` and assert the response status is 500 with JSON body `{ error: string }`.
- Assert `DELETE /mcp` does not remove the session from the internal `sessions` map until `transport.handleRequest` resolves.
- Assert an array-valued `mcp-session-id` header returns 400 with JSON body `{ error: 'invalid or missing session id' }`.

### Rule Engine Tests (`tests/server/rule-engine.test.ts`)

- `$topic == "a >= b"` evaluates as a string equality comparison.
- `$topic in ["A", "B"]` evaluates as a list membership check.
- `$topic=="A1"` (no spaces) evaluates correctly.
- A condition with no recognized operator throws, not returns `false`.

### Frontend Guidance Tests

- `StateSync` emits `configError` when `/api/config-status` reports a failed config.
- `App` displays a banner when `configError` is received.
- Banner disappears when all configs return to `ok`.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Quote-aware parser changes behavior of existing rules | Add comprehensive tests covering old and new cases before changing parser logic. |
| MCP error responses break existing clients | Return standard HTTP 500 JSON with `{ error: string }`, consistent with existing 400 responses. |
| Replacing `DesignRulesWatcher` introduces regressions | Keep behavior equivalent: same file path, same `change`/`add` events, same rebuild of `ruleEngine`/`budgetCalculator`. |
| Larger diff than originally planned | The new `ConfigLoader` is additive; existing logic is moved into callbacks rather than rewritten. |

## Success Criteria

- `npm run test:server` passes, including new tests.
- `npm run typecheck` passes.
- Server starts successfully when any config file is missing or malformed.
- Editing or creating a config file triggers a reload through `ConfigLoader`.
- `/api/config-status` accurately reports the status of every watched config file.
- The frontend shows a clear banner when any config file fails to load.
- MCP `POST /mcp`, `GET /mcp`, and `DELETE /mcp` handle transport errors without hanging or crashing.
- Rule conditions with quoted operator substrings evaluate correctly.

## Dependencies

- Existing `server/mcp-transports.ts`
- Existing `server/rule-engine.ts`
- Existing `server/index.ts`
- Existing `server/routes.ts`
- Existing `server/design-rules-watcher.ts` (to be removed or refactored)
- Existing `server/project-catalog.ts`
- Existing `app/src/state/StateSync.ts`
- Existing `app/src/App.ts`
- Existing test setup in `tests/server/` and `app/`
