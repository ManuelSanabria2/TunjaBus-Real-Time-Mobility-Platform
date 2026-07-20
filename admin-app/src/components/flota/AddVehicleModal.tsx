"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import Modal from "@/components/Modal";

interface RouteOption {
  id: string;
  short_name: string;
}

interface OperatorOption {
  id: string;
  name: string;
}

/**
 * Alta de vehículo (solo operadores):
 *   1. INSERT en vehicles — el RLS `vehicles_insert_own_operator` (migración
 *      003) garantiza que solo puede crearse dentro de su cooperativa.
 *   2. RPC provision_vehicle_token(id) — genera 32 bytes CSPRNG en el
 *      servidor, guarda SOLO el hash SHA-256 y devuelve el token plano una
 *      única vez. Nada de criptografía en el cliente.
 */
export default function AddVehicleModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (vehicleId: string, label: string, token: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);

  const [operators, setOperators] = useState<OperatorOption[]>([]);
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [operatorId, setOperatorId] = useState("");
  const [routeId, setRouteId] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El RLS de `operators` ya limita el listado a las cooperativas del usuario.
  useEffect(() => {
    Promise.resolve().then(async () => {
      const { data } = await supabase.from("operators").select("id, name").order("name");
      const list = (data ?? []) as OperatorOption[];
      setOperators(list);
      if (list.length > 0) setOperatorId((prev) => prev || list[0].id);
    });
  }, [supabase]);

  // Rutas de la cooperativa seleccionada.
  useEffect(() => {
    if (!operatorId) return;
    Promise.resolve().then(async () => {
      const { data } = await supabase
        .from("routes")
        .select("id, short_name")
        .eq("operator_id", operatorId)
        .order("short_name");
      setRoutes((data ?? []) as RouteOption[]);
    });
  }, [operatorId, supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) {
      setError("El nombre del vehículo es obligatorio.");
      return;
    }
    if (!operatorId) {
      setError("Tu cuenta no tiene una cooperativa asignada.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const { data: vehicle, error: insertError } = await supabase
        .from("vehicles")
        .insert({ label: trimmed, operator_id: operatorId, route_id: routeId || null })
        .select("id, label")
        .single();
      if (insertError) throw insertError;

      const { data: token, error: tokenError } = await supabase.rpc(
        "provision_vehicle_token",
        { p_vehicle_id: vehicle.id }
      );
      if (tokenError) throw tokenError;

      onCreated(vehicle.id as string, vehicle.label as string, token as string);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      setError(
        code === "23505"
          ? "Ya existe un vehículo con ese nombre en tu cooperativa."
          : "No se pudo crear el vehículo. Verifica que las migraciones estén aplicadas."
      );
      console.error("Alta de vehículo:", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Agregar vehículo" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-semibold text-tinta">
            Nombre / label
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={saving}
            placeholder="Ej: BUS-014"
            autoFocus
            className="w-full rounded-anden border border-niebla/30 bg-piedra/40 px-3 py-2.5 text-sm text-tinta outline-none transition focus:border-terracota focus:bg-white"
          />
        </div>

        {operators.length > 1 && (
          <div>
            <label className="mb-1 block text-sm font-semibold text-tinta">
              Cooperativa
            </label>
            <select
              value={operatorId}
              onChange={(e) => setOperatorId(e.target.value)}
              disabled={saving}
              className="w-full rounded-anden border border-niebla/30 bg-piedra/40 px-3 py-2.5 text-sm text-tinta outline-none focus:border-terracota"
            >
              {operators.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-semibold text-tinta">
            Ruta asignada
          </label>
          <select
            value={routeId}
            onChange={(e) => setRouteId(e.target.value)}
            disabled={saving}
            className="w-full rounded-anden border border-niebla/30 bg-piedra/40 px-3 py-2.5 text-sm text-tinta outline-none focus:border-terracota"
          >
            <option value="">Sin ruta (asignar después)</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>{r.short_name}</option>
            ))}
          </select>
        </div>

        {error && (
          <p className="rounded-anden bg-red-100 px-4 py-2.5 text-sm font-medium text-red-700">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-anden px-4 py-2.5 text-sm font-semibold text-niebla transition hover:text-tinta"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-anden bg-terracota px-5 py-2.5 text-sm font-bold text-piedra shadow-anden-sm transition hover:brightness-110 disabled:opacity-60"
          >
            {saving && <Loader2 size={16} className="animate-spin" />}
            Crear y generar token
          </button>
        </div>
      </form>
    </Modal>
  );
}
