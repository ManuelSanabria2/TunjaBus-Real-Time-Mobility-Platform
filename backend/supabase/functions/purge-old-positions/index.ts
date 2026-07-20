// Edge Function: purge-old-positions
//
// Corre a diario (Supabase Cron → net.http_post, ver migración 007).
// Delegación total en la función SQL aggregate_and_purge_positions():
//   1. Agrega los días locales completos aún no resumidos a daily_stats
//      (km recorridos, minutos activos, % uptime, velocidad promedio).
//   2. Borra posiciones más viejas que RETENTION_DAYS (default 60) — solo
//      de días ya agregados, así nunca se pierde histórico sin resumir.
//
// La lógica vive en SQL (migración 007) y no aquí a propósito: corre dentro
// de una transacción de Postgres y no mueve datos por la red.
//
// Deploy:   supabase functions deploy purge-old-positions --project-ref <REF>
// Invocar:  POST /functions/v1/purge-old-positions  (Bearer: anon key)
// Config:   RETENTION_DAYS opcional (default "60") vía supabase secrets.

import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (_req) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const retentionDays = Number(Deno.env.get("RETENTION_DAYS") ?? "60");
    if (!Number.isInteger(retentionDays) || retentionDays < 1) {
      throw new Error(`RETENTION_DAYS inválido: ${Deno.env.get("RETENTION_DAYS")}`);
    }

    const { data, error } = await supabase.rpc("aggregate_and_purge_positions", {
      p_retention_days: retentionDays,
    });
    if (error) throw error;

    const result = Array.isArray(data) ? data[0] : data;

    return new Response(
      JSON.stringify({
        retention_days: retentionDays,
        days_aggregated: result?.days_aggregated ?? 0,
        rows_deleted: result?.rows_deleted ?? 0,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("purge-old-positions failed:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
