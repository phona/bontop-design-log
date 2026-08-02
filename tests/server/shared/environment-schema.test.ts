import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnvironment } from '../../../shared/environment-schema.js';

describe('parseEnvironment', () => {
  it('解析真实 config/environment.yaml', () => {
    const raw = readFileSync('config/environment.yaml', 'utf8');
    const cfg = parseEnvironment(raw);
    assert.equal(cfg.version, 1);
    assert.ok(Math.abs(cfg.location.latitude - 22.82) < 0.01);
    assert.equal(cfg.climate.monthly.length, 12);
    assert.equal(cfg.climate.huinan_window.start, '02-15');
  });

  it('humidity 段可选但声明后必须符合 schema', () => {
    const raw = readFileSync('config/environment.yaml', 'utf8');
    const cfg = parseEnvironment(raw);
    assert.ok(cfg.humidity);
    assert.equal(cfg.humidity!.rooms!['master_bath'].moisture, 'high');
  });

  it('非法字段抛异常', () => {
    assert.throws(() => parseEnvironment('version: 2\nlocation: {latitude: 22.82, longitude: 108.37, timezone: 8}\nhorizon: {obstruction_deg: 0}\nclimate: {zone: x, huinan_window: {start: "02-15", end: "04-15"}, prevailing_wind: {summer: SSE, winter: NNE}, rainfall_mm_annual: 1300, monthly: []}'));
  });

  it('obstruction_deg 超范围抛异常', () => {
    assert.throws(() => parseEnvironment('version: 1\nlocation: {latitude: 22.82, longitude: 108.37, timezone: 8}\nhorizon: {obstruction_deg: 120}\nclimate: {zone: x, huinan_window: {start: "02-15", end: "04-15"}, prevailing_wind: {summer: SSE, winter: NNE}, rainfall_mm_annual: 1300, monthly: []}'));
  });
});
