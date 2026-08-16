-- ============================================================================
-- Migration 007 — Retención de datos: daily_stats + purga de posiciones
--
--   * daily_stats: resumen por (vehículo, día local) — km recorridos, minutos
--     activos, % uptime vs. horario operativo, velocidad promedio.
--   * aggregate_and_purge_positions(retención): agrega los días completos aún
--     no resumidos y luego borra posiciones más viejas que la retención
--     (60 días por defecto). La invoca a diario la Edge Function
--     purge-old-positions vía Supabase Cron.
--
-- GARANTÍA DE SEGURIDAD DEL BORRADO: el DELETE solo elimina posiciones cuyo
-- (vehículo, día local) YA existe en daily_stats. Si la agregación de un día
-- fallara, ese día no se borra — nunca se pierde histórico sin resumir.
--
-- Zona horaria: los "días" son días locales de Tunja (America/Bogota).
-- Política documentada en POLITICA_DATOS.md (raíz del repo).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tabla de resumen diario.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_stats (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id      UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  day             DATE NOT NULL,
  km_traveled     NUMERIC NOT NULL DEFAULT 0,
  active_minutes  INT NOT NULL DEFAULT 0,
  uptime_pct      NUMERIC NOT NULL DEFAULT 0,
  avg_speed_kmh   NUMERIC,
  positions_count INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, day)
);

CREATE INDEX IF NOT EXISTS idx_daily_stats_day ON daily_stats (day DESC);

