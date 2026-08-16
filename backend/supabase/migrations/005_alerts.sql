-- ============================================================================
-- Migration 005 — Sistema de alertas (signal_lost)
--
-- Tabla `alerts` + RLS. Las alertas las CREA únicamente la Edge Function
-- check-signal-lost (service_role, corre cada 2 min vía Supabase Cron); los
-- operadores las leen y las marcan como resueltas; la Secretaría solo las lee.
--
-- Dedupe por diseño: un índice único parcial impide dos alertas signal_lost
-- SIN RESOLVER para el mismo vehículo — la función puede correr cada 2 min
-- sin duplicar.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS alerts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  type        TEXT NOT NULL DEFAULT 'signal_lost',
  message     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Una sola alerta activa por (vehículo, tipo). resolved_at IS NULL = activa.
CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_active_unique
  ON alerts (vehicle_id, type)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_alerts_created
  ON alerts (created_at DESC);

-- Realtime para el badge del panel.
ALTER PUBLICATION supabase_realtime ADD TABLE alerts;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

-- Leer: miembros de la cooperativa dueña del vehículo, o la Secretaría (todo).
CREATE POLICY "alerts_select_own_or_authority" ON alerts
  FOR SELECT TO authenticated
  USING (
    is_authority()
    OR vehicle_id IN (
      SELECT id FROM vehicles
      WHERE operator_id IN (SELECT member_operator_ids())
    )
  );

-- Resolver (UPDATE): solo la cooperativa dueña. La Secretaría es read-only.
CREATE POLICY "alerts_resolve_own_operator" ON alerts
  FOR UPDATE TO authenticated
  USING (
    vehicle_id IN (
      SELECT id FROM vehicles
      WHERE operator_id IN (SELECT member_operator_ids())
    )
  )
  WITH CHECK (
    vehicle_id IN (
      SELECT id FROM vehicles
      WHERE operator_id IN (SELECT member_operator_ids())
    )
  );

-- Sin policies de INSERT/DELETE: solo la Edge Function (service_role) crea;
-- nadie borra desde el cliente.

-- Registro en el control de migraciones (requiere 000_schema_migrations.sql).
INSERT INTO schema_migrations (version, note)
VALUES ('005', 'Alertas de senal perdida')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ---------------------------------------------------------------------------
-- POST-MIGRACIÓN (manual, ver también migrations/README.md):
--
-- A) Desplegar la Edge Function (desde la raíz del repo, con Supabase CLI):
--      supabase functions deploy check-signal-lost --project-ref <PROJECT_REF>
--
-- B) Programarla cada 2 minutos con Supabase Cron (requiere extensiones
--    pg_cron y pg_net habilitadas en Dashboard → Database → Extensions).
--    La función se invoca con la ANON key (pública) como Bearer; los permisos
--    reales los da el SERVICE_ROLE_KEY que Supabase inyecta dentro de la
--    función como variable de entorno.
--
--      SELECT cron.schedule(
--        'check-signal-lost-every-2min',
--        '*/2 * * * *',
--        $$
--        SELECT net.http_post(
--          url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/check-signal-lost',
--          headers := jsonb_build_object(
--            'Authorization', 'Bearer <ANON_KEY>',
--            'Content-Type',  'application/json'
--          ),
--          body    := '{}'::jsonb
--        );
--        $$
--      );
--
-- C) (Opcional, requisito 3) Email vía Resend al generarse alertas:
--      supabase secrets set RESEND_API_KEY=re_xxx ALERTS_FROM_EMAIL=alertas@tudominio.co
--    Sin estos secrets la función omite el envío de correos (no falla).
--
-- SMOKE TEST:
--   * Invocación manual:
--       curl -X POST https://<REF>.supabase.co/functions/v1/check-signal-lost \
--            -H "Authorization: Bearer <ANON_KEY>"
--     -> {"created":N,"autoResolved":M,"emailed":K}
--   * Con un vehículo provisionado que lleve >10 min sin reportar:
--       SELECT * FROM alerts WHERE resolved_at IS NULL;  -> 1 fila signal_lost
--   * Segunda invocación inmediata -> created:0 (dedupe por índice parcial).
--   * Como operador en SQL: UPDATE alerts SET resolved_at=now() WHERE id=...
--     -> permitido solo si el vehículo es de su cooperativa.
-- ---------------------------------------------------------------------------
