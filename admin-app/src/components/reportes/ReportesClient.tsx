"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Download, FileText, Loader2, Play } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Role } from "@/lib/auth";
import type { ActivityRow, CoverageRow } from "@/lib/reports";
import {
  downloadCsv,
  downloadPdf,
  formatMinutes,
  formatTimestamp,
  isoDaysAgo,
} from "@/lib/reports";

type Tab = "actividad" | "cobertura";

const MAX_RANGE_DAYS = 31;

// Agregado ponderado: sum(activos)/sum(esperados), no promedio de porcentajes
// (un bus con ventana de 2h no debe pesar igual que uno de 16h).
interface AggRow {
  key: string;
  buses: number;
  expected: number;
  active: number;
  pct: number;
}

function aggregate(rows: ActivityRow[], keyOf: (r: ActivityRow) => string): AggRow[] {
  const groups = new Map<string, { buses: Set<string>; expected: number; active: number }>();
  for (const r of rows) {
    const key = keyOf(r);
    const g = groups.get(key) ?? { buses: new Set<string>(), expected: 0, active: 0 };
    g.buses.add(r.vehicle_id);
    g.expected += r.expected_minutes;
    g.active += r.active_minutes;
    groups.set(key, g);
  }
  return Array.from(groups.entries())
    .map(([key, g]) => ({
      key,
      buses: g.buses.size,
      expected: g.expected,
      active: g.active,
      pct: g.expected > 0 ? Math.min(100, Math.round((1000 * g.active) / g.expected) / 10) : 0,
    }))
    .sort((a, b) => b.pct - a.pct);
}

