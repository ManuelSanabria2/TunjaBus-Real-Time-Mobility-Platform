"use client";

import React, { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { createClient } from '../utils/supabase/client';
import { interpolatePosition, Stop } from '../lib/geo';
import ETAPanel from './ETAPanel';

// Fix generic leaflet icon issues in Next.js
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Custom Icons
const busIcon = new L.Icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/3448/3448339.png', // Public bus icon
  iconSize: [40, 40],
  iconAnchor: [20, 20],
});

const userIcon = new L.Icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/3082/3082008.png', // Public person/location icon
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

interface VehiclePosition {
  latitude: number;
  longitude: number;
  speed_kmh: number;
  heading: number;
  timestamp: string;
}

export default function BusMap() {
  const supabase = createClient();
  const [stops, setStops] = useState<Stop[]>([]);
  
  // Real-time Bus State
  const [busPos, setBusPos] = useState<VehiclePosition | null>(null);
  
  // Interpolated visual state
  const [renderLat, setRenderLat] = useState<number | null>(null);
  const [renderLon, setRenderLon] = useState<number | null>(null);

  // User Local State
  const [userPos, setUserPos] = useState<{lat: number, lon: number} | null>(null);

  // Animation References
  const lastUpdateMs = useRef<number>(Date.now());
  const animationRef = useRef<number | null>(null);
  const latestBusRef = useRef<VehiclePosition | null>(null);

  // 1. Fetch Static Stops
  useEffect(() => {
    async function loadStops() {
      const { data, error } = await supabase.from('stops').select('*').order('stop_sequence');
      if (data && !error) setStops(data as Stop[]);
    }
    loadStops();
  }, []);

  // 2. Fetch User Geolocation
  useEffect(() => {
    if ("navigator" in window && "geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition((position) => {
        setUserPos({
          lat: position.coords.latitude,
          lon: position.coords.longitude
        });
      }, (error) => {
        console.warn("Geolocation warning:", error.message);
      }, { enableHighAccuracy: true });
    }
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
          setBusPos(newPos);
          latestBusRef.current = newPos;
          
          // Reset visual interpolation immediately
          setRenderLat(newPos.latitude);
          setRenderLon(newPos.longitude);
          lastUpdateMs.current = Date.now();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // 4. Interpolation Engine (RequestAnimationFrame)
  useEffect(() => {
    const animate = () => {
      const now = Date.now();
      const currentBus = latestBusRef.current;

      if (currentBus) {
        const elapsedSinceLastSignal = now - lastUpdateMs.current;

        // If signal lost for > 5 seconds, start interpolating physics
        if (elapsedSinceLastSignal > 5000 && currentBus.speed_kmh > 0) {
          // How much time has passed since the ACTUAL last packet?
          // We predict based on elapsed time
          const predicted = interpolatePosition(
            { lat: currentBus.latitude, lon: currentBus.longitude },
            currentBus.speed_kmh,
            currentBus.heading,
            elapsedSinceLastSignal
          );
          
          setRenderLat(predicted.lat);
          setRenderLon(predicted.lon);
        }
      }
      
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  // Fallback to pure state if interpolation hasn't kicked in
  const displayLat = renderLat ?? busPos?.latitude;
  const displayLon = renderLon ?? busPos?.longitude;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <MapContainer 
        center={[5.5353, -73.3677]} 
        zoom={14} 
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
            center={[stop.stop_lat, stop.stop_lon]}
            radius={6}
            pathOptions={{ color: '#2b6cb0', fillColor: '#4299e1', fillOpacity: 0.8 }}
          >
            <Popup>
              <strong>{stop.stop_name}</strong><br/>
              Distancia a la red: N/A
            </Popup>
          </CircleMarker>
        ))}

        {/* Render User Location */}
        {userPos && (
          <Marker position={[userPos.lat, userPos.lon]} icon={userIcon}>
            <Popup>¡Estás aquí!</Popup>
          </Marker>
        )}

        {/* Render Realtime Bus */}
        {displayLat && displayLon && (
          <Marker position={[displayLat, displayLon]} icon={busIcon}>
            <Popup>
              <strong>TunjaBus Activo</strong><br />
              Velocidad: {Math.round(busPos?.speed_kmh || 0)} km/h
            </Popup>
          </Marker>
        )}

      </MapContainer>

      {/* Render Dynamic ETA Panel on top of the Map */}
      {displayLat && displayLon && busPos && (
        <ETAPanel 
          busLat={displayLat} 
          busLon={displayLon} 
          busSpeedKmh={busPos.speed_kmh}
          userPos={userPos}
          stops={stops} 
        />
      )}
    </div>
  );
}
