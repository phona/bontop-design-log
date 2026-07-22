import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ProjectCatalog } from './project-catalog.js';
import type { DesignState } from './design-state.js';
import type { RuleEngine } from './rule-engine.js';
import type { BudgetCalculator } from './budget-calculator.js';
import type { PitfallEngine } from './pitfall-engine.js';
import type { ArchivedSchemesStore } from './archived-schemes.js';
import type { CurrentScheme } from '../shared/types.js';
import { parseSpecDimensions } from './spec-parser.js';

function text(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function findMaterialByFurnitureType(
  catalog: ProjectCatalog,
  type: string
): ReturnType<ProjectCatalog['getAllMaterials']>[number] | undefined {
  const materials = catalog.getAllMaterials();
  const base = type.replace(/_\d+\w*$/, '');
  return materials.find((m) => m.alternative_group === base);
}

export interface McpDeps {
  catalog: ProjectCatalog;
  state: DesignState;
  getRuleEngine: () => RuleEngine;
  getBudgetCalculator: () => BudgetCalculator;
  getPitfallEngine: () => PitfallEngine;
  archiveStore: ArchivedSchemesStore;
}

export function createMcpServer(deps: McpDeps): McpServer {
  const { catalog, state, getRuleEngine, getBudgetCalculator, getPitfallEngine, archiveStore } = deps;
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

      const topicCost = (snapshot: typeof currentBudget, topic: string): number =>
        snapshot.lineItems
          .filter((li) => li.topic === topic)
          .reduce((sum, li) => sum + li.cost, 0);

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
          priceDelta: topicCost(compareBudget, topic) - topicCost(currentBudget, topic),
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

  server.registerTool(
    'what_if',
    {
      title: 'What-if analysis',
      description: 'Simulate selection changes without persisting. Returns full budget snapshot, risks, and diff vs current scheme.',
      inputSchema: z.object({
        changes: z.array(
          z.object({
            topic: z.string(),
            optionId: z.string().nullable(),
            roomId: z.string().optional(),
          })
        ),
      }),
    },
    async (args) => {
      const current = state.getCurrentScheme();
      const calc = getBudgetCalculator();
      const engine = getRuleEngine();

      const tempScheme: CurrentScheme = {
        updatedAt: new Date().toISOString(),
        selections: JSON.parse(JSON.stringify(current.selections)),
      };
      for (const change of args.changes) {
        const sel = tempScheme.selections[change.topic] ?? {
          default: null as string | null,
          roomOverrides: {} as Record<string, string>,
        };
        if (change.roomId) {
          if (change.optionId === null) delete sel.roomOverrides[change.roomId];
          else sel.roomOverrides[change.roomId] = change.optionId;
        } else {
          sel.default = change.optionId;
        }
        tempScheme.selections[change.topic] = sel;
      }

      const currentBudget = calc.calculate(current);
      const currentRisks = engine.evaluate(current, catalog);
      const simBudget = calc.calculate(tempScheme);
      const simRisks = engine.evaluate(tempScheme, catalog);

      const currentRiskIds = new Set(currentRisks.risks.map((r) => r.id));
      const simRiskIds = new Set(simRisks.risks.map((r) => r.id));

      return text({
        current: {
          totalBudget: currentBudget.totalBudget,
          totalActual: currentBudget.totalActual,
        },
        simulated: {
          totalBudget: simBudget.totalBudget,
          totalActual: simBudget.totalActual,
          budget: simBudget,
          risks: simRisks,
        },
        delta: {
          totalDelta: simBudget.totalActual - currentBudget.totalActual,
          categoryDeltas: simBudget.categories
            .map((c, i) => ({
              key: c.key,
              currentActual: currentBudget.categories[i].actual,
              simulatedActual: c.actual,
              delta: c.actual - currentBudget.categories[i].actual,
              status: c.status,
            }))
            .filter((d) => d.delta !== 0),
          risksAdded: simRisks.risks.filter((r) => !currentRiskIds.has(r.id)),
          risksRemoved: currentRisks.risks.filter((r) => !simRiskIds.has(r.id)),
        },
      });
    }
  );

  server.registerTool(
    'get_pitfalls',
    {
      title: 'Get budget pitfalls',
      description: 'Return renovation pitfalls: budget traps, construction shortcuts, acceptance checkpoints. Filter by category/type/stage.',
      inputSchema: z.object({
        category: z.string().optional(),
        type: z.string().optional(),
        stage: z.string().optional(),
      }),
    },
    async (args) => text(getPitfallEngine().getPitfalls(args))
  );

  server.registerTool(
    'recommend_allocation',
    {
      title: 'Recommend budget allocation',
      description: 'Return budget allocation template for a target total and tier (pragmatic/balanced/quality).',
      inputSchema: z.object({
        totalBudget: z.number().optional(),
        tier: z.string().optional(),
      }),
    },
    async (args) => {
      const template = getPitfallEngine().getTemplate(args.tier, args.totalBudget);
      if (!template) return text({ error: 'no matching template' });
      return text(template);
    }
  );

  server.registerTool(
    'get_room_layout',
    {
      title: 'Get room layout',
      description: 'Return full spatial detail for a room: dimensions, walls, door/window openings, furnishings, electrical markers, and adjacent rooms. If roomId omitted, returns all rooms.',
      inputSchema: z.object({ roomId: z.string().optional() }),
    },
    async (args) => {
      if (args.roomId) {
        const detail = catalog.getRoomLayoutDetail(args.roomId);
        if (!detail) return text({ error: `room not found: ${args.roomId}` });
        return text(detail);
      }
      const allRooms = catalog
        .getRooms()
        .map((r) => catalog.getRoomLayoutDetail(r.id))
        .filter((d) => d !== undefined);
      return text(allRooms);
    }
  );

  server.registerTool(
    'get_furniture_inventory',
    {
      title: 'Get furniture inventory',
      description: 'Return furniture per room with parsed dimensions from materials spec. Combines house.yaml furnishings counts with materials.yaml dimensions.',
      inputSchema: z.object({ roomId: z.string().optional() }),
    },
    async (args) => {
      const furnishings = catalog.getFurnishings();
      const result: Record<
        string,
        Array<{
          type: string;
          count: number;
          dimensions?: { width: number; height: number; depth: number };
          spec?: string;
          materialId?: string;
        }>
      > = {};

      const roomIds = args.roomId ? [args.roomId] : Object.keys(furnishings);
      for (const rid of roomIds) {
        const items = furnishings[rid];
        if (!items) continue;
        result[rid] = [];
        for (const [type, count] of Object.entries(items)) {
          if (!count || count <= 0) continue;
          const material = findMaterialByFurnitureType(catalog, type);
          const dimensions = material ? parseSpecDimensions(material.spec) : null;
          result[rid].push({
            type,
            count,
            dimensions: dimensions ?? undefined,
            spec: material?.spec,
            materialId: material?.id,
          });
        }
      }
      return text(result);
    }
  );

  return server;
}
