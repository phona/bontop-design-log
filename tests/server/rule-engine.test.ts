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
        severity: 'medium',
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
    assert.equal(result.risks[0].severity, 'medium');
  });

  // 43b931f 起 server/rule-engine.ts:215-224 把 `if (!requiredTopic) continue;` 改成
  // 显式 push 一条 constraintViolation 后 continue——「require 指向的 topic 根本没在 catalog 注册」
  // 从静默跳过变成 fail-loud：静默会让「规则写错 topic 名」这种配置漂移永远不暴露，
  // 而与同函数下面 requiredOptionId 缺失（:227-236）、requiredOption 缺失（:238-244）两个分支的处理保持一致
  // （三个分支都 push 同一形状的 violation）。本测试名/断言停留在改之前的「静默跳过」语义，已过期。
  it('reports a violation when a required topic is not registered', () => {
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
    // catalog 里没有 range_hood topic → 规则命中但 required topic 未注册，按 43b931f 的既定设计报 violation
    assert.equal(result.constraintViolations.length, 1);
    assert.equal(result.constraintViolations[0].id, 'high_airflow_requires_hood');
    assert.equal(result.constraintViolations[0].topic, 'hvac');
    assert.equal(result.constraintViolations[0].requirement.topic, 'range_hood');
    assert.equal(result.constraintViolations[0].roomId, null);
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
