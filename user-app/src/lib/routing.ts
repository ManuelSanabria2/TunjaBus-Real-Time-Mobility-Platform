/**
 * Road-snapped routing via OSRM public API.
 * Converts a list of waypoints into a road-following polyline
 * by querying the OSRM routing engine for actual street geometries.
 */

// In-memory cache: routeId → road-snapped coordinates
const routeCache = new Map<string, [number, number][]>();

/**
 * Given a set of waypoints (lat, lon), returns an array of (lat, lon)
 * coordinates that follow actual roads between the waypoints.
 *
 * Uses the free OSRM demo server. For production, consider self-hosting.
 */
export async function getRoadSnappedRoute(
  routeId: string,
  waypoints: [number, number][]
): Promise<[number, number][]> {
  // Check cache first
  if (routeCache.has(routeId)) {
    return routeCache.get(routeId)!;
  }

  if (waypoints.length < 2) return waypoints;

  try {
    // OSRM expects coordinates as lon,lat (reversed from our lat,lon format)
    const coordString = waypoints
      .map(([lat, lon]) => `${lon},${lat}`)
      .join(';');

    const url = `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson`;

    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`OSRM request failed (${response.status}), falling back to straight lines`);
      return waypoints;
    }

    const data = await response.json();

    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      console.warn('OSRM returned no routes, falling back to straight lines');
      return waypoints;
    }

    // Extract GeoJSON coordinates (lon, lat) → convert to (lat, lon)
    const geojsonCoords: [number, number][] = data.routes[0].geometry.coordinates;
    const latLonCoords: [number, number][] = geojsonCoords.map(
      ([lon, lat]) => [lat, lon] as [number, number]
    );

    // Cache the result
    routeCache.set(routeId, latLonCoords);

    return latLonCoords;
  } catch (error) {
    console.warn('OSRM routing error, falling back to straight lines:', error);
    return waypoints;
  }
}

/** Clear the route cache (useful if route definitions change) */
export function clearRouteCache() {
  routeCache.clear();
}