export default function ReportesClient({ role }: { role: Role }) {
  const supabase = useMemo(() => createClient(), []);

  const [tab, setTab] = useState<Tab>("actividad");
  const [from, setFrom] = useState(() => isoDaysAgo(6));
  const [to, setTo] = useState(() => isoDaysAgo(0));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activityRows, setActivityRows] = useState<ActivityRow[] | null>(null);
  const [coverageRows, setCoverageRows] = useState<CoverageRow[] | null>(null);

  // Cache de las cooperativas del operador (para filtrar su alcance).
  const opIdsRef = useRef<string[] | null>(null);

  const getOperatorIds = useCallback(async (): Promise<string[]> => {
    if (opIdsRef.current) return opIdsRef.current;
    const { data } = await supabase.rpc("member_operator_ids");
    const ids = (data ?? []) as string[];
    opIdsRef.current = ids;
    return ids;
  }, [supabase]);

  const generate = useCallback(async () => {
    setError(null);

    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || from > to) {
      setError("Rango de fechas inválido.");
      return;
    }
    const rangeDays = (toDate.getTime() - fromDate.getTime()) / 86_400_000 + 1;
    if (rangeDays > MAX_RANGE_DAYS) {
      setError(`El rango máximo es de ${MAX_RANGE_DAYS} días.`);
      return;
    }

    setLoading(true);
    try {
      const fn = tab === "actividad" ? "report_activity" : "report_coverage";
      const { data, error: rpcError } = await supabase.rpc(fn, {
        p_from: from,
        p_to: to,
      });
      if (rpcError) throw rpcError;

      let rows = (data ?? []) as (ActivityRow | CoverageRow)[];

      // Alcance del operador: solo sus vehículos (mismo criterio que Flota).
      if (role === "operator") {
        const ids = await getOperatorIds();
        rows = rows.filter((r) => r.operator_id !== null && ids.includes(r.operator_id));
      }

      if (tab === "actividad") setActivityRows(rows as ActivityRow[]);
      else setCoverageRows(rows as CoverageRow[]);
    } catch (e) {
      setError(
        "No se pudo generar el reporte. Verifica que la migración 006 esté aplicada en Supabase."
      );
      console.error("Reporte error:", e);
    } finally {
      setLoading(false);
    }
  }, [supabase, tab, from, to, role, getOperatorIds]);

  // ── Derivados ──────────────────────────────────────────────────────────────

  const byOperator = useMemo(
    () => (activityRows ? aggregate(activityRows, (r) => r.operator_name ?? "Sin operador") : []),
    [activityRows]
  );
  const byRoute = useMemo(
    () => (activityRows ? aggregate(activityRows, (r) => r.route_name ?? "Sin ruta") : []),
    [activityRows]
  );

  const coverageSummary = useMemo(() => {
    if (!coverageRows) return [];
    const groups = new Map<string, { label: string; route: string; total: number; visited: number }>();
    for (const r of coverageRows) {
      const g = groups.get(r.vehicle_id) ?? {
        label: r.vehicle_label,
        route: r.route_name ?? "Sin ruta",
        total: 0,
        visited: 0,
      };
      g.total++;
      if (r.visited) g.visited++;
      groups.set(r.vehicle_id, g);
    }
    return Array.from(groups.values());
  }, [coverageRows]);

  // ── Exportación ────────────────────────────────────────────────────────────

  const rangeLabel = `${from} a ${to}`;

  const exportActivityCsv = () => {
    if (!activityRows) return;
    downloadCsv(
      `actividad_${from}_${to}.csv`,
      ["Vehículo", "Ruta", "Operador", "Min esperados", "Min activos", "% actividad"],
      activityRows.map((r) => [
        r.vehicle_label,
        r.route_name,
        r.operator_name,
        r.expected_minutes,
        r.active_minutes,
        r.activity_pct,
      ])
    );
  };

  const exportActivityPdf = () => {
    if (!activityRows) return;
    const tables = [];
    if (role === "authority") {
      tables.push(
        {
          title: "Comparación por operador",
          head: ["Operador", "Buses", "Esperado", "Activo", "% actividad"],
          body: byOperator.map((g) => [
            g.key, g.buses, formatMinutes(g.expected), formatMinutes(g.active), `${g.pct}%`,
          ]),
        },
        {
          title: "Comparación por ruta",
          head: ["Ruta", "Buses", "Esperado", "Activo", "% actividad"],
          body: byRoute.map((g) => [
            g.key, g.buses, formatMinutes(g.expected), formatMinutes(g.active), `${g.pct}%`,
          ]),
        }
      );
    }
    tables.push({
      title: "Detalle por vehículo",
      head: ["Vehículo", "Ruta", "Operador", "Esperado", "Activo", "% actividad"],
      body: activityRows.map((r) => [
        r.vehicle_label,
        r.route_name ?? "—",
        r.operator_name ?? "—",
        formatMinutes(r.expected_minutes),
        formatMinutes(r.active_minutes),
        `${r.activity_pct}%`,
      ]),
    });
    downloadPdf({
      filename: `actividad_${from}_${to}.pdf`,
      title: "Andén — Reporte de actividad",
      subtitle: `Rango: ${rangeLabel} · Generado: ${new Date().toLocaleString("es-CO")}`,
      tables,
    });
  };

  const exportCoverageCsv = () => {
    if (!coverageRows) return;
    downloadCsv(
      `cobertura_${from}_${to}.csv`,
      ["Vehículo", "Ruta", "Operador", "N°", "Paradero", "Visitado", "Primera visita", "Última visita"],
      coverageRows.map((r) => [
        r.vehicle_label,
        r.route_name,
        r.operator_name,
        r.stop_sequence,
        r.stop_name,
        r.visited ? "Sí" : "No",
        r.first_visited_at,
        r.last_visited_at,
      ])
    );
  };

  const exportCoveragePdf = () => {
    if (!coverageRows) return;
    downloadPdf({
      filename: `cobertura_${from}_${to}.pdf`,
      title: "Andén — Reporte de cobertura de paraderos",
      subtitle: `Rango: ${rangeLabel} · Criterio: paso a menos de 50 m · Generado: ${new Date().toLocaleString("es-CO")}`,
      tables: [
        {
          title: "Resumen por vehículo",
          head: ["Vehículo", "Ruta", "Paraderos visitados", "Cobertura"],
          body: coverageSummary.map((g) => [
            g.label, g.route, `${g.visited} / ${g.total}`,
            g.total > 0 ? `${Math.round((100 * g.visited) / g.total)}%` : "—",
          ]),
        },
        {
          title: "Detalle por paradero",
          head: ["Vehículo", "N°", "Paradero", "Visitado", "Primera visita", "Última visita"],
          body: coverageRows.map((r) => [
            r.vehicle_label,
            r.stop_sequence,
            r.stop_name,
            r.visited ? "Sí" : "No",
            formatTimestamp(r.first_visited_at),
            formatTimestamp(r.last_visited_at),
          ]),
        },
      ],
    });
  };

  const hasResults = tab === "actividad" ? activityRows !== null : coverageRows !== null;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="mb-6">
        <h1 className="mb-1 font-serif text-3xl font-semibold text-tinta">Reportes</h1>
        <p className="text-sm text-niebla">
          {role === "authority"
            ? "Reportes institucionales con comparación entre operadores y rutas."
            : "Reportes de operación de tu cooperativa, exportables a PDF y CSV."}
        </p>
      </div>

      {/* Controles */}
      <div className="mb-6 flex flex-wrap items-end gap-4 rounded-anden-lg bg-white p-5 shadow-anden-sm">
        <div className="flex gap-2">
          {(["actividad", "cobertura"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-anden px-4 py-2 text-sm font-semibold transition ${
                tab === t ? "bg-tinta text-piedra" : "bg-piedra text-niebla hover:text-tinta"
              }`}
            >
              {t === "actividad" ? "Actividad" : "Cobertura"}
            </button>
          ))}
        </div>

        <label className="text-xs font-semibold text-niebla">
          Desde
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 block rounded-anden border border-niebla/30 bg-piedra/40 px-3 py-2 text-sm text-tinta outline-none focus:border-terracota"
          />
        </label>
        <label className="text-xs font-semibold text-niebla">
          Hasta
          <input
            type="date"
            value={to}
            min={from}
            max={isoDaysAgo(0)}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 block rounded-anden border border-niebla/30 bg-piedra/40 px-3 py-2 text-sm text-tinta outline-none focus:border-terracota"
          />
        </label>

        <button
          onClick={generate}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-anden bg-terracota px-5 py-2.5 text-sm font-bold text-piedra shadow-anden-sm transition hover:brightness-110 disabled:opacity-60"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
          Generar
        </button>

        {hasResults && (
          <div className="ml-auto flex gap-2">
            <button
              onClick={tab === "actividad" ? exportActivityCsv : exportCoverageCsv}
              className="inline-flex items-center gap-1.5 rounded-anden bg-piedra px-4 py-2.5 text-xs font-bold text-tinta transition hover:bg-salvia-soft hover:text-salvia"
            >
              <Download size={14} /> CSV
            </button>
            <button
              onClick={tab === "actividad" ? exportActivityPdf : exportCoveragePdf}
              className="inline-flex items-center gap-1.5 rounded-anden bg-piedra px-4 py-2.5 text-xs font-bold text-tinta transition hover:bg-terracota-soft hover:text-terracota"
            >
              <FileText size={14} /> PDF
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="mb-4 rounded-anden bg-red-100 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </p>
      )}

      {/* ── Actividad ── */}
      {tab === "actividad" && activityRows && (
        <div className="space-y-6">
          {role === "authority" && (
            <div className="grid gap-6 lg:grid-cols-2">
              <AggTable title="Comparación por operador" keyHeader="Operador" rows={byOperator} />
              <AggTable title="Comparación por ruta" keyHeader="Ruta" rows={byRoute} />
            </div>
          )}

          <div className="overflow-x-auto rounded-anden-lg bg-white shadow-anden-sm">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-piedra text-[11px] uppercase tracking-wider text-niebla">
                  <th className="px-5 py-3.5 font-semibold">Vehículo</th>
                  <th className="px-5 py-3.5 font-semibold">Ruta</th>
                  {role === "authority" && <th className="px-5 py-3.5 font-semibold">Operador</th>}
                  <th className="px-5 py-3.5 font-semibold">Esperado</th>
                  <th className="px-5 py-3.5 font-semibold">Activo</th>
                  <th className="px-5 py-3.5 font-semibold">% actividad</th>
                </tr>
              </thead>
              <tbody>
                {activityRows.map((r) => (
                  <tr key={r.vehicle_id} className="border-b border-piedra/70 last:border-0">
                    <td className="px-5 py-3.5 font-semibold text-tinta">{r.vehicle_label}</td>
                    <td className="px-5 py-3.5 text-niebla">{r.route_name ?? "Sin ruta"}</td>
                    {role === "authority" && (
                      <td className="px-5 py-3.5 text-niebla">{r.operator_name ?? "—"}</td>
                    )}
                    <td className="px-5 py-3.5 text-tinta/80">{formatMinutes(r.expected_minutes)}</td>
                    <td className="px-5 py-3.5 text-tinta/80">{formatMinutes(r.active_minutes)}</td>
                    <td className="px-5 py-3.5">
                      <PctBadge pct={r.activity_pct} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Cobertura ── */}
      {tab === "cobertura" && coverageRows && (
        <div className="space-y-6">
          <div className="overflow-x-auto rounded-anden-lg bg-white shadow-anden-sm">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-piedra text-[11px] uppercase tracking-wider text-niebla">
                  <th className="px-5 py-3.5 font-semibold">Vehículo</th>
                  <th className="px-5 py-3.5 font-semibold">Ruta</th>
                  <th className="px-5 py-3.5 font-semibold">Paraderos visitados</th>
                  <th className="px-5 py-3.5 font-semibold">Cobertura</th>
                </tr>
              </thead>
              <tbody>
                {coverageSummary.map((g) => (
                  <tr key={g.label} className="border-b border-piedra/70 last:border-0">
                    <td className="px-5 py-3.5 font-semibold text-tinta">{g.label}</td>
                    <td className="px-5 py-3.5 text-niebla">{g.route}</td>
                    <td className="px-5 py-3.5 text-tinta/80">{g.visited} / {g.total}</td>
                    <td className="px-5 py-3.5">
                      <PctBadge pct={g.total > 0 ? Math.round((100 * g.visited) / g.total) : 0} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto rounded-anden-lg bg-white shadow-anden-sm">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-piedra text-[11px] uppercase tracking-wider text-niebla">
                  <th className="px-5 py-3.5 font-semibold">Vehículo</th>
                  <th className="px-5 py-3.5 font-semibold">N°</th>
                  <th className="px-5 py-3.5 font-semibold">Paradero</th>
                  <th className="px-5 py-3.5 font-semibold">Visitado</th>
                  <th className="px-5 py-3.5 font-semibold">Primera visita</th>
                  <th className="px-5 py-3.5 font-semibold">Última visita</th>
                </tr>
              </thead>
              <tbody>
                {coverageRows.map((r) => (
                  <tr
                    key={`${r.vehicle_id}-${r.stop_id}`}
                    className={`border-b border-piedra/70 last:border-0 ${
                      r.visited ? "" : "bg-red-50/50"
                    }`}
                  >
                    <td className="px-5 py-3.5 font-semibold text-tinta">{r.vehicle_label}</td>
                    <td className="px-5 py-3.5 text-niebla">{r.stop_sequence}</td>
                    <td className="px-5 py-3.5 text-tinta/80">{r.stop_name}</td>
                    <td className="px-5 py-3.5">
                      {r.visited ? (
                        <span className="inline-block rounded-full bg-salvia-soft px-2.5 py-1 text-[11px] font-bold text-salvia">Sí</span>
                      ) : (
                        <span className="inline-block rounded-full bg-red-100 px-2.5 py-1 text-[11px] font-bold text-red-700">No</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-tinta/80">{formatTimestamp(r.first_visited_at)}</td>
                    <td className="px-5 py-3.5 text-tinta/80">{formatTimestamp(r.last_visited_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!hasResults && !loading && !error && (
        <div className="rounded-anden-lg border border-dashed border-niebla/40 bg-white/60 p-12 text-center text-sm text-niebla">
          Elige el tipo de reporte y el rango de fechas, luego pulsa <b>Generar</b>.
        </div>
      )}
    </div>
  );
}

function PctBadge({ pct }: { pct: number }) {
  const cls =
    pct >= 80
      ? "bg-salvia-soft text-salvia"
      : pct >= 50
        ? "bg-terracota-soft text-terracota"
        : "bg-red-100 text-red-700";
  return (
    <span className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-bold ${cls}`}>
      {pct}%
    </span>
  );
}

function AggTable({
  title,
  keyHeader,
  rows,
}: {
  title: string;
  keyHeader: string;
  rows: AggRow[];
}) {
  return (
    <div className="overflow-x-auto rounded-anden-lg bg-white shadow-anden-sm">
      <p className="px-5 pt-4 text-sm font-bold text-tinta">{title}</p>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-piedra text-[11px] uppercase tracking-wider text-niebla">
            <th className="px-5 py-3 font-semibold">{keyHeader}</th>
            <th className="px-5 py-3 font-semibold">Buses</th>
            <th className="px-5 py-3 font-semibold">Activo / Esperado</th>
            <th className="px-5 py-3 font-semibold">%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.key} className="border-b border-piedra/70 last:border-0">
              <td className="px-5 py-3 font-semibold text-tinta">{g.key}</td>
              <td className="px-5 py-3 text-niebla">{g.buses}</td>
              <td className="px-5 py-3 text-tinta/80">
                {formatMinutes(g.active)} / {formatMinutes(g.expected)}
              </td>
              <td className="px-5 py-3"><PctBadge pct={g.pct} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
