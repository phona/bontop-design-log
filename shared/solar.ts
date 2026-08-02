const DEG = Math.PI / 180;

export interface SolarInput {
  month: number;
  day: number;
  hour: number;
  latitudeDeg: number;
  longitudeDeg: number;
  timezoneHours: number;
}

export interface SolarPosition {
  altitudeDeg: number;
  azimuthDeg: number;
}

export interface LightState {
  sunIntensity: number;
  ambientIntensity: number;
  sunColorHex: number;
  isNight: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function dayOfYear(month: number, day: number): number {
  const ms = Date.UTC(2001, month - 1, day) - Date.UTC(2001, 0, 1);
  return Math.round(ms / 86400000) + 1;
}

function declinationDeg(n: number): number {
  return 23.44 * Math.sin((360 * (284 + n) / 365) * DEG);
}

function equationOfTimeMinutes(n: number): number {
  const b = (360 * (n - 81) / 364) * DEG;
  return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
}

function timeCorrectionMinutes(longitudeDeg: number, timezoneHours: number, n: number): number {
  return 4 * (longitudeDeg - 15 * timezoneHours) + equationOfTimeMinutes(n);
}

export function getSolarPosition(input: SolarInput): SolarPosition {
  const { month, day, hour, latitudeDeg, longitudeDeg, timezoneHours } = input;
  const n = dayOfYear(month, day);
  const decl = declinationDeg(n) * DEG;
  const lat = latitudeDeg * DEG;
  const tc = timeCorrectionMinutes(longitudeDeg, timezoneHours, n);
  const localSolarTime = hour + tc / 60;
  const hourAngleDeg = 15 * (localSolarTime - 12);
  const h = hourAngleDeg * DEG;

  const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(h);
  const altitude = Math.asin(clamp(sinAlt, -1, 1));

  const cosAlt = Math.cos(altitude);
  const cosAz = cosAlt === 0 ? 1 : (Math.sin(decl) - sinAlt * Math.sin(lat)) / (cosAlt * Math.cos(lat));
  let azimuth = Math.acos(clamp(cosAz, -1, 1));
  if (hourAngleDeg > 0) azimuth = 2 * Math.PI - azimuth;

  return { altitudeDeg: altitude / DEG, azimuthDeg: azimuth / DEG };
}

export function getSunriseSunset(
  month: number,
  day: number,
  latitudeDeg: number,
  longitudeDeg: number,
  timezoneHours: number
): { sunriseHour: number; sunsetHour: number } {
  const n = dayOfYear(month, day);
  const decl = declinationDeg(n) * DEG;
  const lat = latitudeDeg * DEG;
  const cosH0 = clamp(-Math.tan(lat) * Math.tan(decl), -1, 1);
  const h0Deg = Math.acos(cosH0) / DEG;
  const dayLengthHours = (2 * h0Deg) / 15;
  const tc = timeCorrectionMinutes(longitudeDeg, timezoneHours, n);
  const solarNoonLocal = 12 - tc / 60;
  return {
    sunriseHour: solarNoonLocal - dayLengthHours / 2,
    sunsetHour: solarNoonLocal + dayLengthHours / 2,
  };
}

export function computeLightState(altitudeDeg: number): LightState {
  if (altitudeDeg <= 0) {
    return { sunIntensity: 0, ambientIntensity: 0.15, sunColorHex: 0x334466, isNight: true };
  }
  const s = Math.sin(altitudeDeg * DEG);
  const t = clamp((altitudeDeg - 5) / 55, 0, 1);
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * t);
  const color = (lerp(0xff, 0xff) << 16) | (lerp(0xb3, 0xff) << 8) | lerp(0x6b, 0xff);
  return {
    sunIntensity: 0.3 + 0.7 * s,
    ambientIntensity: 0.55,
    sunColorHex: color,
    isNight: false,
  };
}

export function sunDirection(altitudeDeg: number, azimuthDeg: number): { x: number; y: number; z: number } {
  const a = altitudeDeg * DEG;
  const az = azimuthDeg * DEG;
  return {
    x: Math.cos(a) * Math.sin(az),
    y: Math.sin(a),
    z: -Math.cos(a) * Math.cos(az),
  };
}
