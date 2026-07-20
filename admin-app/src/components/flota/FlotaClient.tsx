"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Role } from "@/lib/auth";
import type { FleetVehicle } from "@/lib/fleet";
import { getStatus, formatRelative, downsample } from "@/lib/fleet";
import FleetTable from "./FleetTable";
import AddVehicleModal from "./AddVehicleModal";
import TokenModal, { type TokenFlow } from "./TokenModal";
import type { HistoryTrack, MapBus } from "./FleetMap";

// Leaflet toca window: siempre client-only (mismo patrón que user-app/page.tsx).
const FleetMap = dynamic(() => import("./FleetMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-niebla">
      Cargando mapa…
    </div>
  ),
});

interface PositionRow {
  vehicle_id: string;
  latitude: number;
  longitude: number;
  timestamp: string;
}

const HISTORY_PAGE_SIZE = 1000; // límite por request de PostgREST en Supabase
const HISTORY_MAX_PAGES = 10;
const HISTORY_MAX_POINTS = 2500;

export default function FlotaClient({ role }: { role: Role }) {
  const supabase = useMemo(() => createClient(), []);

  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Tick para recomputar estados (activo / >2min / >10min) sin nuevas señales.
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [history, setHistory] = useState<HistoryTrack | null>(null);
  const [historyLoadingId, setHistoryLoadingId] = useState<string | null>(null);

  // Alta de vehículo y exhibición/regeneración de token.
  const [showAddModal, setShowAddModal] = useState(false);
  const [tokenFlow, setTokenFlow] = useState<TokenFlow | null>(null);

  // 1. Carga de flota: vehículos del alcance + última posición (vista de la
  //    migración 004). El alcance lo define el rol: operator filtra por sus
  //    cooperativas (RPC member_operator_ids), authority ve todo.
  const loadFleet = useCallback(async () => {
    try {
      let query = supabase
        .from("vehicles")
        .select("id, label, operator_id, routes(short_name, long_name)");

      if (role === "operator") {
        const { data: opIds, error: opError } = await supabase.rpc(
          "member_operator_ids"
        );
        if (opError) throw opError;
        const ids = (opIds ?? []) as string[];
        if (ids.length === 0) {
          setVehicles([]);
          setLoading(false);
          return;
        }
        query = query.in("operator_id", ids);
      }

      const { data: vehicleRows, error: vehiclesError } = await query.order(
        "label"
      );
      if (vehiclesError) throw vehiclesError;

      const { data: latestRows, error: latestError } = await supabase
        .from("latest_vehicle_positions")
        .select("vehicle_id, latitude, longitude, timestamp");
      if (latestError) throw latestError;

      const latestByVehicle = new Map<string, PositionRow>(
        (latestRows ?? []).map((p) => [p.vehicle_id as string, p as PositionRow])
      );

      const fleet: FleetVehicle[] = (vehicleRows ?? []).map((v) => {
        const last = latestByVehicle.get(v.id as string);
        // El join FK devuelve un objeto (o null si el vehículo no tiene ruta).
        const route = v.routes as { short_name?: string } | null;
        return {
          id: v.id as string,
          label: v.label as string,
          routeName: route?.short_name ?? null,
          lastLat: last?.latitude ?? null,
          lastLon: last?.longitude ?? null,
          lastTs: last?.timestamp ?? null,
        };
      });

      setVehicles(fleet);
      setLoading(false);
    } catch (e) {
      setError(
        "No se pudo cargar la flota. Verifica que las migraciones 001–004 estén aplicadas en Supabase."
      );
      setLoading(false);
      console.error("Flota load error:", e);
    }
  }, [role, supabase]);

  useEffect(() => {
    Promise.resolve().then(loadFleet);
  }, [loadFleet]);

  // 2. Realtime: mismo patrón que user-app/BusMap.tsx — INSERTs en
  //    vehicle_positions. Solo actualizamos vehículos ya cargados, lo que
  //    además respeta el alcance del operador.
  useEffect(() => {
    const channel = supabase
      .channel("admin:vehicle_positions")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "vehicle_positions" },
        (payload) => {
          const pos = payload.new as PositionRow;
          setVehicles((prev) =>
            prev.map((v) =>
              v.id === pos.vehicle_id
                ? {
                    ...v,
                    lastLat: pos.latitude,
                    lastLon: pos.longitude,
                    lastTs: pos.timestamp,
                  }
                : v
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  // 3. Tick de 15s: los estados dependen del reloj, no solo de nuevas señales.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  // 4. Historial de hoy: paginado (PostgREST corta en 1000 filas/request) y
  //    reducido a HISTORY_MAX_POINTS para que la polilínea no ahogue a Leaflet.
  const toggleHistory = useCallback(
    async (vehicle: FleetVehicle) => {
      setNotice(null);

      if (history?.vehicleId === vehicle.id) {
        setHistory(null);
        return;
      }

      setHistoryLoadingId(vehicle.id);
      try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const coords: [number, number][] = [];
        for (let page = 0; page < HISTORY_MAX_PAGES; page++) {
          const { data, error: pageError } = await supabase
            .from("vehicle_positions")
            .select("latitude, longitude")
            .eq("vehicle_id", vehicle.id)
            .gte("timestamp", startOfDay.toISOString())
            .order("timestamp", { ascending: true })
            .range(page * HISTORY_PAGE_SIZE, (page + 1) * HISTORY_PAGE_SIZE - 1);

          if (pageError) throw pageError;
          if (!data || data.length === 0) break;
          data.forEach((p) => coords.push([p.latitude, p.longitude]));
          if (data.length < HISTORY_PAGE_SIZE) break;
        }

        if (coords.length < 2) {
          setNotice(`${vehicle.label} no tiene recorrido registrado hoy.`);
          setHistory(null);
        } else {
          setHistory({
            vehicleId: vehicle.id,
            label: vehicle.label,
            coords: downsample(coords, HISTORY_MAX_POINTS),
          });
        }
      } catch (e) {
        setNotice(`No se pudo cargar el historial de ${vehicle.label}.`);
        console.error("Historial error:", e);
      } finally {
        setHistoryLoadingId(null);
      }
    },
    [history, supabase]
  );

  // Derivados para el mapa y los contadores.
  const mapBuses: MapBus[] = useMemo(
    () =>
      vehicles
        .filter((v) => v.lastLat !== null && v.lastLon !== null)
        .map((v) => ({
          id: v.id,
          label: v.label,
          lat: v.lastLat as number,
          lon: v.lastLon as number,
          status: getStatus(v.lastTs, nowMs),
          lastSeen: formatRelative(v.lastTs, nowMs),
        })),
    [vehicles, nowMs]
  );

  const counts = useMemo(() => {
    const c = { activo: 0, "sin-senal": 0, critico: 0 };
    vehicles.forEach((v) => c[getStatus(v.lastTs, nowMs)]++);
    return c;
  }, [vehicles, nowMs]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="mb-1 font-serif text-3xl font-semibold text-tinta">
            Flota
          </h1>
          <p className="text-sm text-niebla">
            {role === "authority"
              ? "Vehículos de todas las cooperativas (solo lectura)."
              : "Los vehículos de tu cooperativa, en tiempo real."}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-bold">
          <span className="rounded-full bg-salvia-soft px-3 py-1.5 text-salvia">
            {counts.activo} activos
          </span>
          <span className="rounded-full bg-terracota-soft px-3 py-1.5 text-terracota">
            {counts["sin-senal"]} sin señal
          </span>
          <span className="rounded-full bg-red-100 px-3 py-1.5 text-red-700">
            {counts.critico} críticos
          </span>
          {role === "operator" && (
            <button
              onClick={() => setShowAddModal(true)}
              className="ml-2 inline-flex items-center gap-1.5 rounded-anden bg-terracota px-4 py-2 text-xs font-bold text-piedra shadow-anden-sm transition hover:brightness-110"
            >
              <Plus size={15} /> Agregar vehículo
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-anden bg-red-100 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p className="mb-4 rounded-anden bg-terracota-soft px-4 py-3 text-sm font-medium text-terracota">
          {notice}
        </p>
      )}

      {loading ? (
        <div className="rounded-anden-lg bg-white/60 p-10 text-center text-sm text-niebla">
          Cargando flota…
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-5">
          <div className="xl:col-span-3">
            <FleetTable
              vehicles={vehicles}
              nowMs={nowMs}
              role={role}
              historyVehicleId={history?.vehicleId ?? null}
              historyLoadingId={historyLoadingId}
              onToggleHistory={toggleHistory}
              onRegenerateToken={(v) =>
                setTokenFlow({ vehicleId: v.id, label: v.label, token: null })
              }
            />
          </div>
          <div className="h-[420px] overflow-hidden rounded-anden-lg shadow-anden-md xl:col-span-2 xl:sticky xl:top-10 xl:h-[560px]">
            <FleetMap buses={mapBuses} history={history} />
          </div>
        </div>
      )}

      {/* Alta de vehículo → al crear pasa directo a la exhibición del token */}
      {showAddModal && (
        <AddVehicleModal
          onClose={() => setShowAddModal(false)}
          onCreated={(vehicleId, label, token) => {
            setShowAddModal(false);
            setTokenFlow({ vehicleId, label, token });
            Promise.resolve().then(loadFleet);
          }}
        />
      )}

      {/* Exhibición única del token / flujo de regeneración */}
      {tokenFlow && (
        <TokenModal flow={tokenFlow} onClose={() => setTokenFlow(null)} />
      )}
    </div>
  );
}
