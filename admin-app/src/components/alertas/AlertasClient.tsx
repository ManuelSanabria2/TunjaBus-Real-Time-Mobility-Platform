"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BellOff, Check, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Role } from "@/lib/auth";
import { formatRelative } from "@/lib/fleet";

// A diferencia de Flota (tablas de lectura pública, filtro manual), aquí el
// RLS de `alerts` ya limita las filas por rol: el operador solo recibe las de
// sus vehículos y la Secretaría todas. No se filtra nada en el cliente.

interface AlertRow {
  id: string;
  type: string;
  message: string | null;
  created_at: string;
  resolved_at: string | null;
  vehicles: { label: string } | null;
}

const TYPE_LABEL: Record<string, string> = {
  signal_lost: "Pérdida de señal",
};

type Tab = "activas" | "todas";

export default function AlertasClient({ role }: { role: Role }) {
  const supabase = useMemo(() => createClient(), []);

  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("activas");
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const loadAlerts = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from("alerts")
      .select("id, type, message, created_at, resolved_at, vehicles(label)")
      .order("created_at", { ascending: false })
      .limit(200);

    if (loadError) {
      setError(
        "No se pudieron cargar las alertas. Verifica que la migración 005 esté aplicada en Supabase."
      );
      console.error("Alertas load error:", loadError);
    } else {
      setError(null);
      setAlerts((data ?? []) as unknown as AlertRow[]);
    }
    setLoading(false);
  }, [supabase]);

  // Carga inicial + realtime (INSERTs de la Edge Function y UPDATEs de
  // resolución) + tick para los tiempos relativos.
  useEffect(() => {
    // then() en vez de llamada directa: deja claro al linter de React Compiler
    // que ningún setState ocurre de forma síncrona dentro del efecto.
    Promise.resolve().then(loadAlerts);

    const channel = supabase
      .channel("alertas:page")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alerts" },
        () => loadAlerts()
      )
      .subscribe();

    const tick = setInterval(() => setNowMs(Date.now()), 30_000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(tick);
    };
  }, [supabase, loadAlerts]);

  const resolveAlert = useCallback(
    async (alertId: string) => {
      setResolvingId(alertId);
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { error: updateError } = await supabase
        .from("alerts")
        .update({
          resolved_at: new Date().toISOString(),
          resolved_by: user?.id ?? null,
        })
        .eq("id", alertId);

      if (updateError) {
        setError("No se pudo resolver la alerta.");
        console.error("Resolver error:", updateError);
      } else {
        await loadAlerts();
      }
      setResolvingId(null);
    },
    [supabase, loadAlerts]
  );

  const visible = useMemo(
    () =>
      tab === "activas" ? alerts.filter((a) => a.resolved_at === null) : alerts,
    [alerts, tab]
  );

  const activeCount = useMemo(
    () => alerts.filter((a) => a.resolved_at === null).length,
    [alerts]
  );

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="mb-1 font-serif text-3xl font-semibold text-tinta">
            Alertas
          </h1>
          <p className="text-sm text-niebla">
            {role === "authority"
              ? "Alertas de todas las cooperativas (solo lectura)."
              : "Alertas de tu flota. Se generan automáticamente cada 2 minutos."}
          </p>
        </div>
        {activeCount > 0 && (
          <span className="rounded-full bg-red-100 px-3 py-1.5 text-xs font-bold text-red-700">
            {activeCount} activa{activeCount === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-2">
        {(["activas", "todas"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-anden px-4 py-2 text-sm font-semibold transition ${
              tab === t
                ? "bg-tinta text-piedra"
                : "bg-white text-niebla hover:text-tinta"
            }`}
          >
            {t === "activas" ? "Activas" : "Todas"}
          </button>
        ))}
      </div>

      {error && (
        <p className="mb-4 rounded-anden bg-red-100 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </p>
      )}

      {loading ? (
        <div className="rounded-anden-lg bg-white/60 p-10 text-center text-sm text-niebla">
          Cargando alertas…
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-anden-lg border border-dashed border-niebla/40 bg-white/60 p-12 text-center">
          <BellOff size={28} className="text-salvia" />
          <p className="text-sm font-medium text-niebla">
            {tab === "activas"
              ? "Sin alertas activas — toda la flota reporta con normalidad."
              : "No hay alertas registradas."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-anden-lg bg-white shadow-anden-sm">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-piedra text-[11px] uppercase tracking-wider text-niebla">
                <th className="px-5 py-3.5 font-semibold">Vehículo</th>
                <th className="px-5 py-3.5 font-semibold">Alerta</th>
                <th className="px-5 py-3.5 font-semibold">Creada</th>
                <th className="px-5 py-3.5 font-semibold">Estado</th>
                {role === "operator" && (
                  <th className="px-5 py-3.5 font-semibold">Acción</th>
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => {
                const active = a.resolved_at === null;
                return (
                  <tr
                    key={a.id}
                    className={`border-b border-piedra/70 last:border-0 ${
                      active ? "bg-red-50/70" : ""
                    }`}
                  >
                    <td
                      className={`px-5 py-3.5 font-semibold ${
                        active ? "text-red-700" : "text-tinta"
                      }`}
                    >
                      {a.vehicles?.label ?? "—"}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="font-medium text-tinta">
                        {TYPE_LABEL[a.type] ?? a.type}
                      </span>
                      {a.message && (
                        <span className="block text-xs text-niebla">
                          {a.message}
                        </span>
                      )}
                    </td>
                    <td
                      className="px-5 py-3.5 text-tinta/80"
                      title={new Date(a.created_at).toLocaleString("es-CO")}
                    >
                      {formatRelative(a.created_at, nowMs)}
                    </td>
                    <td className="px-5 py-3.5">
                      {active ? (
                        <span className="inline-block rounded-full bg-red-100 px-2.5 py-1 text-[11px] font-bold text-red-700">
                          Activa
                        </span>
                      ) : (
                        <span
                          className="inline-block rounded-full bg-salvia-soft px-2.5 py-1 text-[11px] font-bold text-salvia"
                          title={
                            a.resolved_at
                              ? new Date(a.resolved_at).toLocaleString("es-CO")
                              : undefined
                          }
                        >
                          Resuelta
                        </span>
                      )}
                    </td>
                    {role === "operator" && (
                      <td className="px-5 py-3.5">
                        {active && (
                          <button
                            onClick={() => resolveAlert(a.id)}
                            disabled={resolvingId === a.id}
                            className="inline-flex items-center gap-1.5 rounded-anden bg-piedra px-3 py-1.5 text-xs font-semibold text-tinta transition hover:bg-salvia-soft hover:text-salvia disabled:opacity-60"
                          >
                            {resolvingId === a.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Check size={14} />
                            )}
                            Marcar resuelta
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