-- RLS: mismo alcance que alerts — la cooperativa dueña lee lo suyo, la
-- Secretaría todo. Sin policies de escritura (solo escribe la función, que es
-- SECURITY DEFINER, y service_role).
ALTER TABLE daily_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_stats_select_own_or_authority" ON daily_stats
  FOR SELECT TO authenticated
  USING (
    is_authority()
    OR vehicle_id IN (
      SELECT id FROM vehicles WHERE operator_id IN (SELECT member_operator_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Agregación + purga, en una sola transacción (la de la función).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION aggregate_and_purge_positions(p_retention_days INT DEFAULT 60)
RETURNS TABLE (days_aggregated INT, rows_deleted BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_days    INT;
  v_deleted BIGINT;
BEGIN
  -- 2a. Agregar días locales COMPLETOS (anteriores a hoy) que aún no estén en
  --     daily_stats. El NOT EXISTS en el origen hace que las corridas diarias
  --     solo procesen el día de ayer; la primera corrida hace backfill.
  WITH veh AS (
    SELECT v.id AS vehicle_id,
           COALESCE(r.operating_start, '05:00'::time) AS op_start,
           COALESCE(r.operating_end,   '21:00'::time) AS op_end,
           GREATEST(0, EXTRACT(EPOCH FROM (
             COALESCE(r.operating_end, '21:00'::time) - COALESCE(r.operating_start, '05:00'::time)
           )) / 60)::numeric AS window_minutes
    FROM vehicles v
    LEFT JOIN routes r ON r.id = v.route_id
  ),
  pos AS (
    SELECT vp.vehicle_id,
           (vp.timestamp AT TIME ZONE 'America/Bogota')::date AS day,
           (vp.timestamp AT TIME ZONE 'America/Bogota')       AS local_ts,
           vp.latitude, vp.longitude, vp.speed_kmh,
           lag(vp.latitude)  OVER w AS prev_lat,
           lag(vp.longitude) OVER w AS prev_lon
    FROM vehicle_positions vp
    WHERE (vp.timestamp AT TIME ZONE 'America/Bogota')::date
            < (now() AT TIME ZONE 'America/Bogota')::date
      AND NOT EXISTS (
        SELECT 1 FROM daily_stats ds
        WHERE ds.vehicle_id = vp.vehicle_id
          AND ds.day = (vp.timestamp AT TIME ZONE 'America/Bogota')::date
      )
    WINDOW w AS (
      PARTITION BY vp.vehicle_id, (vp.timestamp AT TIME ZONE 'America/Bogota')::date
      ORDER BY vp.timestamp
    )
  ),
  agg AS (
    SELECT p.vehicle_id,
           p.day,
           -- km: suma de haversine entre puntos consecutivos del mismo día.
           COALESCE(SUM(
             CASE WHEN p.prev_lat IS NULL THEN 0
             ELSE 6371000 * acos(GREATEST(-1.0, LEAST(1.0,
                    cos(radians(p.prev_lat)) * cos(radians(p.latitude))
                      * cos(radians(p.longitude) - radians(p.prev_lon))
                    + sin(radians(p.prev_lat)) * sin(radians(p.latitude))
                  )))
             END
           ), 0) / 1000.0 AS km_traveled,
           -- minutos activos: mismo criterio que report_activity (migración 006).
           COUNT(DISTINCT date_trunc('minute', p.local_ts))
             FILTER (WHERE p.local_ts::time >= veh.op_start
                       AND p.local_ts::time <  veh.op_end) AS active_minutes,
           AVG(p.speed_kmh) AS avg_speed_kmh,
           COUNT(*) AS positions_count,
           MAX(veh.window_minutes) AS window_minutes
    FROM pos p
    JOIN veh ON veh.vehicle_id = p.vehicle_id
    GROUP BY p.vehicle_id, p.day
  )
  INSERT INTO daily_stats
    (vehicle_id, day, km_traveled, active_minutes, uptime_pct, avg_speed_kmh, positions_count)
  SELECT a.vehicle_id,
         a.day,
         ROUND(a.km_traveled::numeric, 2),
         COALESCE(a.active_minutes, 0),
         COALESCE(ROUND(LEAST(100.0, 100.0 * a.active_minutes / NULLIF(a.window_minutes, 0)), 1), 0),
         ROUND(a.avg_speed_kmh::numeric, 1),
         a.positions_count
  FROM agg a
  ON CONFLICT (vehicle_id, day) DO NOTHING;

  GET DIAGNOSTICS v_days = ROW_COUNT;

  -- 2b. Purga: solo posiciones más viejas que la retención Y cuyo día ya está
  --     resumido en daily_stats (garantía anti-pérdida).
  DELETE FROM vehicle_positions vp
  WHERE vp.timestamp < now() - make_interval(days => p_retention_days)
    AND EXISTS (
      SELECT 1 FROM daily_stats ds
      WHERE ds.vehicle_id = vp.vehicle_id
        AND ds.day = (vp.timestamp AT TIME ZONE 'America/Bogota')::date
    );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN QUERY SELECT v_days, v_deleted;
END;
$$;

-- Solo la Edge Function (service_role) puede ejecutarla.
REVOKE ALL ON FUNCTION aggregate_and_purge_positions(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aggregate_and_purge_positions(INT) TO service_role;

-- Registro en el control de migraciones (requiere 000_schema_migrations.sql).
INSERT INTO schema_migrations (version, note)
VALUES ('007', 'Retencion: daily_stats + aggregate_and_purge_positions')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ---------------------------------------------------------------------------
-- POST-MIGRACIÓN (manual, ver migrations/README.md):
--
-- A) Desplegar la Edge Function:
--      supabase functions deploy purge-old-positions --project-ref <PROJECT_REF>
--
-- B) Programarla a diario (03:30 hora de Tunja = 08:30 UTC; pg_cron corre en
--    UTC). Requiere pg_cron + pg_net:
--
--      SELECT cron.schedule(
--        'purge-old-positions-daily',
--        '30 8 * * *',
--        $$
--        SELECT net.http_post(
--          url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/purge-old-positions',
--          headers := jsonb_build_object(
--            'Authorization', 'Bearer <ANON_KEY>',
--            'Content-Type',  'application/json'
--          ),
--          body    := '{}'::jsonb
--        );
--        $$
--      );
--
-- SMOKE TEST:
--   * SELECT * FROM aggregate_and_purge_positions(60);
--       -> days_aggregated = nº de (vehículo, día) nuevos en daily_stats;
--          rows_deleted = 0 si no hay datos de hace más de 60 días.
--   * SELECT * FROM daily_stats ORDER BY day DESC;  -> km/uptime coherentes.
--   * Segunda corrida inmediata -> days_aggregated = 0 (idempotente).
--   * Verificar la garantía: un día sin fila en daily_stats nunca pierde
--     posiciones aunque supere la retención.
-- ---------------------------------------------------------------------------
