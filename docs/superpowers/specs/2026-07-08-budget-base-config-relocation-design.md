# Design: Relocate Budget Baseline to config/budget/base.json

## 1. Background

The server startup currently logs an error:

```text
[config-loader] Failed to load config/budget/base.json: Error: ENOENT: no such file or directory, open 'config/budget/base.json'
```

The file actually exists at `budget/base.json`. `server/index.ts` expects `config/budget/base.json`, while `server/project-catalog.ts` and `config/design-rules.yaml` still reference `budget/base.json`. This inconsistency is both a bug and a signal that the directory taxonomy is unclear.

## 2. Goal

Establish a clean separation:

- `config/` — all static configuration files that are loaded at startup and drive application behavior.
- `budget/` — financial audit artifacts (change orders, payment records) that are not directly consumed by the running application.
- `data/` — runtime mutable state (current scheme, decision log, archived schemes).

Move `budget/base.json` to `config/budget/base.json` so that every file the app reads at startup lives under `config/`.

## 3. Final Directory Structure

```text
config/                          # static app inputs
  ├── house.yaml
  ├── materials.yaml
  ├── layout/final.yaml
  ├── design-rules.yaml
  └── budget/
      └── base.json              # budget baseline (moved from budget/)

budget/                          # financial audit trail
  └── changes/
      └── CHG-YYYY-MM-DD-NNN.json

data/                            # runtime state
  ├── current-scheme.json
  ├── decision-log.json
  └── archived-schemes.json
```

## 4. Changes

### 4.1 File move

- `budget/base.json` → `config/budget/base.json`

### 4.2 Code references

| File | Current | New |
|------|---------|-----|
| `server/project-catalog.ts:96` | `${configDir}/budget/base.json` | `${configDir}/config/budget/base.json` |
| `config/design-rules.yaml:10` | `baseCategoriesFrom: budget/base.json` | `baseCategoriesFrom: config/budget/base.json` |
| `server/index.ts:57` | `'config/budget/base.json'` | already correct after the move |

### 4.3 Documentation references

Update the following documents to use `config/budget/base.json`:

- `README.md` (directory tree and quick-start command)
- `budget/changes/README.md` (step 5 of the change workflow)
- `docs/decision_log.md` (related files in two decisions)
- `docs/designer_brief.md` (budget baseline description)
- `docs/superpowers/specs/2026-07-06-backend-data-foundation-design.md`
- `docs/superpowers/specs/2026-07-06-rule-engine-archive-design.md`
- `docs/superpowers/plans/2026-07-06-backend-data-foundation-implementation.md`
- `docs/superpowers/plans/2026-07-06-3d-roaming-ai-implementation.md`
- `scripts/README.md` (`calc_budget.py` inputs/outputs)

## 5. Behavior

After relocation:

- `npm run dev:server` starts without the ENOENT error.
- `config/budget/base.json` is watched by the existing `ConfigLoader` in `server/index.ts`, so edits to the budget baseline trigger a hot reload of `ProjectCatalog` and `BudgetCalculator`.
- `GET /api/budget` continues to return the budget snapshot built from the baseline plus computed actuals.
- Existing tests that call `ProjectCatalog.load('.')` continue to work after updating the path inside `ProjectCatalog.load`.

## 6. Verification

1. Start the server: `npm run dev:server` — expect no `config/budget/base.json` ENOENT.
2. Query budget: `curl http://localhost:3000/api/budget` — expect total budget `110000` and 17 categories.
3. Run backend tests: `npm run test:server` — expect all pass.
4. Typecheck: `npm run typecheck` — expect no errors.

## 7. Non-Goals

- No changes to the JSON schema of `base.json`.
- No changes to budget calculation logic.
- No changes to the `budget/changes/` directory location or naming convention.
- No changes to how `data/` runtime state is persisted.
