# Budget Baseline Config Relocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `budget/base.json` to `config/budget/base.json` and update all code and documentation references, establishing a clear separation between static app configuration (`config/`) and financial audit artifacts (`budget/`).

**Architecture:** The server already loads `budget/base.json` through two paths: a `ConfigLoader` in `server/index.ts` (currently pointing at the wrong `config/budget/base.json`) and `ProjectCatalog.load()` in `server/project-catalog.ts` (currently pointing at `budget/base.json`). The fix is to physically move the file to the location the server expects, update `ProjectCatalog.load()`, and update `config/design-rules.yaml` plus all documentation.

**Tech Stack:** TypeScript, Node 20, Express, Git, shell tooling (`sed`, `rg`).

## Global Constraints

- TypeScript `strict: true`, `module: NodeNext`, `moduleResolution: NodeNext`.
- Server listens on `http://localhost:3000`.
- No SQLite; mutable state stored as JSON files in `data/`.
- All changes must be committed to Git with clear messages.
- `budget/base.json` is a static baseline; moving it must not change its schema or the budget calculation logic.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `config/budget/base.json` | Budget baseline (moved from `budget/`) | Created by `git mv` |
| `budget/base.json` | Old budget baseline location | Deleted by `git mv` |
| `server/project-catalog.ts` | Loads budget baseline into `ProjectCatalog` | Path update |
| `config/design-rules.yaml` | Declares where budget categories come from | Path update |
| `README.md` | Project directory structure and quick-start | Update tree + command |
| `budget/changes/README.md` | Change workflow references the baseline | Path update |
| `docs/decision_log.md` | Decision files reference the baseline | Path update |
| `docs/designer_brief.md` | Designer brief references the baseline | Path update |
| `docs/superpowers/specs/2026-07-06-backend-data-foundation-design.md` | Older spec references the baseline | Path update |
| `docs/superpowers/specs/2026-07-06-rule-engine-archive-design.md` | Archive spec references the baseline | Path update |
| `docs/superpowers/plans/2026-07-06-backend-data-foundation-implementation.md` | Older plan references the baseline | Path update |
| `docs/superpowers/plans/2026-07-06-3d-roaming-ai-implementation.md` | 3D roaming plan references the baseline | Path update |
| `scripts/README.md` | Script catalog references the baseline | Path update |

---

### Task 1: Relocate Budget Baseline and Fix Code References

**Files:**
- Create: `config/budget/base.json` (via `git mv budget/base.json config/budget/base.json`)
- Delete: `budget/base.json`
- Modify: `server/project-catalog.ts:96`
- Modify: `config/design-rules.yaml:10`

**Interfaces:**
- Consumes: `ProjectCatalog.load(configDir = '.')` signature, existing `ConfigLoader` in `server/index.ts`.
- Produces: `ProjectCatalog` loads budget baseline from `${configDir}/config/budget/base.json`; `config/design-rules.yaml` references `config/budget/base.json`.

- [ ] **Step 1: Move the file using Git**

```bash
mkdir -p config/budget
git mv budget/base.json config/budget/base.json
ls -la config/budget/
```

Expected: `config/budget/base.json` exists and `git status` shows a rename.

- [ ] **Step 2: Update `server/project-catalog.ts`**

Replace line 96:

```ts
// Before
const budgetBase = JSON.parse(readFileSync(`${configDir}/budget/base.json`, 'utf8')) as {

// After
const budgetBase = JSON.parse(readFileSync(`${configDir}/config/budget/base.json`, 'utf8')) as {
```

Use `edit` or apply the patch. Verify with:

```bash
grep -nE '(^|[^/])budget/base\.json' server/project-catalog.ts
```

Expected: no matches.

- [ ] **Step 3: Update `config/design-rules.yaml`**

Replace line 10:

```yaml
# Before
budget:
  baseCategoriesFrom: budget/base.json

# After
budget:
  baseCategoriesFrom: config/budget/base.json
```

Verify with:

```bash
grep -n 'baseCategoriesFrom' config/design-rules.yaml
```

