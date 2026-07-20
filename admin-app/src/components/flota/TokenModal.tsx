"use client";

import { useMemo, useState } from "react";
import QRCode from "react-qr-code";
import { AlertTriangle, Check, Copy, KeyRound, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import Modal from "@/components/Modal";

export interface TokenFlow {
  vehicleId: string;
  label: string;
  /** null => flujo de regeneración (pide confirmación antes de invalidar). */
  token: string | null;
}

export default function TokenModal({
  flow,
  onClose,
}: {
  flow: TokenFlow;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [token, setToken] = useState<string | null>(flow.token);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function regenerate() {
    setWorking(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc(
      "provision_vehicle_token",
      { p_vehicle_id: flow.vehicleId }
    );
    if (rpcError) {
      setError("No se pudo regenerar el token.");
      console.error("Regenerar token:", rpcError);
    } else {
      setToken(data as string);
    }
    setWorking(false);
  }

  async function copyToken() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("No se pudo copiar. Selecciona el texto manualmente.");
    }
  }

  // ── Fase de confirmación (solo regeneración) ──────────────────────────────
  if (token === null) {
    return (
      <Modal title={`Regenerar token — ${flow.label}`} onClose={onClose}>
        <div className="mb-5 flex gap-3 rounded-anden bg-terracota-soft p-4 text-sm text-terracota">
          <AlertTriangle size={20} className="mt-0.5 shrink-0" />
          <p>
            El token actual dejará de funcionar <b>inmediatamente</b>. El
            conductor no podrá reportar posición hasta ingresar el token nuevo
            en su app.
          </p>
        </div>
        {error && (
          <p className="mb-4 rounded-anden bg-red-100 px-4 py-2.5 text-sm font-medium text-red-700">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={working}
            className="rounded-anden px-4 py-2.5 text-sm font-semibold text-niebla transition hover:text-tinta"
          >
            Cancelar
          </button>
          <button
            onClick={regenerate}
            disabled={working}
            className="inline-flex items-center gap-2 rounded-anden bg-terracota px-5 py-2.5 text-sm font-bold text-piedra shadow-anden-sm transition hover:brightness-110 disabled:opacity-60"
          >
            {working ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
            Sí, regenerar
          </button>
        </div>
      </Modal>
    );
  }

  // ── Fase de exhibición única del token ────────────────────────────────────
  return (
    <Modal
      title={`Token de ${flow.label}`}
      onClose={onClose}
      disableOverlayClose
    >
      <div className="mb-5 flex gap-3 rounded-anden bg-terracota-soft p-4 text-sm text-terracota">
        <AlertTriangle size={20} className="mt-0.5 shrink-0" />
        <p>
          <b>Guárdalo ahora: este token se muestra una sola vez.</b> En la base
          de datos solo se almacena su hash. Si se pierde, tendrás que
          regenerarlo (el anterior queda invalidado).
        </p>
      </div>

      {/* Token + copiar */}
      <div className="mb-5">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-niebla">
          Driver Token
        </p>
        <div className="flex items-stretch gap-2">
          <code className="min-w-0 flex-1 break-all rounded-anden bg-tinta p-3 font-mono text-xs leading-relaxed text-piedra">
            {token}
          </code>
          <button
            onClick={copyToken}
            className={`shrink-0 rounded-anden px-3 transition ${
              copied
                ? "bg-salvia-soft text-salvia"
                : "bg-piedra text-tinta hover:bg-terracota-soft hover:text-terracota"
            }`}
            title="Copiar al portapapeles"
          >
            {copied ? <Check size={18} /> : <Copy size={18} />}
          </button>
        </div>
      </div>

      {/* QR para pasarlo al celular */}
      <div className="mb-5 flex flex-col items-center gap-2">
        <div className="rounded-anden bg-white p-3 shadow-anden-sm ring-1 ring-niebla/20">
          <QRCode value={token} size={150} fgColor="#1C2632" bgColor="#FFFFFF" />
        </div>
        <p className="text-xs text-niebla">
          Escanéalo con la cámara del celular del conductor para copiarlo.
        </p>
      </div>

      {/* Instrucciones para el conductor */}
      <div className="mb-6 rounded-anden bg-piedra/60 p-4">
        <p className="mb-2 text-sm font-bold text-tinta">
          Configuración de la app del conductor
        </p>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-tinta/80">
          <li>Instala el APK <b>Andén Drivers</b> en el celular a bordo.</li>
          <li>Escanea el QR (o copia el token) y pégalo en el campo <b>Driver Token</b>.</li>
          <li>Otorga permiso de ubicación <b>&ldquo;Permitir siempre&rdquo;</b>.</li>
          <li>Pulsa <b>INICIAR TURNO</b>: el estado debe cambiar a &ldquo;Conectado / Enviando&rdquo;.</li>
        </ol>
      </div>

      {error && (
        <p className="mb-4 rounded-anden bg-red-100 px-4 py-2.5 text-sm font-medium text-red-700">
          {error}
        </p>
      )}

      <button
        onClick={onClose}
        className="w-full rounded-anden bg-tinta py-3 text-sm font-bold text-piedra transition hover:bg-tinta-soft"
      >
        Entendido, ya lo guardé
      </button>
    </Modal>
  );
}
