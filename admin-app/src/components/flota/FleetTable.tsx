"use client";

import { History, KeyRound, Loader2, X } from "lucide-react";
import type { Role } from "@/lib/auth";
import type { FleetVehicle, FleetStatus } from "@/lib/fleet";
import { STATUS_LABEL, getStatus, formatRelative } from "@/lib/fleet";

const STATUS_CHIP: Record<FleetStatus, string> = {
  activo: "bg-salvia-soft text-salvia",
  "sin-senal": "bg-terracota-soft text-terracota",
  critico: "bg-red-100 text-red-700",
};

export default function FleetTable({
  vehicles,
  nowMs,
  role,
  historyVehicleId,
  historyLoadingId,
  onToggleHistory,
  onRegenerateToken,
}: {
  vehicles: FleetVehicle[];
  nowMs: number;
  role: Role;
  historyVehicleId: string | null;
  historyLoadingId: string | null;
  onToggleHistory: (vehicle: FleetVehicle) => void;
  onRegenerateToken: (vehicle: FleetVehicle) => void;
}) {
  if (vehicles.length === 0) {
    return (
      <div className="rounded-anden-lg border border-dashed border-niebla/40 bg-white/60 p-10 text-center text-sm text-niebla">
        No hay vehículos registrados para tu alcance.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-anden-lg bg-white shadow-anden-sm">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-piedra text-[11px] uppercase tracking-wider text-niebla">
            <th className="px-5 py-3.5 font-semibold">Vehículo</th>
            <th className="px-5 py-3.5 font-semibold">Ruta</th>
            <th className="px-5 py-3.5 font-semibold">Última señal</th>
            <th className="px-5 py-3.5 font-semibold">Estado</th>
            <th className="px-5 py-3.5 font-semibold">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {vehicles.map((v) => {
            const status = getStatus(v.lastTs, nowMs);
            const isCritical = status === "critico";
            const historyActive = historyVehicleId === v.id;
            const historyLoading = historyLoadingId === v.id;

            return (
              <tr
                key={v.id}
                // Requisito: >10 min sin señal resaltado en rojo en la tabla.
                className={`border-b border-piedra/70 last:border-0 ${
                  isCritical ? "bg-red-50/70" : ""
                }`}
              >
                <td
                  className={`px-5 py-3.5 font-semibold ${
                    isCritical ? "text-red-700" : "text-tinta"
                  }`}
                >
                  {v.label}
                </td>
                <td className="px-5 py-3.5 text-niebla">
                  {v.routeName ?? "Sin ruta"}
                </td>
                <td
                  className={`px-5 py-3.5 ${
                    isCritical ? "text-red-700" : "text-tinta/80"
                  }`}
                  title={v.lastTs ? new Date(v.lastTs).toLocaleString("es-CO") : undefined}
                >
                  {formatRelative(v.lastTs, nowMs)}
                </td>
                <td className="px-5 py-3.5">
                  <span
                    className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-bold ${STATUS_CHIP[status]}`}
                  >
                    {STATUS_LABEL[status]}
                  </span>
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onToggleHistory(v)}
                      disabled={historyLoading}
                      className={`inline-flex items-center gap-1.5 rounded-anden px-3 py-1.5 text-xs font-semibold transition ${
                        historyActive
                          ? "bg-tinta text-piedra"
                          : "bg-piedra text-tinta hover:bg-terracota-soft hover:text-terracota"
                      } disabled:opacity-60`}
                    >
                      {historyLoading ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : historyActive ? (
                        <X size={14} />
                      ) : (
                        <History size={14} />
                      )}
                      {historyActive ? "Ocultar historial" : "Ver historial de hoy"}
                    </button>
                    {role === "operator" && (
                      <button
                        onClick={() => onRegenerateToken(v)}
                        className="inline-flex items-center gap-1.5 rounded-anden bg-piedra px-3 py-1.5 text-xs font-semibold text-tinta transition hover:bg-terracota-soft hover:text-terracota"
                        title="Invalida el token actual y genera uno nuevo"
                      >
                        <KeyRound size={14} />
                        Regenerar token
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