Expected: `baseCategoriesFrom: config/budget/base.json`.

- [ ] **Step 4: Start the server and verify no ENOENT error**

```bash
timeout 5 npm run dev:server 2>&1 | tee /tmp/server-start.log
```

Expected output contains:

```text
[server] design-rules.yaml reloaded
[server] materials.yaml reloaded
[server] config/budget/base.json reloaded
Bontop design server listening on http://localhost:3000
```

Expected output does NOT contain:

```text
Failed to load config/budget/base.json
```

- [ ] **Step 5: Verify `/api/budget` returns the correct baseline**

```bash
npm run dev:server > /tmp/server.log 2>&1 &
SERVER_PID=$!
sleep 3
curl -s http://localhost:3000/api/budget | python3 -m json.tool | grep -E '"totalBudget"|"categories"'
kill $SERVER_PID
```

Expected: `totalBudget` is `110000` and `categories` has 17 entries.

- [ ] **Step 6: Commit the code changes**

```bash
git add server/project-catalog.ts config/design-rules.yaml
git status
# Expect: rename budget/base.json -> config/budget/base.json, plus two modified files
git commit -m "refactor: move budget/base.json to config/budget/base.json and fix code references"
```

---

### Task 2: Update Documentation References

**Files:**
- Modify: `README.md`
- Modify: `budget/changes/README.md`
- Modify: `docs/decision_log.md`
- Modify: `docs/designer_brief.md`
- Modify: `docs/superpowers/specs/2026-07-06-backend-data-foundation-design.md`
- Modify: `docs/superpowers/specs/2026-07-06-rule-engine-archive-design.md`
- Modify: `docs/superpowers/plans/2026-07-06-backend-data-foundation-implementation.md`
- Modify: `docs/superpowers/plans/2026-07-06-3d-roaming-ai-implementation.md`
- Modify: `scripts/README.md`

**Interfaces:**
- Consumes: New location `config/budget/base.json`.
- Produces: All documentation consistently points to the new location; no stale `budget/base.json` references remain in the listed files.

- [ ] **Step 1: Update the `README.md` directory tree**

The current tree section:

```text
├── budget/                    # 预算与支付
│   ├── base.json              # 基线预算
│   ├── payments/              # 付款凭证
│   └── changes/               # 变更记录
├── config/                    # 结构化配置
│   ├── house.yaml             # 户型基础数据
│   ├── layout/                # 概念方案与定稿布局
│   └── materials.yaml         # 材料规格库
```

Replace with:

```text
├── config/                    # 结构化配置
│   ├── house.yaml             # 户型基础数据
│   ├── layout/                # 概念方案与定稿布局
│   ├── materials.yaml         # 材料规格库
│   ├── design-rules.yaml      # 设计规则
│   └── budget/                # 预算基线
│       └── base.json          # 基线预算
├── budget/                    # 预算变更与支付
│   ├── payments/              # 付款凭证
│   └── changes/               # 变更记录
```

Also verify the quick-start command `cat budget/base.json` is now `cat config/budget/base.json` (the bulk replacement in Step 2 will handle this, but confirm).

- [ ] **Step 2: Replace `budget/base.json` with `config/budget/base.json` in all other docs**

```bash
for f in \
  README.md \
  budget/changes/README.md \
  docs/decision_log.md \
  docs/designer_brief.md \
  docs/superpowers/specs/2026-07-06-backend-data-foundation-design.md \
  docs/superpowers/specs/2026-07-06-rule-engine-archive-design.md \
  docs/superpowers/plans/2026-07-06-backend-data-foundation-implementation.md \
  docs/superpowers/plans/2026-07-06-3d-roaming-ai-implementation.md \
  scripts/README.md; do
  sed -i 's|\([^/]\)budget/base\.json|\1config/budget/base.json|g' "$f"
done
```

Verify no stale references to the old location remain in the listed files. The new canonical path `config/budget/base.json` contains the substring `budget/base.json`, so use a path-aware regex that excludes lines where the path is already `config/...`:

