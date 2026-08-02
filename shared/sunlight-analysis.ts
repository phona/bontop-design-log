import { getSolarPosition, getSunriseSunset } from './solar.js';
import type { WindowAperture, RoomCenter } from './glazing.js';

export interface SunlightLocation {
  latitude: number;
  longitude: number;
  timezone: number;
}

export interface RoomSunlight {
  roomId: string;
  directHours: number;
  intervals: Array<[number, number]>;
  westSunWarning: boolean;
}

const STEP_HOURS = 5 / 60;

function azimuthDelta(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function mergeIntervals(raw: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...raw].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1] + 1e-9) {
      last[1] = Math.max(last[1], iv[1]);
    } else {
      merged.push([iv[0], iv[1]]);
    }
  }
  return merged;
}

function exposureIntervals(
  ap: WindowAperture,
  date: { month: number; day: number },
  loc: SunlightLocation,
  obstructionDeg: number
): Array<[number, number]> {
  const { sunriseHour, sunsetHour } = getSunriseSunset(date.month, date.day, loc.latitude, loc.longitude, loc.timezone);
  const raw: Array<[number, number]> = [];
  let runStart: number | null = null;
  for (let t = sunriseHour; t <= sunsetHour + 1e-9; t += STEP_HOURS) {
    const pos = getSolarPosition({ month: date.month, day: date.day, hour: t, latitudeDeg: loc.latitude, longitudeDeg: loc.longitude, timezoneHours: loc.timezone });
    const lit = pos.altitudeDeg > Math.max(obstructionDeg, 0) && azimuthDelta(pos.azimuthDeg, ap.azimuthDeg) < 90;
    if (lit && runStart === null) runStart = t;
    if (!lit && runStart !== null) {
      raw.push([runStart, t]);
      runStart = null;
    }
  }
  if (runStart !== null) raw.push([runStart, sunsetHour]);
  return raw;
}

export function analyzeSunlight(
  apertures: WindowAperture[],
  rooms: RoomCenter[],
  date: { month: number; day: number },
  opts: { location: SunlightLocation; obstructionDeg: number }
): RoomSunlight[] {
  const byRoom = new Map<string, WindowAperture[]>();
  for (const r of rooms) byRoom.set(r.id, []);
  for (const ap of apertures) {
    if (ap.roomId === null) continue;
    const list = byRoom.get(ap.roomId);
    if (list) list.push(ap);
  }

  const result: RoomSunlight[] = [];
  for (const [roomId, aps] of byRoom) {
    const merged = mergeIntervals(aps.flatMap((ap) => exposureIntervals(ap, date, opts.location, opts.obstructionDeg)));
    const directHours = merged.reduce((sum, [s, e]) => sum + (e - s), 0);

    let westSunWarning = false;
    const westAps = aps.filter((ap) => ap.azimuthDeg >= 225 && ap.azimuthDeg <= 315);
    if (westAps.length > 0) {
      const summer = mergeIntervals(
        westAps.flatMap((ap) => exposureIntervals(ap, { month: 6, day: 22 }, opts.location, opts.obstructionDeg))
      );
      westSunWarning = summer.some(([, end]) => end > 15);
    }

    result.push({ roomId, directHours, intervals: merged, westSunWarning });
  }
  return result;
}
