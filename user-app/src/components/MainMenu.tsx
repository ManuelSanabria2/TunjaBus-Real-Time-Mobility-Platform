import React, { useState, useEffect } from 'react';
import { Search, User, ArrowLeft } from 'lucide-react';
import { Stop, haversineDistance } from '../lib/geo';

// Extend TrackedBus interface locally for type checking
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

interface MainMenuProps {
  buses: Map<string, TrackedBus>;
  userPos: { lat: number, lon: number } | null;
  stops: Stop[];
  onFocusBus: (lat: number, lon: number) => void;
  onSaveRoute: () => void;
}

// Mock route data mapping with Tunja neighborhoods
const MOCK_ROUTES: Record<string, { id: string, name: string, number: string }> = {
  '12': { id: '12', name: 'Centro — Terminal Norte', number: 'R-12' },
  '07': { id: '07', name: 'UPTC — Av. Colón', number: 'R-07' },
  '01': { id: '01', name: 'Los Muiscas — Centro', number: 'R-01' },
  '02': { id: '02', name: 'Coeducadores — Plaza Real', number: 'R-02' },
  '03': { id: '03', name: 'San Antonio — Patriotas', number: 'R-03' },
  '04': { id: '04', name: 'El Dorado — Las Nieves', number: 'R-04' },
  '05': { id: '05', name: 'Ciudad Jardín — Centro', number: 'R-05' },
  '06': { id: '06', name: 'Altamira — Terminal Sur', number: 'R-06' },
  'default': { id: '00', name: 'Ruta Circular (Tunja)', number: 'R-00' }
};

