import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import type {
  CurrentScheme,
  DesignRulesConfig,
  Risk,
  ConstraintViolation,
  DesignCheckResult,
} from '../shared/types.js';
import type { ProjectCatalog } from './project-catalog.js';

interface ConditionContext {
  topic: string | null;
  room: string | null;
  selection: Record<string, string | null>;
  option: Record<string, unknown> | null;
}

function resolveVariable(varPath: string, ctx: ConditionContext): unknown {
  if (varPath === '$topic') return ctx.topic;
  if (varPath === '$room') return ctx.room;
  if (varPath.startsWith('$selection.')) {
    const topicName = varPath.slice('$selection.'.length);
    return ctx.selection[topicName] ?? null;
  }
  if (varPath.startsWith('$option.')) {
    if (!ctx.option) return undefined;
    const field = varPath.slice('$option.'.length);
    return ctx.option[field];
  }
  return undefined;
}

function parseLiteral(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseList(value: string): unknown[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return [];
  const inner = trimmed.slice(1, -1);
  return inner.split(',').map((s) => parseLiteral(s));
}

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
    const isAlpha = /^[a-z]/.test(op);
    const regex = new RegExp(
      isAlpha ? `\\b\\s*${escaped}\\s*\\b` : `\\b\\s*${escaped}\\s*`
    );
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

export class RuleEngine {
  private config: DesignRulesConfig;

  constructor(config: DesignRulesConfig) {
    this.config = config;
  }

  static load(configPath = 'config/design-rules.yaml'): RuleEngine {
    const raw = readFileSync(configPath, 'utf8');
    const config = load(raw) as DesignRulesConfig;
    return new RuleEngine(config);
  }

  getConfig(): DesignRulesConfig {
    return this.config;
  }

  evaluate(
    scheme: CurrentScheme,
    catalog: ProjectCatalog
  ): DesignCheckResult {
    const risks = this.evaluateRisks(scheme, catalog);
    const constraintViolations = this.evaluateConstraints(scheme, catalog);
    return { risks, constraintViolations };
  }

  private getSelectionMap(scheme: CurrentScheme): Record<string, string | null> {
    const map: Record<string, string | null> = {};
    for (const [topic, sel] of Object.entries(scheme.selections)) {
      map[topic] = sel.default;
    }
    return map;
  }

  private evaluateRisks(
    scheme: CurrentScheme,
    catalog: ProjectCatalog
  ): Risk[] {
    const rules = this.config.risks ?? [];
    const selectionMap = this.getSelectionMap(scheme);
    const risks: Risk[] = [];

    for (const rule of rules) {
      const { when } = rule;
      const selectedOptionId = selectionMap[when.topic] ?? null;
      if (!selectedOptionId) continue;

      let triggered = false;
      if (when.options && when.options.length > 0) {
        triggered = when.options.includes(selectedOptionId);
      } else if (when.condition) {
        const option = catalog.getOption(when.topic, selectedOptionId);
        const ctx: ConditionContext = {
          topic: selectedOptionId,
          room: null,
          selection: selectionMap,
          option: option?.data ? option.data as Record<string, unknown> : null,
        };
        triggered = evaluateCondition(when.condition, ctx);
      }

      if (triggered) {
        let message = rule.message;
        const option = catalog.getOption(when.topic, selectedOptionId);
        if (option) {
          message = message.replace(`{{${when.topic}.name}}`, option.name);
        }
        risks.push({
          id: rule.id,
          severity: rule.severity,
          message,
          topic: when.topic,
          roomId: null,
        });
      }
    }
    return risks;
  }

  private evaluateConstraints(
    scheme: CurrentScheme,
    catalog: ProjectCatalog
  ): ConstraintViolation[] {
    const rules = this.config.constraints ?? [];
    const selectionMap = this.getSelectionMap(scheme);
    const violations: ConstraintViolation[] = [];

    for (const rule of rules) {
      const { when, require } = rule;
      const selectedOptionId = selectionMap[when.topic] ?? null;
      if (!selectedOptionId) continue;

      const option = catalog.getOption(when.topic, selectedOptionId);
      const ctx: ConditionContext = {
        topic: selectedOptionId,
        room: null,
        selection: selectionMap,
        option: option?.data ? option.data as Record<string, unknown> : null,
      };

      const triggered = evaluateCondition(when.condition, ctx);
      if (!triggered) continue;

      const requiredTopic = catalog.getTopic(require.topic);
      if (!requiredTopic) continue;

      const requiredOptionId = selectionMap[require.topic];
      if (!requiredOptionId) {
        violations.push({
          id: rule.id,
          description: rule.description,
          topic: when.topic,
          roomId: null,
          requirement: { topic: require.topic, minValue: require.minValue },
        });
        continue;
      }

      if (require.minValue) {
        const requiredOption = catalog.getOption(require.topic, requiredOptionId);
        if (!requiredOption) {
          violations.push({
            id: rule.id,
            description: rule.description,
            topic: when.topic,
            roomId: null,
            requirement: { topic: require.topic, minValue: require.minValue },
          });
          continue;
        }
        const data = requiredOption.data as Record<string, unknown> | undefined;
        const fieldValue = data?.[require.minValue.field];
        if (fieldValue === undefined || Number(fieldValue) < require.minValue.value) {
          violations.push({
            id: rule.id,
            description: rule.description,
            topic: when.topic,
            roomId: null,
            requirement: { topic: require.topic, minValue: require.minValue },
          });
        }
      }
    }
    return violations;
  }
}

export { type ConditionContext };
