import type { ProjectCatalog } from './project-catalog.js';
import type { OverlayConfig } from './overlay-merge.js';
import { mergeSceneElements } from './overlay-merge.js';
import type { EnvironmentConfig } from '../shared/environment-schema.js';
import { extractApertures } from '../shared/glazing.js';
import { analyzeSunlight } from '../shared/sunlight-analysis.js';

const COMPASS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];

function toCompass(azimuthDeg: number): string {
  return COMPASS[Math.round(azimuthDeg / 45) % 8];
}

export function computeSunlightAnalysis(
  catalog: ProjectCatalog,
  overlay: OverlayConfig | undefined,
  env: EnvironmentConfig,
  date: { month: number; day: number }
) {
  const elements = mergeSceneElements(catalog.getWalls(), overlay);
  const rooms = catalog.getRooms();
  const centers = rooms.map((r) => ({ id: r.id, x: r.x, z: r.z }));
  const apertures = extractApertures(elements, centers, catalog.getWalls());
  const location = {
    latitude: env.location.latitude,
    longitude: env.location.longitude,
    timezone: env.location.timezone,
  };
  const perRoom = analyzeSunlight(apertures, centers, date, {
    location,
    obstructionDeg: env.horizon.obstruction_deg,
  });

  const dateStr = `${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
  return {
    date: dateStr,
    location,
    confidence: 'estimated' as const,
    rooms: rooms.map((r) => {
      const analysis = perRoom.find((p) => p.roomId === r.id);
      const roomAps = apertures.filter((a) => a.roomId === r.id);
      return {
        id: r.id,
        name: r.name,
        directHours: analysis ? Math.round(analysis.directHours * 100) / 100 : 0,
        westSunWarning: analysis?.westSunWarning ?? false,
        intervals: analysis?.intervals ?? [],
        windows: roomAps.map((a) => ({ id: a.id, azimuthDeg: Math.round(a.azimuthDeg), faces: toCompass(a.azimuthDeg) })),
      };
    }),
  };
}
