"use client";

import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, useMap, useMapEvents, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { createClient } from '../utils/supabase/client';
import { haversineDistance, interpolatePosition, Stop } from '../lib/geo';
import MainMenu from './MainMenu';
import { LocateFixed, MapPin, Bus, Radio } from 'lucide-react';

// Fix generic leaflet icon issues in Next.js
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Custom Icons — Andén Theme (Flat, elegant, no neon)
// Tinta: %231C2632
// Terracota: %23B5603A
// Salvia: %235C8265
// Piedra: %23F3EFE9
const busIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="%231C2632" d="M10,12 C10,6 14,4 24,4 C34,4 38,6 38,12 L38,36 C38,40 34,42 24,42 C14,42 10,40 10,36 Z"/><path fill="%23F3EFE9" d="M14,12 L34,12 L34,22 L14,22 Z"/><path fill="%23FFFFFF" opacity="0.4" d="M14,14 L34,14 L34,16 L14,16 Z"/><circle fill="%23F3EFE9" cx="16" cy="34" r="3"/><circle fill="%23F3EFE9" cx="32" cy="34" r="3"/><rect fill="%23B5603A" x="20" y="38" width="8" height="2" rx="1"/></svg>`;

const nearestBusIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56"><circle cx="28" cy="28" r="26" fill="%235C8265" opacity="0.2"/><circle cx="28" cy="28" r="22" fill="%235C8265" opacity="0.4"/><g transform="translate(4,4)"><path fill="%235C8265" d="M10,12 C10,6 14,4 24,4 C34,4 38,6 38,12 L38,36 C38,40 34,42 24,42 C14,42 10,40 10,36 Z"/><path fill="%23F3EFE9" d="M14,12 L34,12 L34,22 L14,22 Z"/><path fill="%23FFFFFF" opacity="0.4" d="M14,14 L34,14 L34,16 L14,16 Z"/><circle fill="%23F3EFE9" cx="16" cy="34" r="3"/><circle fill="%23F3EFE9" cx="32" cy="34" r="3"/><rect fill="%23B5603A" x="20" y="38" width="8" height="2" rx="1"/></g></svg>`;

const userIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="12" fill="%23B5603A" opacity="0.2"/><circle cx="20" cy="20" r="6" fill="%23B5603A"/><circle cx="20" cy="20" r="3" fill="%23F3EFE9"/></svg>`;

const busIcon = new L.Icon({
  iconUrl: 'data:image/svg+xml;base64,' + btoa(busIconSvg),
  iconSize: [40, 40],
  iconAnchor: [20, 20],
});

const nearestBusIcon = new L.Icon({
  iconUrl: 'data:image/svg+xml;base64,' + btoa(nearestBusIconSvg),
  iconSize: [48, 48],
  iconAnchor: [24, 24],
});

const userIcon = new L.Icon({
  iconUrl: 'data:image/svg+xml;base64,' + btoa(userIconSvg),
  iconSize: [40, 40],
  iconAnchor: [20, 20],
});

interface VehiclePosition {
  vehicle_id: string;
  latitude: number;
  longitude: number;
  speed_kmh: number;
  heading: number;
  timestamp: string;
}

interface TrackedBus {
  pos: VehiclePosition;
  renderLat: number;
  renderLon: number;
  lastUpdateMs: number;
  label: string;
}

export default function BusMap() {
  const supabase = createClient();
  const [stops, setStops] = useState<Stop[]>([]);

  // Track ALL buses by vehicle_id
  const [buses, setBuses] = useState<Map<string, TrackedBus>>(new Map());
  const busesRef = useRef<Map<string, TrackedBus>>(new Map());

  // User location
  const [userPos, setUserPos] = useState<{ lat: number, lon: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);

  // Selected bus for detailed view
  const [selectedBusId, setSelectedBusId] = useState<string | null>(null);



  // Animation state for smooth transitions
  const [animatedBuses, setAnimatedBuses] = useState<Map<string, { lat: number, lon: number }>>(new Map());

  // Show route toggle
  const [showRoute, setShowRoute] = useState(false);

  // Focus location to control map from outside
  const [focusLocation, setFocusLocation] = useState<{lat: number, lon: number, ts: number} | null>(null);

  // Vehicle labels cache
  const labelsRef = useRef<Map<string, string>>(new Map());

  // 1. Fetch stops, vehicles, and initial positions
  useEffect(() => {
    async function loadInitialData() {
      // Load stops
      const { data: stopsData, error: stopsError } = await supabase
        .from('stops')
        .select('*')
        .order('stop_sequence');
      if (stopsData && !stopsError) setStops(stopsData as Stop[]);

      // Load vehicle labels
      const { data: vehiclesData } = await supabase.from('vehicles').select('id, label');
      if (vehiclesData) {
        vehiclesData.forEach(v => labelsRef.current.set(v.id, v.label || v.id));
      }

      // Load recent positions (Increased to 30 days for demonstration/testing without active hardware)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60000).toISOString();
      const { data: recentPos } = await supabase
        .from('vehicle_positions')
        .select('*')
        .gte('timestamp', thirtyDaysAgo)
        .order('timestamp', { ascending: true });

      if (recentPos) {
        const latestPositions = new Map<string, VehiclePosition>();
        recentPos.forEach(pos => {
          latestPositions.set(pos.vehicle_id, pos as VehiclePosition);
        });

        const newBuses = new Map<string, TrackedBus>();
        latestPositions.forEach((pos, vid) => {
          newBuses.set(vid, {
            pos,
            renderLat: pos.latitude,
            renderLon: pos.longitude,
            lastUpdateMs: new Date(pos.timestamp).getTime(),
            label: labelsRef.current.get(vid) || vid
          });
        });

        setBuses(newBuses);
        busesRef.current = newBuses;
      }
    }

    loadInitialData();
  }, []);

  // 2. Real-time subscription to positions
  useEffect(() => {
    const subscription = supabase
      .channel('public:vehicle_positions')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'vehicle_positions' }, payload => {
        const newPos = payload.new as VehiclePosition;
        const nowMs = Date.now();
        const existingBus = busesRef.current.get(newPos.vehicle_id);

        const newBusState: TrackedBus = {
          pos: newPos,
          renderLat: existingBus ? existingBus.renderLat : newPos.latitude,
          renderLon: existingBus ? existingBus.renderLon : newPos.longitude,
          lastUpdateMs: nowMs,
          label: labelsRef.current.get(newPos.vehicle_id) || newPos.vehicle_id
        };

        const newMap = new Map(busesRef.current);
        newMap.set(newPos.vehicle_id, newBusState);
        busesRef.current = newMap;
      })
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, []);

  // 3. User Geolocation Watch
  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoError("Geolocalización no soportada");
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setUserPos({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setGeoError(null);
      },
      (err) => {
        setGeoError("Permiso de ubicación denegado");
        console.warn("Geo error:", err);
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // 4. Animation loop (60 FPS) for smooth marker movement
  useEffect(() => {
    const intervalId = setInterval(() => {
      const nowMs = Date.now();
      let hasChanges = false;
      const updated = new Map(busesRef.current);
      const animated = new Map(animatedBuses);

      // Interpolation constants
      const SIMULATED_DELAY_MS = 2000;
      const SMOOTHING_FACTOR = 0.15;

      for (const [id, bus] of updated.entries()) {
        const ageMs = nowMs - bus.lastUpdateMs;

        // Remove stale buses (Increased to 30 days for demo purposes)
        if (ageMs > 30 * 24 * 60 * 60 * 1000) {
          updated.delete(id);
          animated.delete(id);
          hasChanges = true;
          continue;
        }

        const targetLat = bus.pos.latitude;
        const targetLon = bus.pos.longitude;

        const dLat = targetLat - bus.renderLat;
        const dLon = targetLon - bus.renderLon;

        // Only animate if distance is significant but not a massive jump
        if (Math.abs(dLat) > 0.00001 || Math.abs(dLon) > 0.00001) {
          bus.renderLat += dLat * SMOOTHING_FACTOR;
          bus.renderLon += dLon * SMOOTHING_FACTOR;
          hasChanges = true;
        } else {
          bus.renderLat = targetLat;
          bus.renderLon = targetLon;
        }

        animated.set(id, { lat: bus.renderLat, lon: bus.renderLon });
      }

      if (hasChanges) {
        busesRef.current = updated;
        setBuses(new Map(updated));
        setAnimatedBuses(new Map(animated));
      }
    }, 33); // ~30 fps update rate for smoother movement

    return () => clearInterval(intervalId);
  }, []);

  // 5. Find nearest bus to the user
  const nearestBus = useMemo(() => {
    if (!userPos || buses.size === 0) {
      // If no user position, return first available bus
      const first = buses.values().next().value;
      return first || null;
    }

    let nearest: TrackedBus | null = null;
    let minDist = Infinity;

    for (const [, bus] of buses) {
      const dist = haversineDistance(userPos.lat, userPos.lon, bus.renderLat, bus.renderLon);
      if (dist < minDist) {
        minDist = dist;
        nearest = bus;
      }
    }

    return nearest;
  }, [userPos, buses]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: 'var(--anden-piedra)' }}>
      <MapContainer
        center={[5.5353, -73.3677] as [number, number]}
        zoom={14}
        minZoom={13}
        maxBounds={[
          [5.4850, -73.4000] as [number, number],
          [5.5850, -73.3300] as [number, number]
        ]}
        maxBoundsViscosity={0.8}
        style={{ width: '100%', height: '100%' }}
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={20}
        />

        {/* Render Stops */}
        {stops.map(stop => (
          <CircleMarker
            key={stop.id}
            center={[stop.stop_lat, stop.stop_lon] as [number, number]}
            radius={4}
            pathOptions={{ color: 'var(--anden-tinta)', fillColor: 'var(--anden-piedra)', fillOpacity: 1, weight: 2 }}
          >
            <Popup>
              <div style={{ textAlign: 'center' }}>
                <strong style={{ fontSize: '14px', fontFamily: 'var(--font-sans)' }}>{stop.stop_name}</strong>
              </div>
            </Popup>
          </CircleMarker>
        ))}

        {/* Render Route Polyline for nearest bus */}
        {nearestBus && showRoute && (
          <RoutePolyline busLat={nearestBus.renderLat} busLon={nearestBus.renderLon} stops={stops} />
        )}



      {/* Render Buses */}
      {Array.from(animatedBuses.entries()).map(([id, pos]) => {
        const isNearest = nearestBus?.pos.vehicle_id === id;
        return (
          <Marker
            key={id}
            position={[pos.lat, pos.lon] as [number, number]}
            icon={isNearest ? nearestBusIcon : busIcon}
            zIndexOffset={isNearest ? 1000 : 0}
          >
            <Popup>
              <div style={{ textAlign: 'center', fontFamily: 'var(--font-sans)' }}>
                <strong style={{ fontSize: '15px', color: 'var(--anden-tinta)' }}>{buses.get(id)?.label || id}</strong><br />
                <span style={{ fontSize: '12px', color: 'var(--anden-niebla)' }}>{Math.round(buses.get(id)?.pos.speed_kmh || 0)} km/h</span>
              </div>
            </Popup>
          </Marker>
        );
      })}

      {/* Render User Location */}
      {userPos && (
        <Marker position={[userPos.lat, userPos.lon] as [number, number]} icon={userIcon} zIndexOffset={500} />
      )}

      {/* Botón para localizar usuario */}
      <LocateUserButton userPos={userPos} geoError={geoError} />



      {/* Auto centrar al encontrar al usuario la primera vez */}
      <AutoCenterMap userPos={userPos} />

      {/* Componente para enfocar la cámara */}
      <MapFocusController focusLocation={focusLocation} />

    </MapContainer>

      {/* Render Main Menu UI */}
      <MainMenu 
        buses={buses}
        userPos={userPos}
        stops={stops}
        onFocusBus={(lat, lon) => setFocusLocation({ lat, lon, ts: Date.now() })}
        onSaveRoute={() => alert('Para guardar una ruta, haz click derecho en el botón de la estrella en el mapa.')}
      />
    </div >
  );
}

// Componente hijo para usar el hook useMap de Leaflet
function LocateUserButton({ userPos, geoError }: { userPos: { lat: number, lon: number } | null, geoError: string | null }) {
  const map = useMap();

  return (
    <div style={{ position: 'absolute', top: 90, right: 16, zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '12px' }}>
      <button
        onClick={() => {
          if (userPos) {
            map.flyTo([userPos.lat, userPos.lon], 16, { animate: true });
          } else if (!geoError) {
            alert("Buscando tu ubicación...");
          }
        }}
        style={{
          background: 'var(--anden-piedra)',
          border: '1px solid rgba(28, 38, 50, 0.08)',
          borderRadius: 'var(--anden-radius-full)',
          width: '48px',
          height: '48px',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          boxShadow: 'var(--anden-shadow-md)',
          cursor: 'pointer',
          color: userPos ? 'var(--anden-terracota)' : 'var(--anden-niebla)',
          transition: 'var(--anden-transition)',
        }}
        title="Centrar en mi ubicación"
      >
        <LocateFixed size={22} />
      </button>

      {geoError && (
        <div style={{ background: 'var(--anden-piedra)', border: '1px solid var(--anden-terracota)', padding: '8px 14px', borderRadius: 'var(--anden-radius-md)', fontSize: '12px', color: 'var(--anden-terracota)', maxWidth: '200px', textAlign: 'right', fontFamily: 'var(--font-sans)', fontWeight: 500, boxShadow: 'var(--anden-shadow-sm)' }}>
          ⚠️ {geoError}
        </div>
      )}
    </div>
  );
}

// Componente hijo para hacer un flyTo() automático SOLO la primera vez que se obtienen las coordenadas del usuario
function AutoCenterMap({ userPos }: { userPos: { lat: number, lon: number } | null }) {
  const map = useMap();
  const hasCentered = useRef(false);

  useEffect(() => {
    if (userPos && !hasCentered.current) {
      map.flyTo([userPos.lat, userPos.lon] as [number, number], 16, { animate: true, duration: 1.5 });
      hasCentered.current = true;
    }
  }, [userPos, map]);
  return null;
}

interface RoutePolylineProps {
  busLat: number;
  busLon: number;
  stops: Stop[];
}

function RoutePolyline({ busLat, busLon, stops }: RoutePolylineProps) {
  const map = useMap();

  const nearestStopIndex = useMemo(() => {
    let minDist = Infinity;
    let index = 0;
    stops.forEach((stop, i) => {
      const dist = haversineDistance(busLat, busLon, stop.stop_lat, stop.stop_lon);
      if (dist < minDist) {
        minDist = dist;
        index = i;
      }
    });
    return index;
  }, [busLat, busLon, stops]);

  const routeCoords = useMemo(() => {
    const coords: [number, number][] = [[busLat, busLon]];
    for (let i = nearestStopIndex; i < stops.length; i++) {
      coords.push([stops[i].stop_lat, stops[i].stop_lon] as [number, number]);
    }
    return coords;
  }, [nearestStopIndex, stops, busLat, busLon]);

return (
    <Polyline positions={routeCoords} color="var(--anden-terracota)" weight={4} opacity={0.9} />
  );
}

function MapFocusController({ focusLocation }: { focusLocation: { lat: number, lon: number, ts: number } | null }) {
  const map = useMap();
  
  useEffect(() => {
    if (focusLocation) {
      map.flyTo([focusLocation.lat, focusLocation.lon], 16, { animate: true });
    }
  }, [focusLocation, map]);

  return null;
}

