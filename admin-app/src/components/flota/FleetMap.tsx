"use client";

import { useEffect, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { FleetStatus } from "@/lib/fleet";
import { STATUS_LABEL } from "@/lib/fleet";

export interface MapBus {
  id: string;
  label: string;
  lat: number;
  lon: number;
  status: FleetStatus;
  lastSeen: string;
}

export interface HistoryTrack {
  vehicleId: string;
  label: string;
  coords: [number, number][];
}

const TUNJA_CENTER: [number, number] = [5.5353, -73.3677];

const STATUS_COLOR: Record<FleetStatus, string> = {
  activo: "#5C8265", // Salvia
  "sin-senal": "#B5603A", // Terracota
  critico: "#DC2626", // Rojo — requisito: >10 min resaltado en rojo
};

// divIcon coloreado por estado (mismo espíritu que los SVG data-URI de
// user-app/BusMap.tsx, pero con el color como variable).
function busIcon(status: FleetStatus) {
  const color = STATUS_COLOR[status];
  const criticalRing =
    status === "critico" ? "box-shadow:0 0 0 6px rgb(220 38 38 / 0.25);" : "";
  return L.divIcon({
    className: "",
    html: `<div style="width:34px;height:34px;border-radius:9999px;background:${color};border:2.5px solid #F3EFE9;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgb(28 38 50 / 0.35);${criticalRing}">
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F3EFE9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6v6"/><path d="M16 6v6"/><path d="M2 12h20"/><path d="M18 18h2a1 1 0 0 0 1-1v-9a5 5 0 0 0-5-5H8a5 5 0 0 0-5 5v9a1 1 0 0 0 1 1h2"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>
</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

/** Encuadra el mapa: al historial cuando se activa; a la flota al cargar. */
function MapController({
  buses,
  history,
}: {
  buses: MapBus[];
  history: HistoryTrack | null;
}) {
  const map = useMap();
  const didInitialFit = useRef(false);

  useEffect(() => {
    if (history && history.coords.length > 1) {
      map.fitBounds(L.latLngBounds(history.coords), { padding: [40, 40] });
    }
  }, [history, map]);

  useEffect(() => {
    if (!didInitialFit.current && buses.length > 0) {
      map.fitBounds(
        L.latLngBounds(buses.map((b) => [b.lat, b.lon] as [number, number])),
        { padding: [60, 60], maxZoom: 15 }
      );
      didInitialFit.current = true;
    }
  }, [buses, map]);

  return null;
}

export default function FleetMap({
  buses,
  history,
}: {
  buses: MapBus[];
  history: HistoryTrack | null;
}) {
  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={TUNJA_CENTER}
        zoom={13}
        style={{ width: "100%", height: "100%" }}
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={20}
        />

        {/* Recorrido de hoy del vehículo seleccionado */}
        {history && history.coords.length > 1 && (
          <Polyline
            positions={history.coords}
            color="#B5603A"
            weight={4}
            opacity={0.85}
          />
        )}

        {/* Buses en tiempo real */}
        {buses.map((bus) => (
          <Marker
            key={bus.id}
            position={[bus.lat, bus.lon]}
            icon={busIcon(bus.status)}
            zIndexOffset={bus.status === "critico" ? 1000 : 0}
          >
            <Popup>
              <div style={{ textAlign: "center", fontFamily: "inherit" }}>
                <strong>{bus.label}</strong>
                <br />
                <span style={{ fontSize: 12, color: STATUS_COLOR[bus.status] }}>
                  {STATUS_LABEL[bus.status]}
                </span>
                <br />
                <span style={{ fontSize: 11, color: "#8C867E" }}>
                  Última señal: {bus.lastSeen}
                </span>
              </div>
            </Popup>
          </Marker>
        ))}

        <MapController buses={buses} history={history} />
      </MapContainer>

      {/* Leyenda */}
      <div className="absolute bottom-3 left-3 z-[1000] rounded-anden bg-white/95 px-3 py-2 text-[11px] shadow-anden-sm">
        {(Object.keys(STATUS_COLOR) as FleetStatus[]).map((s) => (
          <span key={s} className="mr-3 inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: STATUS_COLOR[s] }}
            />
            {STATUS_LABEL[s]}
          </span>
        ))}
      </div>
    </div>
  );
}