```bash
for f in README.md budget/changes/README.md docs/decision_log.md docs/designer_brief.md docs/superpowers/specs/2026-07-06-backend-data-foundation-design.md docs/superpowers/specs/2026-07-06-rule-engine-archive-design.md docs/superpowers/plans/2026-07-06-backend-data-foundation-implementation.md docs/superpowers/plans/2026-07-06-3d-roaming-ai-implementation.md scripts/README.md; do
  result=$(grep -nE '(^|[^/])budget/base\.json' "$f" || true)
  if [ -n "$result" ]; then
    echo "STALE: $f"
    echo "$result"
  fi
done
```

Expected: no output.

- [ ] **Step 3: Review the diff for documentation changes**

```bash
git diff -- README.md budget/changes/README.md docs/decision_log.md docs/designer_brief.md docs/superpowers/specs/2026-07-06-backend-data-foundation-design.md docs/superpowers/specs/2026-07-06-rule-engine-archive-design.md docs/superpowers/plans/2026-07-06-backend-data-foundation-implementation.md docs/superpowers/plans/2026-07-06-3d-roaming-ai-implementation.md scripts/README.md
```

Expected: only path changes from `budget/base.json` to `config/budget/base.json` and the README tree restructuring.

- [ ] **Step 4: Commit documentation updates**

```bash
git add README.md budget/changes/README.md docs/decision_log.md docs/designer_brief.md docs/superpowers/specs/2026-07-06-backend-data-foundation-design.md docs/superpowers/specs/2026-07-06-rule-engine-archive-design.md docs/superpowers/plans/2026-07-06-backend-data-foundation-implementation.md docs/superpowers/plans/2026-07-06-3d-roaming-ai-implementation.md scripts/README.md
git commit -m "docs: update all references from budget/base.json to config/budget/base.json"
```

---

### Task 3: Full Verification

**Files:**
- Test: all backend tests via `npm run test:server`
- Test: typecheck via `npm run typecheck`

**Interfaces:**
- Consumes: relocated `config/budget/base.json`, updated `ProjectCatalog`, existing test suite.
- Produces: green test suite and clean typecheck.

- [ ] **Step 1: Run the backend test suite**

```bash
npm run test:server
```

Expected: all tests pass.

- [ ] **Step 2: Run typecheck for both backend and frontend**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Final grep across the repo for stale references**

```bash
rg '(^|[^/])budget/base\.json' --type md --type ts --type yaml --type json
```

Expected: only matches in historical files that intentionally keep the old path (none expected). If unexpected matches appear, fix them or document why they stay.

- [ ] **Step 4: Commit any verification fixes (if needed)**

If any tests or stale references required fixes, commit them with a clear message. If no fixes were needed, this step is a no-op.

```bash
git status
# If clean, nothing to commit.
```

---

## Spec Coverage Check

| Spec Section | Task | Step |
|--------------|------|------|
| Move `budget/base.json` to `config/budget/base.json` | Task 1 | Step 1 |
| Update `server/project-catalog.ts` | Task 1 | Step 2 |
| Update `config/design-rules.yaml` | Task 1 | Step 3 |
| Verify server starts without ENOENT | Task 1 | Step 4 |
| Verify `/api/budget` | Task 1 | Step 5 |
| Update `README.md` | Task 2 | Step 1 |
| Update other documentation | Task 2 | Step 2 |
| Run full test suite | Task 3 | Step 1 |
| Run typecheck | Task 3 | Step 2 |
| Final stale-reference check | Task 3 | Step 3 |

## Placeholder Scan

- No TBD/TODO/fill-in details.
- No vague "update docs" without listing files.
- No "handle edge cases" without specifics.
- All commands include expected output.

## Type Consistency Check

- `ProjectCatalog.load(configDir)` continues to accept the same `configDir` parameter; only the internal budget path changes.
- `config/design-rules.yaml` keeps the same `baseCategoriesFrom` key; only the value changes.
- No function signatures or data structures change.
