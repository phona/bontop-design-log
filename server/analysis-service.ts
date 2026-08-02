import type { ProjectCatalog } from './project-catalog.js';
import type { OverlayConfig } from './overlay-merge.js';
import { mergeSceneElements } from './overlay-merge.js';
import type { EnvironmentConfig } from '../shared/environment-schema.js';
import { extractApertures } from '../shared/glazing.js';
import { analyzeSunlight } from '../shared/sunlight-analysis.js';
import { analyzeHumidity, isInHuinanWindow } from '../shared/humidity-model.js';

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

export function computeHumidityAnalysis(
  catalog: ProjectCatalog,
  overlay: OverlayConfig | undefined,
  env: EnvironmentConfig,
  date: { month: number; day: number }
) {
  const elements = mergeSceneElements(catalog.getWalls(), overlay);
  const rooms = catalog.getRooms();
  const centers = rooms.map((r) => ({ id: r.id, x: r.x, z: r.z }));
  const apertures = extractApertures(elements, centers, catalog.getWalls());

  const result = analyzeHumidity({
    roomIds: rooms.map((r) => r.id),
    apertures,
    roomDecls: env.humidity?.rooms,
    surfaceDecls: env.humidity?.surfaces,
    date,
    huinanWindow: env.climate.huinan_window,
  });

  const nameById = new Map(rooms.map((r) => [r.id, r.name]));
  return {
    confidence: 'estimated' as const,
    huinanActive: isInHuinanWindow(date, env.climate.huinan_window),
    rooms: result.rooms.map((r) => ({
      id: r.roomId,
      name: nameById.get(r.roomId) ?? r.roomId,
      score: r.score,
      tier: r.tier,
      factors: r.factors,
      declared: r.declared,
    })),
    surfaces: result.surfaces,
  };
}

export function humidityAdvisories(
  analysis: ReturnType<typeof computeHumidityAnalysis>
): string[] {
  const advisories: string[] = [];
  for (const room of analysis.rooms) {
    if (room.tier === 'high') {
      advisories.push(`「${room.name}」湿度风险高（${room.score} 分）：建议配置除湿机并检查通风路径`);
    }
  }
  for (const surface of analysis.surfaces) {
    if (surface.tier !== 'high' && surface.score < 40) continue;
    if (surface.kind === 'slab') {
      advisories.push(`重点表面 ${surface.id}（地面，${surface.score} 分）：回南天结露高风险，建议地面防潮处理 + 除湿机就近取电`);
    } else if (surface.kind === 'ext_wall') {
      advisories.push(`重点表面 ${surface.id}（外墙，${surface.score} 分）：建议内墙防霉涂料`);
    } else {
      advisories.push(`重点表面 ${surface.id}（角部热桥，${surface.score} 分）：建议局部保温处理`);
    }
  }
  if (analysis.huinanActive) {
    advisories.push('当前日期处于回南天窗口（02-15 ~ 04-15），冷表面结露因子已生效');
  }
  return advisories;
}
