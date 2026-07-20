// Tipos y helpers de la página Flota.

export type FleetStatus = "activo" | "sin-senal" | "critico";

export interface FleetVehicle {
  id: string;
  label: string;
  routeName: string | null;
  lastLat: number | null;
  lastLon: number | null;
  lastTs: string | null;
}

export const STATUS_LABEL: Record<FleetStatus, string> = {
  activo: "Activo",
  "sin-senal": "Sin señal >2 min",
  critico: "Sin señal >10 min",
};

const TWO_MIN_MS = 2 * 60_000;
const TEN_MIN_MS = 10 * 60_000;

/** Estado según la antigüedad de la última señal. Sin señal nunca => crítico. */
export function getStatus(lastTs: string | null, nowMs: number): FleetStatus {
  if (!lastTs) return "critico";
  const ageMs = nowMs - new Date(lastTs).getTime();
  if (ageMs > TEN_MIN_MS) return "critico";
  if (ageMs > TWO_MIN_MS) return "sin-senal";
  return "activo";
}

/** "hace 42s" / "hace 5 min" / "hace 3 h" / fecha absoluta para lo más viejo. */
export function formatRelative(ts: string | null, nowMs: number): string {
  if (!ts) return "Nunca";
  const seconds = Math.max(0, Math.floor((nowMs - new Date(ts).getTime()) / 1000));
  if (seconds < 60) return `hace ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return new Date(ts).toLocaleString("es-CO", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Reduce una polilínea a `max` puntos conservando el primero y el último.
 * Un día completo a 1 señal/s son ~43k puntos: Leaflet no necesita tantos.
 */
export function downsample<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const step = points.length / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max - 1; i++) {
    out.push(points[Math.floor(i * step)]);
  }
  out.push(points[points.length - 1]);
  return out;
}