export default function MainMenu({ buses, userPos, stops, onFocusBus, onSaveRoute }: MainMenuProps) {
  const [selectedBusId, setSelectedBusId] = useState<string | null>(null);
  
  // Mobile responsive detection
  const [isMobile, setIsMobile] = useState(false);
  
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Compute enriched bus data (ETA, Route info)
  const busList = Array.from(buses.entries()).map(([id, bus]) => {
    // Attempt to extract a route number from the label (e.g., "Bus 12" -> "12")
    const routeMatch = bus.label.match(/\d+/);
    const routeNum = routeMatch ? routeMatch[0] : 'default';
    const routeInfo = MOCK_ROUTES[routeNum] || MOCK_ROUTES['default'];

    // Simple ETA calculation to nearest stop
    let etaMinutes = 0;
    let nearestStop = stops[0];
    
    if (stops.length > 0) {
      let minDist = Infinity;
      const targetPos = userPos || { lat: bus.renderLat, lon: bus.renderLon };
      
      stops.forEach(stop => {
        const d = haversineDistance(targetPos.lat, targetPos.lon, stop.stop_lat, stop.stop_lon);
        if (d < minDist) {
          minDist = d;
          nearestStop = stop;
        }
      });

      const distBusStop = haversineDistance(bus.renderLat, bus.renderLon, nearestStop.stop_lat, nearestStop.stop_lon);
      const effectiveSpeed = Math.max(bus.pos.speed_kmh, 8); // min 8km/h
      etaMinutes = Math.max(1, Math.round((distBusStop / effectiveSpeed) * 60));
    }

    return {
      id,
      bus,
      routeInfo,
      etaMinutes,
      nearestStop,
      distanceKm: userPos ? haversineDistance(bus.renderLat, bus.renderLon, userPos.lat, userPos.lon) : 0
    };
  });

  // Sort by ETA or Distance
  busList.sort((a, b) => a.etaMinutes - b.etaMinutes);

  const selectedBusDetails = selectedBusId ? busList.find(b => b.id === selectedBusId) : null;

  // Render Left Panel (Search & List)
  const renderListPanel = () => (
    <div style={{
      background: 'var(--anden-tinta)',
      color: 'var(--anden-piedra)',
      padding: '24px 20px',
      borderRadius: isMobile ? '24px 24px 0 0' : '24px',
      display: 'flex',
      flexDirection: 'column',
      gap: '20px',
      width: '100%',
      height: '100%',
      minHeight: isMobile ? '400px' : 'auto',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ 
            fontFamily: 'var(--font-serif)', 
            fontSize: '32px', 
            margin: 0, 
            letterSpacing: '-1px',
            color: 'var(--anden-piedra)'
          }}>
            And<span style={{ color: 'var(--anden-terracota)' }}>é</span>n
          </h1>
          <p style={{ 
            margin: 0, 
            fontSize: '11px', 
            color: 'var(--anden-niebla)', 
            letterSpacing: '1px', 
            fontWeight: 600,
            textTransform: 'uppercase'
          }}>
            Tunja · En vivo
          </p>
        </div>
        <button style={{
          background: 'rgba(243, 239, 233, 0.1)',
          border: '1px solid rgba(243, 239, 233, 0.1)',
          borderRadius: '12px',
          width: '40px', height: '40px',
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          cursor: 'pointer', color: 'var(--anden-piedra)'
        }}>
          <User size={18} />
        </button>
      </div>

      {/* Search Bar */}
      <div style={{
        background: 'rgba(243, 239, 233, 0.1)',
        borderRadius: '12px',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px'
      }}>
        <Search size={18} color="var(--anden-niebla)" />
        <input 
          type="text" 
          placeholder="¿A dónde vas?" 
          style={{
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--anden-piedra)',
            fontFamily: 'var(--font-sans)',
            fontSize: '15px',
            width: '100%'
          }}
        />
      </div>

      {/* Route List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto', paddingBottom: '20px' }}>
        {busList.map((item, index) => (
          <div 
            key={item.id}
            onClick={() => {
              setSelectedBusId(item.id);
              onFocusBus(item.bus.renderLat, item.bus.renderLon);
            }}
            style={{
              background: 'rgba(243, 239, 233, 0.05)',
              border: '1px solid rgba(243, 239, 233, 0.1)',
              borderRadius: '16px',
              padding: '16px',
              cursor: 'pointer',
              transition: 'var(--anden-transition)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ 
                background: 'var(--anden-terracota)', 
                color: 'var(--anden-piedra)', 
                padding: '4px 8px', 
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 700
              }}>
                {item.routeInfo.number}
              </span>
              <span style={{ fontSize: '13px', color: 'var(--anden-niebla)' }}>
                Llega en {item.etaMinutes} min
              </span>
            </div>
            <p style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
              {item.routeInfo.name}
            </p>
            {/* Progress Bar (Mock visual) */}
            <div style={{ display: 'flex', height: '2px', marginTop: '16px', gap: '4px' }}>
              <div style={{ flex: 2, background: 'var(--anden-salvia)', borderRadius: '2px' }} />
              <div style={{ flex: 1, background: 'rgba(243, 239, 233, 0.2)', borderRadius: '2px' }} />
            </div>
          </div>
        ))}
        {busList.length === 0 && (
          <p style={{ color: 'var(--anden-niebla)', textAlign: 'center', fontSize: '14px', marginTop: '20px' }}>
            Buscando rutas activas...
          </p>
        )}
      </div>
    </div>
  );

  // Render Right Panel (Route Details)
  const renderDetailPanel = () => {
    if (!selectedBusDetails) return null;
    const { routeInfo, etaMinutes, nearestStop, distanceKm } = selectedBusDetails;

    return (
      <div style={{
        background: 'var(--anden-piedra)',
        padding: '24px 20px',
        borderRadius: isMobile ? '24px 24px 0 0' : '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        width: '100%',
        height: '100%',
        boxShadow: 'var(--anden-shadow-lg)',
      }}>
        {/* Back Button (Mobile only logic can be handled later, but good for UX) */}
        {isMobile && (
          <button 
            onClick={() => setSelectedBusId(null)}
            style={{ 
              background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: '8px', 
              color: 'var(--anden-niebla)', cursor: 'pointer', padding: 0, marginBottom: '8px' 
            }}
          >
            <ArrowLeft size={16} /> Volver
          </button>
        )}

        {/* Top ETA Card */}
        <div style={{
          background: '#FFFFFF',
          borderRadius: '16px',
          padding: '20px',
          boxShadow: '0 2px 12px rgba(28, 38, 50, 0.04)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ color: 'var(--anden-terracota)', fontWeight: 700, fontSize: '14px' }}>
              Ruta {routeInfo.number.replace('R-', '')}
            </span>
            <div style={{ width: '8px', height: '8px', background: 'var(--anden-salvia)', borderRadius: '50%' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '4px' }}>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: '42px', fontWeight: 600, color: 'var(--anden-tinta)', lineHeight: 1 }}>
              {etaMinutes}
            </span>
            <span style={{ fontSize: '16px', color: 'var(--anden-tinta)', fontWeight: 600 }}>min</span>
          </div>
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--anden-niebla)' }}>
            Hacia {routeInfo.name.split('—')[1]?.trim() || routeInfo.name}
          </p>
        </div>

        {/* Next Stop Card */}
        <div style={{
          background: '#FFFFFF',
          borderRadius: '16px',
          padding: '20px',
          boxShadow: '0 2px 12px rgba(28, 38, 50, 0.04)',
        }}>
          <p style={{ margin: 0, fontSize: '11px', color: 'var(--anden-niebla)', letterSpacing: '1px', fontWeight: 600, textTransform: 'uppercase', marginBottom: '8px' }}>
            Próxima Parada
          </p>
          <p style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--anden-tinta)', marginBottom: '4px' }}>
            {nearestStop?.stop_name || 'Desconocida'}
          </p>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--anden-niebla)' }}>
            {distanceKm.toFixed(1)} km · Est. {Math.round(distanceKm / 0.3)} min
          </p>
        </div>

        {/* Action Buttons */}
        <button 
          onClick={() => onFocusBus(selectedBusDetails.bus.renderLat, selectedBusDetails.bus.renderLon)}
          style={{
            background: 'var(--anden-tinta)',
            color: 'var(--anden-piedra)',
            border: 'none',
            borderRadius: '12px',
            padding: '16px',
            fontSize: '15px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'var(--anden-transition)',
            marginTop: 'auto'
          }}
        >
          Ver en el mapa
        </button>
        <button 
          onClick={onSaveRoute}
          style={{
            background: 'transparent',
            color: 'var(--anden-tinta)',
            border: '1px solid rgba(28, 38, 50, 0.15)',
            borderRadius: '12px',
            padding: '16px',
            fontSize: '15px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'var(--anden-transition)',
          }}
        >
          Guardar ruta
        </button>
      </div>
    );
  };

  return (
    <div style={{
      position: 'absolute',
      zIndex: 1000,
      display: 'flex',
      flexDirection: isMobile ? 'column' : 'row',
      gap: isMobile ? '0' : '16px',
      top: isMobile ? 'auto' : '24px',
      bottom: isMobile ? '0' : 'auto',
      left: isMobile ? '0' : '24px',
      right: isMobile ? '0' : 'auto',
      width: isMobile ? '100%' : '760px',
      maxWidth: '100%',
      transition: 'var(--anden-transition)',
      // On desktop, align to top left. On mobile, stick to bottom.
    }}>
      {isMobile ? (
        // Mobile Layout: Bottom Sheet switching between views
        <div style={{ 
          width: '100%', 
          maxHeight: '80vh', 
          overflowY: 'auto',
          boxShadow: 'var(--anden-shadow-lg)',
          borderRadius: '24px 24px 0 0'
        }}>
          {selectedBusId ? renderDetailPanel() : renderListPanel()}
        </div>
      ) : (
        // Desktop Layout: Side-by-side or stacked fixed panel
        <div style={{ display: 'flex', gap: '16px', width: '100%', alignItems: 'flex-start' }}>
          <div style={{ width: '360px', flexShrink: 0, boxShadow: 'var(--anden-shadow-lg)', borderRadius: '24px' }}>
            {renderListPanel()}
          </div>
          {selectedBusId && (
            <div style={{ width: '360px', flexShrink: 0, boxShadow: 'var(--anden-shadow-lg)', borderRadius: '24px' }}>
              {renderDetailPanel()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
