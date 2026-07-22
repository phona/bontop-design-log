import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ProjectCatalog } from './project-catalog.js';
import type { DesignState } from './design-state.js';
import type { RuleEngine } from './rule-engine.js';
import type { BudgetCalculator } from './budget-calculator.js';
import type { ArchivedSchemesStore } from './archived-schemes.js';
import type { CurrentScheme } from '../shared/types.js';

function text(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

export interface McpDeps {
  catalog: ProjectCatalog;
  state: DesignState;
  getRuleEngine: () => RuleEngine;
  getBudgetCalculator: () => BudgetCalculator;
  archiveStore: ArchivedSchemesStore;
}

export function createMcpServer(deps: McpDeps): McpServer {
  const { catalog, state, getRuleEngine, getBudgetCalculator, archiveStore } = deps;
  const server = new McpServer(
    { name: 'bontop-design', version: '0.2.0' },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    'get_project_summary',
    { title: 'Get project summary', description: 'Return house, topics, and budget base.' },
    async () => {
      return text({
        rooms: catalog.getRooms().map((r) => ({ id: r.id, name: r.name })),
        topics: catalog.getTopics().map((t) => ({ id: t.id, name: t.name, perRoom: t.perRoom })),
        budgetCategories: catalog.getBudgetCategories(),
      });
    }
  );

  server.registerTool(
    'get_current_scheme',
    { title: 'Get current scheme', description: 'Return current selections.' },
    async () => text(state.getCurrentScheme())
  );

  server.registerTool(
    'get_decisions',
    { title: 'Get decision log', description: 'Return recorded decisions.' },
    async () => text(state.getDecisionLog())
  );

  server.registerTool(
    'list_topics',
    { title: 'List topics', description: 'List all design topics.' },
    async () =>
      text(
        catalog.getTopics().map((t) => ({
          id: t.id,
          name: t.name,
          perRoom: t.perRoom,
          options: t.options.map((o) => o.id),
        }))
      )
  );

  server.registerTool(
    'list_options',
    {
      title: 'List options',
      description: 'List options for a topic.',
      inputSchema: z.object({ topic: z.string() }),
    },
    async (args) => {
      const options = catalog.getOptions(args.topic);
      if (options.length === 0) return text({ error: 'topic not found' });
      return text(options.map((o) => ({ id: o.id, name: o.name, price_per_unit: o.price_per_unit })));
    }
  );

  server.registerTool(
    'get_option_details',
    {
      title: 'Get option details',
      description: 'Return full details of one option.',
      inputSchema: z.object({ topic: z.string(), optionId: z.string() }),
    },
    async (args) => {
      const option = catalog.getOption(args.topic, args.optionId);
      if (!option) return text({ error: 'option not found' });
      return text(option);
    }
  );

  server.registerTool(
    'get_view_context',
    { title: 'Get view context', description: 'Return the currently selected object in the App.' },
    async () => text(state.getViewContext())
  );

  server.registerTool(
    'set_selection',
    {
      title: 'Set selection',
      description: 'Set a single topic default or per-room override.',
      inputSchema: z.object({
        topic: z.string(),
        optionId: z.string().nullable(),
        roomId: z.string().optional(),
        reason: z.string().optional(),
        source: z.string().optional(),
      }),
    },
    async (args) => {
      const result = state.applySelections(
        [{ topic: args.topic, optionId: args.optionId, roomId: args.roomId, reason: args.reason }],
        args.reason,
        args.source ?? 'ai'
      );
      const calc = getBudgetCalculator();
      const engine = getRuleEngine();
      const newScheme = state.getCurrentScheme();
      const prevBudget = calc.calculate(result.previousScheme);
      const newBudget = calc.calculate(newScheme);
      const newRisks = engine.evaluate(newScheme, catalog);
      const categoryDeltas = newBudget.categories
        .map((c, i) => ({
          key: c.key,
          delta: c.actual - prevBudget.categories[i].actual,
          status: c.status,
        }))
        .filter((d) => d.delta !== 0);
      return text({
        updated: result.updated,
        entries: result.entries,
        budgetImpact: {
          totalDelta: newBudget.totalActual - prevBudget.totalActual,
          totalActual: newBudget.totalActual,
          totalBudget: newBudget.totalBudget,
          categoryDeltas,
          overCategories: newBudget.categories.filter((c) => c.status === 'over'),
          risks: newRisks.risks,
        },
      });
    }
  );

  server.registerTool(
    'batch_set_selections',
    {
      title: 'Batch set selections',
      description: 'Atomic batch update of multiple selections.',
      inputSchema: z.object({
        selections: z.array(
          z.object({
            topic: z.string(),
            optionId: z.string().nullable(),
            roomId: z.string().optional(),
            reason: z.string().optional(),
          })
        ),
        reason: z.string().optional(),
        source: z.string().optional(),
      }),
    },
    async (args) => {
      const result = state.applySelections(args.selections, args.reason, args.source ?? 'ai');
      const calc = getBudgetCalculator();
      const engine = getRuleEngine();
      const newScheme = state.getCurrentScheme();
      const prevBudget = calc.calculate(result.previousScheme);
      const newBudget = calc.calculate(newScheme);
      const newRisks = engine.evaluate(newScheme, catalog);
      const categoryDeltas = newBudget.categories
        .map((c, i) => ({
          key: c.key,
          delta: c.actual - prevBudget.categories[i].actual,
          status: c.status,
        }))
        .filter((d) => d.delta !== 0);
      return text({
        updated: result.updated,
        entries: result.entries,
        budgetImpact: {
          totalDelta: newBudget.totalActual - prevBudget.totalActual,
          totalActual: newBudget.totalActual,
          totalBudget: newBudget.totalBudget,
          categoryDeltas,
          overCategories: newBudget.categories.filter((c) => c.status === 'over'),
          risks: newRisks.risks,
        },
      });
    }
  );

  server.registerTool(
    'record_decision',
    {
      title: 'Record decision',
      description: 'Append a decision record without changing the scheme.',
      inputSchema: z.object({
        topic: z.string().optional(),
        roomId: z.string().optional(),
        optionId: z.string().optional(),
        reason: z.string().optional(),
        source: z.string().optional(),
      }),
    },
    async (args) => {
      const entry = state.recordDecision(args);
      return text({ id: entry.id });
    }
  );

  server.registerTool(
    'set_camera_target',
    {
      title: 'Set camera target',
      description: 'Ask the App to move the camera to an object.',
      inputSchema: z.object({ targetId: z.string(), mode: z.string().optional() }),
    },
    async (args) => {
      const cmd = state.appendVisualCommand('set_camera_target', {
        targetId: args.targetId,
        mode: args.mode,
      });
      return text({ commandId: cmd.commandId });
    }
  );

  server.registerTool(
    'highlight_object',
    {
      title: 'Highlight object',
      description: 'Ask the App to highlight an object.',
      inputSchema: z.object({ objectId: z.string() }),
    },
    async (args) => {
      const cmd = state.appendVisualCommand('highlight_object', { objectId: args.objectId });
      return text({ commandId: cmd.commandId });
    }
  );

  server.registerTool(
    'get_budget',
    {
      title: 'Get budget',
      description: 'Return budget breakdown with categories and line items.',
    },
    async () => {
      const scheme = state.getCurrentScheme();
      const calc = getBudgetCalculator();
      return text(calc.calculate(scheme));
    }
  );

  server.registerTool(
    'get_risks',
    {
      title: 'Get risks',
      description: 'Return current risks and constraint violations.',
    },
    async () => {
      const scheme = state.getCurrentScheme();
      const engine = getRuleEngine();
      return text(engine.evaluate(scheme, catalog));
    }
  );

  server.registerTool(
    'run_design_check',
    {
      title: 'Run design check',
      description: 'Evaluate all risk and constraint rules against current scheme.',
    },
    async () => {
      const scheme = state.getCurrentScheme();
      const engine = getRuleEngine();
      return text(engine.evaluate(scheme, catalog));
    }
  );

  server.registerTool(
    'get_archived_schemes',
    {
      title: 'Get archived schemes',
      description: 'List all archived design schemes.',
    },
    async () => text(archiveStore.list())
  );

  server.registerTool(
    'archive_scheme',
    {
      title: 'Archive current scheme',
      description: 'Save current scheme as a named archive.',
      inputSchema: z.object({
        name: z.string(),
        reason: z.string().optional(),
      }),
    },
    async (args) => {
      const scheme = state.getCurrentScheme();
      const result = archiveStore.create(scheme, args.name, args.reason);
      if (result.error) return text({ error: result.error });
      return text(result.scheme);
    }
  );

  server.registerTool(
    'compare_schemes',
    {
      title: 'Compare schemes',
      description: 'Compare current scheme against an archived scheme. Returns budget diff, selection diffs, and risk changes.',
      inputSchema: z.object({ archiveId: z.string() }),
    },
    async (args) => {
      const archived = archiveStore.get(args.archiveId);
      if (!archived) return text({ error: 'archived scheme not found' });

      const current = state.getCurrentScheme();
      const currentBudget = getBudgetCalculator().calculate(current);
      const currentRisks = getRuleEngine().evaluate(current, catalog);
      const compareBudget = getBudgetCalculator().calculate({
        ...archived,
        updatedAt: archived.createdAt,
      } as CurrentScheme);
      const compareRisks = getRuleEngine().evaluate(
        { ...archived, updatedAt: archived.createdAt } as CurrentScheme, catalog
      );

      const allTopics = new Set([
        ...Object.keys(current.selections),
        ...Object.keys(archived.selections),
      ]);

      const selectionDiffs: Array<{
        topic: string;
        current: string | null;
        compare: string | null;
        priceDelta: number;
      }> = [];

      for (const topic of allTopics) {
        const curOptId = current.selections[topic]?.default ?? null;
        const cmpOptId = archived.selections[topic]?.default ?? null;
        if (curOptId === cmpOptId) continue;
        const curOpt = curOptId ? catalog.getOption(topic, curOptId) : null;
        const cmpOpt = cmpOptId ? catalog.getOption(topic, cmpOptId) : null;
        selectionDiffs.push({
          topic,
          current: curOpt?.name ?? curOptId,
          compare: cmpOpt?.name ?? cmpOptId,
          priceDelta: (cmpOpt?.price_per_unit ?? 0) - (curOpt?.price_per_unit ?? 0),
        });
      }

      const currentRiskIds = new Set(currentRisks.risks.map((r) => r.id));
      const compareRiskIds = new Set(compareRisks.risks.map((r) => r.id));

      return text({
        current: { scheme: current, budget: currentBudget, risks: currentRisks },
        compare: { scheme: archived, budget: compareBudget, risks: compareRisks },
        diff: {
          budget: compareBudget.totalActual - currentBudget.totalActual,
          selections: selectionDiffs,
          risks: {
            added: compareRisks.risks.filter((r) => !currentRiskIds.has(r.id)),
            removed: currentRisks.risks.filter((r) => !compareRiskIds.has(r.id)),
          },
        },
      });
    }
  );

  server.registerTool(
    'restore_scheme',
    {
      title: 'Restore archived scheme',
      description: 'Restore an archived scheme as the current scheme.',
      inputSchema: z.object({ schemeId: z.string() }),
    },
    async (args) => {
      const archived = archiveStore.get(args.schemeId);
      if (!archived) return text({ error: 'archived scheme not found' });

      const current = state.getCurrentScheme();
      const patches: Array<{ topic: string; optionId: string | null; roomId?: string | null; reason?: string }> = [];

      const allTopics = new Set([
        ...Object.keys(archived.selections),
        ...Object.keys(current.selections),
      ]);

      for (const topic of allTopics) {
        const archSel = archived.selections[topic] ?? { default: null, roomOverrides: {} };
        const curSel = current.selections[topic] ?? { default: null, roomOverrides: {} };

        if (archSel.default !== curSel.default) {
          patches.push({ topic, optionId: archSel.default, reason: `restored from ${archived.id}` });
        }

        const allRooms = new Set([
          ...Object.keys(archSel.roomOverrides),
          ...Object.keys(curSel.roomOverrides),
        ]);
        for (const roomId of allRooms) {
          const archVal = archSel.roomOverrides[roomId] ?? null;
          const curVal = curSel.roomOverrides[roomId] ?? null;
          if (archVal !== curVal) {
            patches.push({ topic, optionId: archVal, roomId, reason: `restored from ${archived.id}` });
          }
        }
      }

      if (patches.length > 0) {
        const result = state.applySelections(patches, `restored from ${archived.id}`, 'restore');
        for (const entry of result.entries) {
          entry.archiveId = archived.id;
        }
        state.persist();
      }

      return text({ restored: true, archiveId: archived.id, scheme: state.getCurrentScheme() });
    }
  );

  return server;
}
