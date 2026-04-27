import React, { useState, useEffect } from 'react';
import { Search, User, ArrowLeft, Bus, MapPinned } from 'lucide-react';
import { Stop, haversineDistance } from '../lib/geo';
import { ROUTE_DEFINITIONS, RouteDefinition, matchLabelToRoute } from '../lib/routes';

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
  selectedRouteId: string | null;
  onSelectRoute: (routeId: string | null) => void;
  onFocusBus: (lat: number, lon: number) => void;
  onSaveRoute: () => void;
}

export default function MainMenu({ buses, userPos, stops, selectedRouteId, onSelectRoute, onFocusBus, onSaveRoute }: MainMenuProps) {
  const [selectedBusId, setSelectedBusId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'buses' | 'rutas'>('buses');
  const [routeSearch, setRouteSearch] = useState('');
  
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
    const routeInfo = matchLabelToRoute(bus.label) || ROUTE_DEFINITIONS[0];

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

  // Filter routes by search
  const filteredRoutes = ROUTE_DEFINITIONS.filter(r => {
    if (!routeSearch) return true;
    const q = routeSearch.toLowerCase();
    return r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q);
  });

  // ──── Tab Selector ────
  const renderTabSelector = () => (
    <div style={{
      display: 'flex',
      background: 'rgba(243, 239, 233, 0.08)',
      borderRadius: '10px',
      padding: '3px',
      gap: '3px',
    }}>
      <button
        onClick={() => { setActiveTab('buses'); onSelectRoute(null); }}
        style={{
          flex: 1,
          padding: '10px 0',
          borderRadius: '8px',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          fontSize: '13px',
          fontWeight: 600,
          fontFamily: 'var(--font-sans)',
          transition: 'var(--anden-transition)',
          background: activeTab === 'buses' ? 'rgba(243, 239, 233, 0.15)' : 'transparent',
          color: activeTab === 'buses' ? 'var(--anden-piedra)' : 'var(--anden-niebla)',
        }}
      >
        <Bus size={15} /> En vivo
      </button>
      <button
        onClick={() => { setActiveTab('rutas'); setSelectedBusId(null); }}
        style={{
          flex: 1,
          padding: '10px 0',
          borderRadius: '8px',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          fontSize: '13px',
          fontWeight: 600,
          fontFamily: 'var(--font-sans)',
          transition: 'var(--anden-transition)',
          background: activeTab === 'rutas' ? 'rgba(243, 239, 233, 0.15)' : 'transparent',
          color: activeTab === 'rutas' ? 'var(--anden-piedra)' : 'var(--anden-niebla)',
        }}
      >
        <MapPinned size={15} /> Rutas
      </button>
    </div>
  );

  // ──── Bus List (En vivo tab) ────
  const renderBusList = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto', paddingBottom: '20px' }}>
      {busList.map((item) => (
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
              background: item.routeInfo.color, 
              color: '#F3EFE9', 
              padding: '4px 8px', 
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 700
            }}>
              {item.routeInfo.code}
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
            <div style={{ flex: 2, background: item.routeInfo.color, borderRadius: '2px', opacity: 0.7 }} />
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
  );

  // ──── Route Catalog (Rutas tab) ────
  const renderRouteCatalog = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto', paddingBottom: '20px' }}>
      {/* Route search */}
      <div style={{
        background: 'rgba(243, 239, 233, 0.1)',
        borderRadius: '10px',
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        marginBottom: '4px',
      }}>
        <Search size={16} color="var(--anden-niebla)" />
        <input 
          type="text"
          placeholder="Buscar ruta..." 
          value={routeSearch}
          onChange={(e) => setRouteSearch(e.target.value)}
          style={{
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--anden-piedra)',
            fontFamily: 'var(--font-sans)',
            fontSize: '14px',
            width: '100%'
          }}
        />
      </div>

      {filteredRoutes.map((route) => {
        const isSelected = selectedRouteId === route.id;
        return (
          <div
            key={route.id}
            onClick={() => onSelectRoute(isSelected ? null : route.id)}
            style={{
              background: isSelected ? `${route.color}22` : 'rgba(243, 239, 233, 0.05)',
              border: `1px solid ${isSelected ? route.color + '55' : 'rgba(243, 239, 233, 0.1)'}`,
              borderRadius: '14px',
              padding: '14px 16px',
              cursor: 'pointer',
              transition: 'var(--anden-transition)',
              display: 'flex',
              gap: '14px',
              alignItems: 'flex-start',
            }}
          >
            {/* Color indicator */}
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: route.color,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              color: '#F3EFE9',
              fontSize: '11px',
              fontWeight: 800,
              fontFamily: 'var(--font-sans)',
              letterSpacing: '-0.5px',
              boxShadow: isSelected ? `0 4px 12px ${route.color}44` : 'none',
            }}>
              {route.code.replace('R', '')}
            </div>

            {/* Route info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{
                  fontSize: '14px',
                  fontWeight: 700,
                  color: isSelected ? '#F3EFE9' : 'var(--anden-piedra)',
                }}>
                  {route.name}
                </span>
              </div>
              <p style={{
                margin: 0,
                fontSize: '12px',
                color: 'var(--anden-niebla)',
                lineHeight: '1.4',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {route.description}
              </p>
            </div>
          </div>
        );
      })}

      {filteredRoutes.length === 0 && (
        <p style={{ color: 'var(--anden-niebla)', textAlign: 'center', fontSize: '14px', marginTop: '20px' }}>
          No se encontraron rutas
        </p>
      )}
    </div>
  );

  // ──── Main List Panel ────
  const renderListPanel = () => (
    <div style={{
      background: 'var(--anden-tinta)',
      color: 'var(--anden-piedra)',
      padding: '24px 20px',
      borderRadius: isMobile ? '24px 24px 0 0' : '24px',
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
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
            Tunja · {activeTab === 'buses' ? 'En vivo' : `${ROUTE_DEFINITIONS.length} rutas`}
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

      {/* Tab Selector */}
      {renderTabSelector()}

      {/* Content based on active tab */}
      {activeTab === 'buses' ? renderBusList() : renderRouteCatalog()}
    </div>
  );

  // ──── Detail Panel (Bus selected) ────
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
            <span style={{ 
              color: '#F3EFE9', 
              fontWeight: 700, 
              fontSize: '12px', 
              background: routeInfo.color,
              padding: '3px 8px',
              borderRadius: '5px',
            }}>
              {routeInfo.code}
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
            {routeInfo.name}
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

  // ──── Route Detail Panel ────
  const renderRouteDetailPanel = () => {
    if (!selectedRouteId) return null;
    const route = ROUTE_DEFINITIONS.find(r => r.id === selectedRouteId);
    if (!route) return null;

    // Split the description into waypoint names
    const waypointNames = route.description.split(/\s*[-—]\s*/);

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
        {isMobile && (
          <button 
            onClick={() => onSelectRoute(null)}
            style={{ 
              background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: '8px', 
              color: 'var(--anden-niebla)', cursor: 'pointer', padding: 0, marginBottom: '4px',
              fontFamily: 'var(--font-sans)', fontSize: '14px',
            }}
          >
            <ArrowLeft size={16} /> Volver
          </button>
        )}

        {/* Route Header Card */}
        <div style={{
          background: route.color,
          borderRadius: '16px',
          padding: '20px',
          color: '#F3EFE9',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <div style={{
              width: '40px', height: '40px',
              borderRadius: '10px',
              background: 'rgba(255,255,255,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '16px', fontWeight: 800,
              fontFamily: 'var(--font-sans)',
            }}>
              {route.code.replace('R', '')}
            </div>
            <div>
              <p style={{ margin: 0, fontSize: '11px', opacity: 0.7, letterSpacing: '1px', fontWeight: 600, textTransform: 'uppercase' }}>
                Ruta {route.code}
              </p>
              <p style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>
                {route.name}
              </p>
            </div>
          </div>
        </div>

        {/* Recorrido (Route Path) */}
        <div style={{
          background: '#FFFFFF',
          borderRadius: '16px',
          padding: '20px',
          boxShadow: '0 2px 12px rgba(28, 38, 50, 0.04)',
        }}>
          <p style={{ margin: 0, fontSize: '11px', color: 'var(--anden-niebla)', letterSpacing: '1px', fontWeight: 600, textTransform: 'uppercase', marginBottom: '14px' }}>
            Recorrido
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
            {waypointNames.map((name, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'stretch', gap: '12px' }}>
                {/* Timeline line + dot */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '16px' }}>
                  <div style={{
                    width: '10px', height: '10px',
                    borderRadius: '50%',
                    background: i === 0 || i === waypointNames.length - 1 ? route.color : '#F3EFE9',
                    border: `2.5px solid ${route.color}`,
                    flexShrink: 0,
                    marginTop: '4px',
                  }} />
                  {i < waypointNames.length - 1 && (
                    <div style={{
                      width: '2px',
                      flex: 1,
                      minHeight: '20px',
                      background: `${route.color}33`,
                    }} />
                  )}
                </div>
                {/* Stop name */}
                <p style={{
                  margin: 0,
                  fontSize: '14px',
                  fontWeight: i === 0 || i === waypointNames.length - 1 ? 700 : 500,
                  color: i === 0 || i === waypointNames.length - 1 ? 'var(--anden-tinta)' : 'var(--anden-niebla)',
                  paddingBottom: '12px',
                  fontFamily: 'var(--font-sans)',
                }}>
                  {name.trim()}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Close route button */}
        <button 
          onClick={() => onSelectRoute(null)}
          style={{
            background: 'transparent',
            color: 'var(--anden-tinta)',
            border: '1px solid rgba(28, 38, 50, 0.15)',
            borderRadius: '12px',
            padding: '14px',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'var(--anden-transition)',
            fontFamily: 'var(--font-sans)',
            marginTop: 'auto',
          }}
        >
          Cerrar ruta
        </button>
      </div>
    );
  };

  // Determine which detail panel to show
  const showBusDetail = activeTab === 'buses' && selectedBusId && selectedBusDetails;
  const showRouteDetail = activeTab === 'rutas' && selectedRouteId;

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
          {showBusDetail ? renderDetailPanel() 
           : showRouteDetail ? renderRouteDetailPanel() 
           : renderListPanel()}
        </div>
      ) : (
        // Desktop Layout: Side-by-side
        <div style={{ display: 'flex', gap: '16px', width: '100%', alignItems: 'flex-start' }}>
          <div style={{ width: '360px', flexShrink: 0, boxShadow: 'var(--anden-shadow-lg)', borderRadius: '24px' }}>
            {renderListPanel()}
          </div>
          {showBusDetail && (
            <div style={{ width: '360px', flexShrink: 0, boxShadow: 'var(--anden-shadow-lg)', borderRadius: '24px' }}>
              {renderDetailPanel()}
            </div>
          )}
          {showRouteDetail && (
            <div style={{ width: '360px', flexShrink: 0, boxShadow: 'var(--anden-shadow-lg)', borderRadius: '24px' }}>
              {renderRouteDetailPanel()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
