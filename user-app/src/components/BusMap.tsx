"use client";

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { createClient } from '../utils/supabase/client';
import { haversineDistance, interpolatePosition, Stop } from '../lib/geo';
import ETAPanel from './ETAPanel';
import { LocateFixed } from 'lucide-react';

// Fix generic leaflet icon issues in Next.js
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Custom Icons
const busIcon = new L.Icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/3448/3448339.png',
  iconSize: [40, 40],
  iconAnchor: [20, 20],
});

const nearestBusIcon = new L.Icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/3448/3448339.png',
  iconSize: [50, 50],
  iconAnchor: [25, 25],
});

const userIcon = new L.Icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/3082/3082008.png',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
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
  const [userPos, setUserPos] = useState<{lat: number, lon: number} | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);

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
        vehiclesData.forEach((v: any) => labelsRef.current.set(v.id, v.label));
      }

      // Load latest position PER vehicle (get recent positions)
      const { data: posData } = await supabase
        .from('vehicle_positions')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(50);

      if (posData && posData.length > 0) {
        const newBuses = new Map<string, TrackedBus>();
        const seen = new Set<string>();

        for (const row of posData) {
          const vp = row as VehiclePosition;
          if (seen.has(vp.vehicle_id)) continue; // already have the latest for this vehicle
          seen.add(vp.vehicle_id);

          // Only include if position is less than 10 minutes old
          const age = Date.now() - new Date(vp.timestamp).getTime();
          if (age > 10 * 60 * 1000) continue;

          newBuses.set(vp.vehicle_id, {
            pos: vp,
            renderLat: vp.latitude,
            renderLon: vp.longitude,
            lastUpdateMs: Date.now(),
            label: labelsRef.current.get(vp.vehicle_id) || 'Bus',
          });
        }

        setBuses(newBuses);
        busesRef.current = newBuses;
      }
    }
    loadInitialData();
  }, []);

  // 2. Fetch User Geolocation (with watch for continuous updates)
  useEffect(() => {
    if (!("navigator" in window) || !("geolocation" in navigator)) {
      setGeoError("Geolocalización no soportada por el navegador");
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setUserPos({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        });
        setGeoError(null);
      },
      (error) => {
        console.warn("Geolocation warning:", error.message);
        if (error.code === 1) setGeoError("Permiso de GPS denegado");
        else if (error.code === 2) setGeoError("Posición no disponible");
        else setGeoError("Error de GPS: " + error.message);
      },
      { enableHighAccuracy: true, maximumAge: 5000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // 3. Supabase Realtime Subscription
  useEffect(() => {
    const channel = supabase
      .channel('public:vehicle_positions')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'vehicle_positions' },
        (payload) => {
          const newPos = payload.new as VehiclePosition;
          const currentBuses = new Map(busesRef.current);

          currentBuses.set(newPos.vehicle_id, {
            pos: newPos,
            renderLat: newPos.latitude,
            renderLon: newPos.longitude,
            lastUpdateMs: Date.now(),
            label: labelsRef.current.get(newPos.vehicle_id) || 'Bus',
          });

          busesRef.current = currentBuses;
          setBuses(currentBuses);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // 4. Interpolation Engine (throttled to 1s to prevent render overflow)
  useEffect(() => {
    const intervalId = setInterval(() => {
      const now = Date.now();
      let changed = false;
      const updated = new Map(busesRef.current);

      for (const [id, bus] of updated) {
        const elapsed = now - bus.lastUpdateMs;

        // If signal lost for > 5 seconds and bus was moving, interpolate
        if (elapsed > 5000 && bus.pos.speed_kmh > 0) {
          const predicted = interpolatePosition(
            { lat: bus.pos.latitude, lon: bus.pos.longitude },
            bus.pos.speed_kmh,
            bus.pos.heading,
            elapsed
          );
          bus.renderLat = predicted.lat;
          bus.renderLon = predicted.lon;
          changed = true;
        }

        // Remove buses that haven't sent data in 10 minutes
        if (elapsed > 10 * 60 * 1000) {
          updated.delete(id);
          changed = true;
        }
      }

      if (changed) {
        busesRef.current = updated;
        setBuses(new Map(updated));
      }
    }, 1000);

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
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <MapContainer 
        center={[5.5353, -73.3677] as [number, number]} 
        zoom={14} 
        minZoom={13} // Nivel ideal para ver toda la ciudad sin salir
        maxBounds={[
          [5.4850, -73.4000] as [number, number], // Suroeste (Un poco más amplio para no cortar el sur y occidente)
          [5.5850, -73.3300] as [number, number]  // Noreste (Un poco más amplio para no cortar el norte y oriente)
        ]}
        maxBoundsViscosity={0.8} // Borde suave, permite rebasar un poco y rebota
        style={{ width: '100%', height: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Render Stops */}
        {stops.map(stop => (
          <CircleMarker 
            key={stop.id} 
            center={[stop.stop_lat, stop.stop_lon] as [number, number]}
            radius={6}
            pathOptions={{ color: '#2b6cb0', fillColor: '#4299e1', fillOpacity: 0.8 }}
          >
            <Popup>
              <strong>{stop.stop_name}</strong>
            </Popup>
          </CircleMarker>
        ))}

        {/* Render User Location */}
        {userPos && (
          <Marker position={[userPos.lat, userPos.lon] as [number, number]} icon={userIcon}>
            <Popup>¡Estás aquí!</Popup>
          </Marker>
        )}

        {/* Render ALL Buses */}
        {Array.from(buses.entries()).map(([vehicleId, bus]) => {
          const isNearest = nearestBus?.pos.vehicle_id === vehicleId;
          return (
            <Marker 
              key={vehicleId} 
              position={[bus.renderLat, bus.renderLon] as [number, number]} 
              icon={isNearest ? nearestBusIcon : busIcon}
            >
              <Popup>
                <strong>{bus.label}</strong>{isNearest ? ' ⭐ Más cercano' : ''}<br />
                Velocidad: {Math.round(bus.pos.speed_kmh)} km/h
              </Popup>
            </Marker>
          );
        })}

        {/* Botón para centrar en el usuario manualmente */}
        <LocateUserButton userPos={userPos} geoError={geoError} />

        {/* Auto centrar al encontrar al usuario la primera vez */}
        <AutoCenterMap userPos={userPos} />

      </MapContainer>

      {/* Render ETA Panel for the nearest bus */}
      {nearestBus && (
        <ETAPanel 
          busLat={nearestBus.renderLat} 
          busLon={nearestBus.renderLon} 
          busSpeedKmh={nearestBus.pos.speed_kmh}
          busLabel={nearestBus.label}
          userPos={userPos}
          stops={stops} 
        />
      )}
    </div>
  );
}

// Componente hijo para usar el hook useMap de Leaflet
function LocateUserButton({ userPos, geoError }: { userPos: {lat: number, lon: number} | null, geoError: string | null }) {
  const map = useMap();

  return (
    <div style={{ position: 'absolute', top: 20, right: 20, zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
      <button 
        onClick={() => {
          if (userPos) {
            map.flyTo([userPos.lat, userPos.lon], 16, { animate: true });
          } else if (!geoError) {
            alert("Buscando tu ubicación...");
          }
        }}
        style={{
          backgroundColor: 'white',
          border: 'none',
          borderRadius: '50%',
          width: '44px',
          height: '44px',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          cursor: 'pointer',
          color: userPos ? '#3182ce' : '#a0aec0'
        }}
        title="Centrar en mi ubicación"
      >
        <LocateFixed size={24} />
      </button>
      
      {geoError && (
        <div style={{ backgroundColor: 'rgba(255,255,255,0.9)', padding: '6px 12px', borderRadius: '8px', fontSize: '12px', color: '#e53e3e', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', maxWidth: '200px', textAlign: 'right' }}>
          ⚠️ {geoError}
        </div>
      )}
    </div>
  );
}

// Componente hijo para hacer un flyTo() automático SOLO la primera vez que se obtienen las coordenadas del usuario
function AutoCenterMap({ userPos }: { userPos: {lat: number, lon: number} | null }) {
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
