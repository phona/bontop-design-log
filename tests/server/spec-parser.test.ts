import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpecDimensions } from '../../server/spec-parser.js';

describe('parseSpecDimensions', () => {
  it('parses 3-dimension mm spec', () => {
    const d = parseSpecDimensions('2800×900×400mm');
    assert.ok(d);
    assert.equal(d.width, 2.8);
    assert.equal(d.height, 0.9);
    assert.equal(d.depth, 0.4);
  });

  it('parses 2-dimension mm spec with x separator', () => {
    const d = parseSpecDimensions('800x800mm');
    assert.ok(d);
    assert.equal(d.width, 0.8);
    assert.equal(d.height, 0.8);
    assert.equal(d.depth, 0);
  });

  it('parses bed spec', () => {
    const d = parseSpecDimensions('1800×2000mm');
    assert.ok(d);
    assert.equal(d.width, 1.8);
    assert.equal(d.height, 2.0);
    assert.equal(d.depth, 0);
  });

  it('parses meter-unit spec as meters', () => {
    const d = parseSpecDimensions('2.8×0.9×0.4m');
    assert.ok(d);
    assert.equal(d.width, 2.8);
    assert.equal(d.height, 0.9);
    assert.equal(d.depth, 0.4);
  });

  it('returns null for non-dimension specs', () => {
    assert.equal(parseSpecDimensions('18L'), null);
    assert.equal(parseSpecDimensions('标准'), null);
    assert.equal(parseSpecDimensions('L型'), null);
  });
});
