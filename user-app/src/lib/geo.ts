/**
 * Haversine formula to calculate distance in kilometers between two GPS coordinates
 */
export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

export interface Stop {
  id: string;
  route_id: string;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
  stop_sequence: number;
}

/**
 * Returns the nearest stop from a given array of stops.
 */
export function getNearestStop(userLat: number, userLon: number, stops: Stop[]): Stop | null {
  if (!stops || stops.length === 0) return null;

  let nearestStop = stops[0];
  let minDistance = haversineDistance(userLat, userLon, nearestStop.stop_lat, nearestStop.stop_lon);

  for (let i = 1; i < stops.length; i++) {
    const d = haversineDistance(userLat, userLon, stops[i].stop_lat, stops[i].stop_lon);
    if (d < minDistance) {
      minDistance = d;
      nearestStop = stops[i];
    }
  }

  return nearestStop;
}

/**
 * Interpolates movement mathematically based on 2D heading projection.
 * ElapsedMs is the time since signal loss in milliseconds.
 */
export function interpolatePosition(lastPos: {lat: number, lon: number}, speedKmh: number, heading: number, elapsedMs: number) {
  // 1 degree of latitude is ~111,320 meters
  const metersPerLat = 111320;
  
  // speed in m/s
  const speedMs = speedKmh * (1000 / 3600);
  
  // distance traveled since last signal
  const distanceTraveled = speedMs * (elapsedMs / 1000);
  
  const headingRad = heading * (Math.PI / 180);
  
  // Delta coordinates
  const dy = Math.cos(headingRad) * distanceTraveled; // meters North
  const dx = Math.sin(headingRad) * distanceTraveled; // meters East

  const deltaLat = dy / metersPerLat;
  const metersPerLon = 111320 * Math.cos(lastPos.lat * (Math.PI / 180));
  const deltaLon = dx / metersPerLon;

  return {
    lat: lastPos.lat + deltaLat,
    lon: lastPos.lon + deltaLon
  };
}
