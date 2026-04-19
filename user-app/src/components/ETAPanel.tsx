"use client";

import React, { useEffect, useState } from 'react';
import { haversineDistance, Stop } from '../lib/geo';
import { Clock, MapPin, Bus } from 'lucide-react';

interface ETAPanelProps {
  busLat: number;
  busLon: number;
  busSpeedKmh: number;
  userPos: { lat: number, lon: number } | null;
  stops: Stop[];
}

export default function ETAPanel({ busLat, busLon, busSpeedKmh, userPos, stops }: ETAPanelProps) {
  const [etaMinutes, setEtaMinutes] = useState<number | null>(null);
  const [nearestStop, setNearestStop] = useState<Stop | null>(null);
  const [distanceToStopKm, setDistanceToStopKm] = useState<number | null>(null);

  useEffect(() => {
    if (stops.length === 0) return;

    // 1. Mostrar el paradero más cercano AL USUARIO (usando userPos)
    let targetStop = stops[0];

    if (userPos) {
      let minUserDist = haversineDistance(userPos.lat, userPos.lon, targetStop.stop_lat, targetStop.stop_lon);
      for (let i = 1; i < stops.length; i++) {
        const d = haversineDistance(userPos.lat, userPos.lon, stops[i].stop_lat, stops[i].stop_lon);
        if (d < minUserDist) {
          minUserDist = d;
          targetStop = stops[i];
        }
      }
    } else {
      // Fallback si no hay ubicación de usuario: mostramos a dónde se dirige el bus
      let minBusDist = haversineDistance(busLat, busLon, targetStop.stop_lat, targetStop.stop_lon);
      for (let i = 1; i < stops.length; i++) {
        const d = haversineDistance(busLat, busLon, stops[i].stop_lat, stops[i].stop_lon);
        if (d < minBusDist) {
          minBusDist = d;
          targetStop = stops[i];
        }
      }
    }

    setNearestStop(targetStop);

    // 2. Calcular la distancia Haversine entre el BUS y ESE paradero
    const distBusToStop = haversineDistance(busLat, busLon, targetStop.stop_lat, targetStop.stop_lon);
    setDistanceToStopKm(distBusToStop);

    // 3. Calcular ETA dinámico
    const now = new Date();
    const hour = now.getHours();
    
    // Velocidad promedio por histórico de segmentos
    const baseSegmentSpeed = 20.0; // km/h
    
    // Si el bus realmente se está moviendo, privilegiamos esa velocidad para el ETA local
    const baseSpeed = busSpeedKmh > 5 ? busSpeedKmh : baseSegmentSpeed;
    
    let hoursToStop = distBusToStop / baseSpeed;

    // Factor Evaluador de Hora Pico (Traffic Correction Factor)
    // 12PM - 2PM (35% más lento)
    // 5:30PM - 7:30PM (45% más lento)
    let trafficFactor = 1.0;
    const minutesAccu = hour * 60 + now.getMinutes();

    if (minutesAccu >= 12 * 60 && minutesAccu <= 14 * 60) {
      trafficFactor = 1.35;
    } else if (minutesAccu >= 17 * 60 + 30 && minutesAccu <= 19 * 60 + 30) {
      trafficFactor = 1.45;
    }

    hoursToStop *= trafficFactor;
    const minutes = Math.round(hoursToStop * 60);

    setEtaMinutes(minutes);
  }, [busLat, busLon, busSpeedKmh, userPos, stops]);

  if (!nearestStop) return null;

  return (
    <div style={{
      position: 'absolute',
      bottom: 30,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 1000,
      backgroundColor: 'rgba(255, 255, 255, 0.95)',
      padding: '16px 24px',
      borderRadius: '16px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
      minWidth: '320px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      fontFamily: 'system-ui, sans-serif'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #eee', paddingBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#1a365d' }}>
          <Bus size={20} />
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>Tunjabus Tracking</h3>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#e53e3e', fontWeight: 'bold' }}>
          <Clock size={18} />
          <span>{etaMinutes === 0 ? 'Llegando...' : `~ \${etaMinutes} min`}</span>
        </div>
      </div>
      
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <MapPin size={24} color="#3182ce" style={{ marginTop: '2px' }} />
        <div>
          <p style={{ margin: 0, fontSize: '12px', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Paradero más cercano {userPos ? 'a ti' : 'al bus'}
          </p>
          <p style={{ margin: '2px 0 0', fontSize: '16px', fontWeight: '600', color: '#2d3748' }}>
            {nearestStop.stop_name}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#4a5568' }}>
            El bus está a {(distanceToStopKm! * 1000).toFixed(0)} metros de aquí.
          </p>
        </div>
      </div>
    </div>
  );
}
