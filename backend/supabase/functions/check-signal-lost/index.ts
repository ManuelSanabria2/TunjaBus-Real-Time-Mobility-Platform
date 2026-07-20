// Edge Function: check-signal-lost
//
// Corre cada 2 minutos (Supabase Cron → net.http_post, ver migración 005).
// Detecta vehículos "activos" (token provisionado + cooperativa activa) que
// llevan más de THRESHOLD_MINUTES sin reportar posición y crea alertas
// `signal_lost`. También auto-resuelve las alertas de vehículos que volvieron
// a reportar, y (opcional) notifica por email vía Resend si hay secrets.
//
// Deploy:   supabase functions deploy check-signal-lost --project-ref <REF>
// Invocar:  POST /functions/v1/check-signal-lost  (Bearer: anon key)
// Los escritos usan SUPABASE_SERVICE_ROLE_KEY (inyectada por Supabase en el
// runtime de la función) — el cliente nunca ve esta clave.

import { createClient } from "npm:@supabase/supabase-js@2";

const THRESHOLD_MINUTES = 10;

interface VehicleRow {
  id: string;
  label: string;
  operator_id: string | null;
  operators: {
    name: string;
    active: boolean;
    contact_email: string | null;
  } | null;
}

Deno.serve(async (_req) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const nowMs = Date.now();
    const cutoffMs = nowMs - THRESHOLD_MINUTES * 60_000;

    // 1. Vehículos activos: token provisionado y cooperativa activa.
    const { data: vehicles, error: vehiclesError } = await supabase
      .from("vehicles")
      .select("id, label, operator_id, operators(name, active, contact_email)")
      .not("token_hash", "is", null);
    if (vehiclesError) throw vehiclesError;

    const activeVehicles = ((vehicles ?? []) as unknown as VehicleRow[])
      .filter((v) => v.operators?.active !== false);

    // 2. Última posición por vehículo (vista de la migración 004).
    const { data: latest, error: latestError } = await supabase
      .from("latest_vehicle_positions")
      .select("vehicle_id, timestamp");
    if (latestError) throw latestError;

    const latestMsByVehicle = new Map<string, number>(
      (latest ?? []).map((p) => [
        p.vehicle_id as string,
        new Date(p.timestamp as string).getTime(),
      ]),
    );

    // 3. Alertas signal_lost aún sin resolver (para dedupe y auto-resolución).
    const { data: unresolved, error: unresolvedError } = await supabase
      .from("alerts")
      .select("id, vehicle_id")
      .eq("type", "signal_lost")
      .is("resolved_at", null);
    if (unresolvedError) throw unresolvedError;

    const unresolvedVehicleIds = new Set(
      (unresolved ?? []).map((a) => a.vehicle_id as string),
    );

    // 4. Nuevas alertas: reportó alguna vez, lleva >10 min callado y no tiene
    //    ya una alerta activa. (Un vehículo que NUNCA ha reportado no alerta:
    //    puede estar recién provisionado y aún sin instalar.)
    const staleVehicles = activeVehicles.filter((v) => {
      const lastMs = latestMsByVehicle.get(v.id);
      return (
        lastMs !== undefined &&
        lastMs < cutoffMs &&
        !unresolvedVehicleIds.has(v.id)
      );
    });

    if (staleVehicles.length > 0) {
      const { error: insertError } = await supabase.from("alerts").insert(
        staleVehicles.map((v) => ({
          vehicle_id: v.id,
          type: "signal_lost",
          message: `${v.label} sin señal desde ${
            new Date(latestMsByVehicle.get(v.id)!).toISOString()
          }`,
        })),
      );
      if (insertError) throw insertError;
    }

    // 5. Auto-resolución: el vehículo volvió a reportar dentro del umbral.
    const recoveredAlertIds = (unresolved ?? [])
      .filter((a) => {
        const lastMs = latestMsByVehicle.get(a.vehicle_id as string);
        return lastMs !== undefined && lastMs >= cutoffMs;
      })
      .map((a) => a.id as string);

    if (recoveredAlertIds.length > 0) {
      const { error: resolveError } = await supabase
        .from("alerts")
        .update({ resolved_at: new Date().toISOString() })
        .in("id", recoveredAlertIds);
      if (resolveError) throw resolveError;
    }

    // 6. (Opcional) Email al operador vía Resend. Sin secrets => se omite.
    let emailed = 0;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("ALERTS_FROM_EMAIL");

    if (resendKey && fromEmail && staleVehicles.length > 0) {
      const byEmail = new Map<string, VehicleRow[]>();
      for (const v of staleVehicles) {
        const email = v.operators?.contact_email;
        if (!email) continue;
        byEmail.set(email, [...(byEmail.get(email) ?? []), v]);
      }

      for (const [email, vehiclesForOp] of byEmail) {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: fromEmail,
            to: [email],
            subject: `Andén — ${vehiclesForOp.length} vehículo(s) sin señal`,
            html: `<p>Los siguientes vehículos llevan más de ${THRESHOLD_MINUTES} minutos sin reportar posición:</p>
<ul>${vehiclesForOp.map((v) => `<li><strong>${v.label}</strong></li>`).join("")}</ul>
<p>Revisa la sección <strong>Alertas</strong> del panel de administración.</p>`,
          }),
        });
        if (res.ok) {
          emailed++;
        } else {
          console.error("Resend error:", res.status, await res.text());
        }
      }
    }

    return new Response(
      JSON.stringify({
        created: staleVehicles.length,
        autoResolved: recoveredAlertIds.length,
        emailed,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("check-signal-lost failed:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
