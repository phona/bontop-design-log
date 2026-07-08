import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RuleEngine, evaluateCondition } from '../../server/rule-engine.js';
import type { ConditionContext } from '../../server/rule-engine.js';
import type { CurrentScheme, DesignRulesConfig } from '../../shared/types.js';

function makeContext(overrides: Partial<ConditionContext> = {}): ConditionContext {
  return {
    topic: 'A2',
    room: null,
    selection: { hvac: 'A2', floor: 'floor_tile_01' },
    option: null,
    ...overrides,
  };
}

describe('evaluateCondition', () => {
  it('handles == operator', () => {
    assert.equal(evaluateCondition('$topic == "A2"', makeContext()), true);
    assert.equal(evaluateCondition('$topic == "A1"', makeContext()), false);
  });

  it('handles != operator', () => {
    assert.equal(evaluateCondition('$topic != "A1"', makeContext()), true);
  });

  it('handles in operator', () => {
    assert.equal(
      evaluateCondition('$topic in ["A1", "A2", "B1"]', makeContext()),
      true
    );
    assert.equal(
      evaluateCondition('$topic in ["E1", "F2"]', makeContext()),
      false
    );
  });

  it('handles not in operator', () => {
    assert.equal(
      evaluateCondition('$topic not in ["E1", "F2"]', makeContext()),
      true
    );
  });

  it('handles > and < operators', () => {
    const ctx = makeContext({ option: { airflow: 25 } });
    assert.equal(evaluateCondition('$option.airflow > 20', ctx), true);
    assert.equal(evaluateCondition('$option.airflow < 20', ctx), false);
  });

  it('handles >= and <= operators', () => {
    const ctx = makeContext({ option: { price: 3000 } });
    assert.equal(evaluateCondition('$option.price >= 3000', ctx), true);
    assert.equal(evaluateCondition('$option.price <= 3000', ctx), true);
  });

  it('handles $selection variable', () => {
    assert.equal(
      evaluateCondition('$selection.hvac == "A2"', makeContext()),
      true
    );
  });

  it('does not match operators inside identifiers', () => {
    const ctx = makeContext({ option: { input: 5, notion: 7 } });
    assert.equal(evaluateCondition('$option.input == 5', ctx), true);
    assert.equal(evaluateCondition('$option.notion == 7', ctx), true);
  });

  it('handles field names that are alphabetic operators', () => {
    const ctx = makeContext({ option: { in: 5 } });
    assert.equal(evaluateCondition('$option.in == 5', ctx), true);
    assert.equal(evaluateCondition('$option.in == 6', ctx), false);
  });
});

describe('RuleEngine', () => {
  const config: DesignRulesConfig = {
    version: '1.0',
    risks: [
      {
        id: 'platform_width',
        severity: 'warning',
        message: '{{hvac.name}} 外机摆放紧张，需现场确认',
        when: { topic: 'hvac', options: ['B1', 'B2', 'E1'] },
      },
    ],
    constraints: [
      {
        id: 'high_airflow_requires_hood',
        description: '大风量 HVAC 方案必须配大功率油烟机',
        when: { topic: 'hvac', condition: '$topic in ["B1", "B2", "E1"]' },
        require: {
          topic: 'range_hood',
          minValue: { field: 'airflow', value: 22 },
        },
      },
    ],
  };

  it('returns empty risks when no rule matches', () => {
    const engine = new RuleEngine(config);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        hvac: { default: 'A1', roomOverrides: {} },
      },
    };
    const result = engine.evaluate(scheme, { getOption: () => undefined } as any);
    assert.equal(result.risks.length, 0);
  });

  it('returns risk when option matches', () => {
    const engine = new RuleEngine(config);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        hvac: { default: 'B1', roomOverrides: {} },
      },
    };
    const result = engine.evaluate(scheme, { getOption: () => ({ name: 'B1 方案' }), getTopic: () => undefined } as any);
    assert.equal(result.risks.length, 1);
    assert.equal(result.risks[0].id, 'platform_width');
    assert.equal(result.risks[0].severity, 'warning');
  });

  it('returns empty constraints when required topic not registered', () => {
    const engine = new RuleEngine(config);
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {
        hvac: { default: 'B1', roomOverrides: {} },
      },
    };
    const result = engine.evaluate(scheme, {
      getTopic: () => undefined,
      getOption: () => undefined,
    } as any);
    assert.equal(result.constraintViolations.length, 0);
  });

  it('handles empty risks and constraints', () => {
    const engine = new RuleEngine({ version: '1.0', risks: [], constraints: [] });
    const scheme: CurrentScheme = {
      updatedAt: new Date().toISOString(),
      selections: {},
    };
    const result = engine.evaluate(scheme, {} as any);
    assert.equal(result.risks.length, 0);
    assert.equal(result.constraintViolations.length, 0);
  });
});

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
