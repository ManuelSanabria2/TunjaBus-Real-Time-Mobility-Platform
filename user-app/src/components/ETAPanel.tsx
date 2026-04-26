"use client";

import React, { useEffect, useState } from 'react';
import { haversineDistance, Stop } from '../lib/geo';
import { Clock, MapPin, Bus, Gauge } from 'lucide-react';

interface ETAPanelProps {
  busLat: number;
  busLon: number;
  busSpeedKmh: number;
  busLabel: string;
  userPos: { lat: number, lon: number } | null;
  stops: Stop[];
}

export default function ETAPanel({ busLat, busLon, busSpeedKmh, busLabel, userPos, stops }: ETAPanelProps) {
  const [etaMinutes, setEtaMinutes] = useState<number | null>(null);
  const [nearestStop, setNearestStop] = useState<Stop | null>(null);
  const [distBusToUserKm, setDistBusToUserKm] = useState<number | null>(null);
  const [distBusToStopKm, setDistBusToStopKm] = useState<number | null>(null);

  useEffect(() => {
    if (stops.length === 0) return;

    // 1. Find the stop nearest to the USER
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
      // Fallback: find stop nearest to the bus
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

    // 2. Calculate distances
    const distBusStop = haversineDistance(busLat, busLon, targetStop.stop_lat, targetStop.stop_lon);
    setDistBusToStopKm(distBusStop);

    if (userPos) {
      const distDirect = haversineDistance(busLat, busLon, userPos.lat, userPos.lon);
      setDistBusToUserKm(distDirect);
    }

    // 3. ETA calculation based on ACTUAL bus speed
    //    Priority: real speed > minimum walking-equivalent fallback
    const MIN_SPEED_KMH = 8; // minimum to avoid divide-by-zero or absurd ETAs
    const effectiveSpeed = Math.max(busSpeedKmh, MIN_SPEED_KMH);

    // Distance for ETA: bus → user's nearest stop
    let hoursToArrive = distBusStop / effectiveSpeed;

    // Traffic correction factor based on time of day
    const now = new Date();
    const minutesOfDay = now.getHours() * 60 + now.getMinutes();
    let trafficFactor = 1.0;

    // 6:30 AM - 8:00 AM (morning rush: 25% slower)
    if (minutesOfDay >= 390 && minutesOfDay <= 480) {
      trafficFactor = 1.25;
    }
    // 12:00 PM - 2:00 PM (midday: 35% slower)
    else if (minutesOfDay >= 720 && minutesOfDay <= 840) {
      trafficFactor = 1.35;
    }
    // 5:30 PM - 7:30 PM (evening rush: 45% slower)
    else if (minutesOfDay >= 1050 && minutesOfDay <= 1170) {
      trafficFactor = 1.45;
    }

    hoursToArrive *= trafficFactor;
    const minutes = Math.max(1, Math.round(hoursToArrive * 60));

    setEtaMinutes(minutes);
  }, [busLat, busLon, busSpeedKmh, userPos, stops]);

  if (!nearestStop) return null;

  // Determine ETA color based on time
  const getEtaColor = () => {
    if (etaMinutes === null) return '#718096';
    if (etaMinutes <= 3) return '#38a169'; // green - arriving
    if (etaMinutes <= 10) return '#d69e2e'; // yellow - close
    return '#e53e3e'; // red - far
  };

  const getEtaLabel = () => {
    if (etaMinutes === null) return 'Calculando...';
    if (etaMinutes <= 1) return '¡Llegando!';
    return `~ ${etaMinutes} min`;
  };

  return (
    <div style={{
      position: 'absolute',
      bottom: 30,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 1000,
      backgroundColor: 'rgba(255, 255, 255, 0.97)',
      padding: '16px 24px',
      borderRadius: '16px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
      minWidth: '340px',
      maxWidth: '420px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      fontFamily: 'system-ui, sans-serif',
      backdropFilter: 'blur(10px)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #edf2f7', paddingBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#1a365d' }}>
          <Bus size={20} />
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>{busLabel}</h3>
            <span style={{ fontSize: '11px', color: '#718096' }}>Más cercano a ti</span>
          </div>
        </div>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '6px', 
          color: getEtaColor(), 
          fontWeight: 'bold',
          fontSize: '18px',
        }}>
          <Clock size={18} />
          <span>{getEtaLabel()}</span>
        </div>
      </div>
      
      {/* Speed + Distance info */}
      <div style={{ display: 'flex', gap: '16px' }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', backgroundColor: '#f7fafc', borderRadius: '10px' }}>
          <Gauge size={18} color="#3182ce" />
          <div>
            <p style={{ margin: 0, fontSize: '11px', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Velocidad</p>
            <p style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: '#2d3748' }}>
              {Math.round(busSpeedKmh)} km/h
            </p>
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', backgroundColor: '#f7fafc', borderRadius: '10px' }}>
          <MapPin size={18} color="#e53e3e" />
          <div>
            <p style={{ margin: 0, fontSize: '11px', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Distancia</p>
            <p style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: '#2d3748' }}>
              {distBusToUserKm !== null 
                ? (distBusToUserKm < 1 
                    ? `${(distBusToUserKm * 1000).toFixed(0)} m` 
                    : `${distBusToUserKm.toFixed(1)} km`)
                : (distBusToStopKm !== null 
                    ? (distBusToStopKm < 1 
                        ? `${(distBusToStopKm * 1000).toFixed(0)} m` 
                        : `${distBusToStopKm.toFixed(1)} km`)
                    : '—')
              }
            </p>
          </div>
        </div>
      </div>

      {/* Nearest stop */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', backgroundColor: '#ebf8ff', borderRadius: '10px' }}>
        <MapPin size={20} color="#2b6cb0" />
        <div>
          <p style={{ margin: 0, fontSize: '11px', color: '#4a5568', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Paradero más cercano {userPos ? 'a ti' : 'al bus'}
          </p>
          <p style={{ margin: '2px 0 0', fontSize: '15px', fontWeight: '600', color: '#1a365d' }}>
            {nearestStop.stop_name}
          </p>
        </div>
      </div>
    </div>
  );
}
