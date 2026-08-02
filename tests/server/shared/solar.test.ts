import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getSolarPosition, getSunriseSunset, computeLightState, sunDirection } from '../../../shared/solar.js';

const NANNING = { latitudeDeg: 22.82, longitudeDeg: 108.37, timezoneHours: 8 };

function maxAltitude(month: number, day: number): number {
  let max = -90;
  for (let h = 0; h <= 24; h += 0.05) {
    const { altitudeDeg } = getSolarPosition({ month, day, hour: h, ...NANNING });
    if (altitudeDeg > max) max = altitudeDeg;
  }
  return max;
}

describe('getSolarPosition', () => {
  it('南宁冬至正午最大高度角 ≈ 43.7°', () => {
    assert.ok(Math.abs(maxAltitude(12, 22) - 43.7) < 1.0, `got ${maxAltitude(12, 22)}`);
  });

  it('南宁夏至正午最大高度角 ≈ 89.4°（φ < δ，太阳近天顶）', () => {
    assert.ok(Math.abs(maxAltitude(6, 22) - 89.4) < 1.0, `got ${maxAltitude(6, 22)}`);
  });

  it('方位角象限：冬至上午偏东南、正午偏南、下午偏西南', () => {
    const morning = getSolarPosition({ month: 12, day: 22, hour: 9, ...NANNING });
    const noon = getSolarPosition({ month: 12, day: 22, hour: 12.75, ...NANNING });
    const afternoon = getSolarPosition({ month: 12, day: 22, hour: 16, ...NANNING });
    assert.ok(morning.azimuthDeg > 90 && morning.azimuthDeg < 180, `morning ${morning.azimuthDeg}`);
    assert.ok(Math.abs(noon.azimuthDeg - 180) < 5, `noon ${noon.azimuthDeg}`);
    assert.ok(afternoon.azimuthDeg > 180 && afternoon.azimuthDeg < 270, `afternoon ${afternoon.azimuthDeg}`);
  });

  it('夜间高度角为负', () => {
    const night = getSolarPosition({ month: 12, day: 22, hour: 22, ...NANNING });
    assert.ok(night.altitudeDeg < 0);
  });
});

describe('getSunriseSunset', () => {
  it('南宁冬至日出 ≈ 7.45h 日落 ≈ 18.05h（当地标准时）', () => {
    const { sunriseHour, sunsetHour } = getSunriseSunset(12, 22, NANNING.latitudeDeg, NANNING.longitudeDeg, NANNING.timezoneHours);
    assert.ok(Math.abs(sunriseHour - 7.45) < 0.4, `sunrise ${sunriseHour}`);
    assert.ok(Math.abs(sunsetHour - 18.05) < 0.4, `sunset ${sunsetHour}`);
  });

  it('夏至昼长大于冬至', () => {
    const winter = getSunriseSunset(12, 22, NANNING.latitudeDeg, NANNING.longitudeDeg, NANNING.timezoneHours);
    const summer = getSunriseSunset(6, 22, NANNING.latitudeDeg, NANNING.longitudeDeg, NANNING.timezoneHours);
    assert.ok(summer.sunsetHour - summer.sunriseHour > winter.sunsetHour - winter.sunriseHour);
  });
});

describe('computeLightState', () => {
  it('α ≤ 0 为夜间', () => {
    const s = computeLightState(-5);
    assert.equal(s.isNight, true);
    assert.equal(s.sunIntensity, 0);
    assert.equal(s.ambientIntensity, 0.15);
  });

  it('白天强度随高度角单调递增且 ≤ 1', () => {
    const low = computeLightState(10);
    const high = computeLightState(60);
    assert.ok(low.sunIntensity < high.sunIntensity);
    assert.ok(high.sunIntensity <= 1.0);
    assert.equal(low.isNight, false);
  });

  it('低空暖色、高空白色', () => {
    assert.equal(computeLightState(5).sunColorHex, 0xffb36b);
    assert.equal(computeLightState(90).sunColorHex, 0xffffff);
  });
});

describe('sunDirection', () => {
  it('天顶方向 y=1', () => {
    const d = sunDirection(90, 0);
    assert.ok(Math.abs(d.y - 1) < 1e-9);
  });

  it('方位 180（南）高度 45 → +z 方向（南）', () => {
    const d = sunDirection(45, 180);
    assert.ok(Math.abs(d.x) < 1e-9);
    assert.ok(d.z > 0);
    assert.ok(Math.abs(d.y - Math.SQRT1_2) < 1e-9);
  });

  it('方位 90（东）→ +x 方向', () => {
    const d = sunDirection(30, 90);
    assert.ok(d.x > 0);
    assert.ok(Math.abs(d.z) < 1e-9);
  });
});
