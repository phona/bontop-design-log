import type { WindowAperture } from './glazing.js';

export type Moisture = 'low' | 'medium' | 'high';
export type Ventilation = 'cross' | 'open' | 'range_hood' | 'mechanical' | 'single_side';
export type Tier = 'low' | 'medium' | 'high';

export interface HumidityRoomDecl {
  moisture: Moisture;
  ventilation: Ventilation;
  cold_surface?: string;
}

export interface HumiditySurfaceDecl {
  id: string;
  room: string;
  kind: 'slab' | 'ext_wall' | 'corner';
  faces?: string;
}

export interface HumidityFactor {
  label: string;
  delta: number;
}

export interface RoomHumidity {
  roomId: string;
  score: number;
  tier: Tier;
  factors: HumidityFactor[];
  declared: boolean;
}

export interface SurfaceHumidity {
  id: string;
  room: string;
  kind: 'slab' | 'ext_wall' | 'corner';
  faces?: string;
  score: number;
  tier: Tier;
}

export interface HuinanWindow {
  start: string;
  end: string;
}

const MOISTURE_SCORE: Record<Moisture, number> = { low: 0, medium: 15, high: 30 };
const VENTILATION_SCORE: Record<Ventilation, number> = {
  cross: -10,
  open: -5,
  range_hood: -5,
  mechanical: 0,
  single_side: 10,
};
const DEFAULT_DECL: HumidityRoomDecl = { moisture: 'low', ventilation: 'single_side' };

function clampScore(v: number): number {
  return Math.min(100, Math.max(0, v));
}

function mmdd(date: { month: number; day: number }): string {
  return `${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

export function isInHuinanWindow(date: { month: number; day: number }, window: HuinanWindow): boolean {
  const d = mmdd(date);
  return d >= window.start && d <= window.end;
}

export function toTier(score: number): Tier {
  if (score < 25) return 'low';
  if (score <= 50) return 'medium';
  return 'high';
}

function isNorthBand(azimuthDeg: number): boolean {
  return azimuthDeg >= 315 || azimuthDeg <= 45;
}

export function analyzeHumidity(opts: {
  roomIds: string[];
  apertures: WindowAperture[];
  roomDecls?: Record<string, HumidityRoomDecl>;
  surfaceDecls?: HumiditySurfaceDecl[];
  date: { month: number; day: number };
  huinanWindow: HuinanWindow;
}): { rooms: RoomHumidity[]; surfaces: SurfaceHumidity[] } {
  const huinanActive = isInHuinanWindow(opts.date, opts.huinanWindow);

  const rooms: RoomHumidity[] = opts.roomIds.map((roomId) => {
    const declared = opts.roomDecls?.[roomId] !== undefined;
    const decl = opts.roomDecls?.[roomId] ?? DEFAULT_DECL;
    const factors: HumidityFactor[] = [];

    const moistureDelta = MOISTURE_SCORE[decl.moisture];
    if (moistureDelta !== 0) factors.push({ label: '湿源', delta: moistureDelta });

    const ventDelta = VENTILATION_SCORE[decl.ventilation];
    if (ventDelta !== 0) factors.push({ label: '通风', delta: ventDelta });

    const roomAps = opts.apertures.filter((a) => a.roomId === roomId);
    const northOnly = roomAps.length > 0 && roomAps.every((a) => isNorthBand(a.azimuthDeg));
    if (northOnly) factors.push({ label: '朝向（仅北向采光）', delta: 10 });

    if (decl.cold_surface && huinanActive) {
      factors.push({ label: '回南天冷表面', delta: 20 });
    }

    const score = clampScore(factors.reduce((sum, f) => sum + f.delta, 0));
    return { roomId, score, tier: toTier(score), factors, declared };
  });

  const scoreByRoom = new Map(rooms.map((r) => [r.roomId, r.score]));
  const surfaces: SurfaceHumidity[] = (opts.surfaceDecls ?? []).map((s) => {
    const roomScore = scoreByRoom.get(s.room) ?? 0;
    let mod = 0;
    if (s.kind === 'slab') mod = huinanActive ? 15 : 0;
    if (s.kind === 'ext_wall') mod = 10;
    if (s.kind === 'corner') mod = 10;
    const score = clampScore(roomScore + mod);
    return { id: s.id, room: s.room, kind: s.kind, faces: s.faces, score, tier: toTier(score) };
  });

  return { rooms, surfaces };
}
