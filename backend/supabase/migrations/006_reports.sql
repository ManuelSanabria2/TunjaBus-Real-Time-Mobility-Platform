-- ============================================================================
-- Migration 006 — Módulo de reportes (admin-app / Reportes)
--
--   * routes.operating_start / operating_end: horario operativo configurable
--     por ruta (default 05:00–21:00). Lo usa el reporte de actividad.
--   * report_activity(desde, hasta): % de tiempo activo por vehículo — minutos
--     con al menos una señal dentro del horario operativo vs. minutos
--     esperados del rango.
--   * report_coverage(desde, hasta): por vehículo, qué paraderos de su ruta
--     visitó (pasó a <50 m) y cuándo (primera/última vez).
--
-- Ambas funciones son SECURITY INVOKER: corren con los permisos del usuario
-- del panel. Los datos base (positions/vehicles/routes/stops) son de lectura
-- pública, y el nombre del operador se resuelve vía LEFT JOIN a `operators`,
-- cuyo RLS ya limita por rol (un operador solo ve el suyo; authority todos).
-- El alcance por operador se filtra además en el cliente, como en Flota.
--
-- Zona horaria: los horarios operativos son hora local de Tunja
-- ('America/Bogota', sin DST); las funciones convierten explícitamente.
-- ============================================================================

BEGIN;

-- 1. Horario operativo por ruta.
ALTER TABLE routes
  ADD COLUMN IF NOT EXISTS operating_start TIME NOT NULL DEFAULT '05:00',
  ADD COLUMN IF NOT EXISTS operating_end   TIME NOT NULL DEFAULT '21:00';

-- 2. Índice por tiempo puro: report_activity filtra por rango de fechas sin
--    fijar vehículo, cosa que el índice (vehicle_id, timestamp) no cubre bien.
CREATE INDEX IF NOT EXISTS idx_vehicle_positions_ts
  ON vehicle_positions (timestamp DESC);

-- ---------------------------------------------------------------------------
-- 3. Reporte de actividad.
-- "Minuto activo" = minuto (hora local) con >=1 posición dentro del horario
-- operativo de la ruta del vehículo. Esperado = días del rango × ventana
-- operativa. Con el rate limit de 1/s un minuto solo puede contarse una vez.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION report_activity(p_from DATE, p_to DATE)
RETURNS TABLE (
  vehicle_id       UUID,
  vehicle_label    TEXT,
  route_id         UUID,
  route_name       TEXT,
  operator_id      UUID,
  operator_name    TEXT,
  expected_minutes BIGINT,
  active_minutes   BIGINT,
  activity_pct     NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH veh AS (
    SELECT v.id, v.label, v.operator_id,
           r.id AS route_id, r.short_name AS route_name,
           COALESCE(r.operating_start, '05:00'::time) AS op_start,
           COALESCE(r.operating_end,   '21:00'::time) AS op_end
    FROM vehicles v
    LEFT JOIN routes r ON r.id = v.route_id
  ),
  bounds AS (
    -- Medianoche local convertida a timestamptz => el filtro de rango es
    -- sargable (usa idx_vehicle_positions_ts).
    SELECT (p_from::timestamp AT TIME ZONE 'America/Bogota')     AS ts_from,
           ((p_to + 1)::timestamp AT TIME ZONE 'America/Bogota') AS ts_to
  ),
  act AS (
    SELECT vp.vehicle_id AS vid,
           COUNT(DISTINCT date_trunc('minute', vp.timestamp AT TIME ZONE 'America/Bogota')) AS active_minutes
    FROM vehicle_positions vp
    JOIN veh    ON veh.id = vp.vehicle_id
    JOIN bounds b ON true
    WHERE vp.timestamp >= b.ts_from
      AND vp.timestamp <  b.ts_to
      AND (vp.timestamp AT TIME ZONE 'America/Bogota')::time >= veh.op_start
      AND (vp.timestamp AT TIME ZONE 'America/Bogota')::time <  veh.op_end
    GROUP BY vp.vehicle_id
  ),
  base AS (
    SELECT veh.*,
           GREATEST(
             0,
             ((p_to - p_from + 1) * (EXTRACT(EPOCH FROM (veh.op_end - veh.op_start)) / 60))
           )::bigint AS expected_minutes,
           COALESCE(act.active_minutes, 0)::bigint AS active_minutes
    FROM veh
    LEFT JOIN act ON act.vid = veh.id
  )
  SELECT b.id, b.label, b.route_id, b.route_name,
         b.operator_id, o.name,
         b.expected_minutes, b.active_minutes,
         COALESCE(
           ROUND(LEAST(100.0, 100.0 * b.active_minutes / NULLIF(b.expected_minutes, 0)), 1),
           0
         )
  FROM base b
  LEFT JOIN operators o ON o.id = b.operator_id
  ORDER BY b.label;
$$;

-- ---------------------------------------------------------------------------
-- 4. Reporte de cobertura de paraderos.
-- "Visitado" = alguna posición del vehículo en el rango quedó a <50 m del
-- paradero (haversine). El prefiltro por caja de ~±0.0006° (~65 m) evita
-- calcular la distancia contra todas las posiciones.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION report_coverage(p_from DATE, p_to DATE)
RETURNS TABLE (
  vehicle_id       UUID,
  vehicle_label    TEXT,
  route_id         UUID,
  route_name       TEXT,
  operator_id      UUID,
  operator_name    TEXT,
  stop_id          UUID,
  stop_name        TEXT,
  stop_sequence    INT,
  visited          BOOLEAN,
  first_visited_at TIMESTAMPTZ,
  last_visited_at  TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT v.id, v.label,
         r.id, r.short_name,
         v.operator_id, o.name,
         s.id, s.stop_name, s.stop_sequence,
         (vis.first_ts IS NOT NULL),
         vis.first_ts,
         vis.last_ts
  FROM vehicles v
  JOIN routes r ON r.id = v.route_id
  JOIN stops  s ON s.route_id = r.id
  LEFT JOIN operators o ON o.id = v.operator_id
  LEFT JOIN LATERAL (
    SELECT MIN(vp.timestamp) AS first_ts, MAX(vp.timestamp) AS last_ts
    FROM vehicle_positions vp
    WHERE vp.vehicle_id = v.id
      AND vp.timestamp >= (p_from::timestamp AT TIME ZONE 'America/Bogota')
      AND vp.timestamp <  ((p_to + 1)::timestamp AT TIME ZONE 'America/Bogota')
      AND vp.latitude  BETWEEN s.stop_lat - 0.0006 AND s.stop_lat + 0.0006
      AND vp.longitude BETWEEN s.stop_lon - 0.0006 AND s.stop_lon + 0.0006
      AND (
        6371000 * acos(
          LEAST(1.0,
            cos(radians(s.stop_lat)) * cos(radians(vp.latitude))
              * cos(radians(vp.longitude) - radians(s.stop_lon))
            + sin(radians(s.stop_lat)) * sin(radians(vp.latitude))
          )
        )
      ) <= 50
  ) vis ON true
  ORDER BY v.label, s.stop_sequence;
$$;

-- Solo usuarios del panel (no anon): los reportes no son parte de la app
-- pública de pasajeros.
REVOKE ALL ON FUNCTION report_activity(DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION report_coverage(DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION report_activity(DATE, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION report_coverage(DATE, DATE) TO authenticated, service_role;

-- Registro en el control de migraciones (requiere 000_schema_migrations.sql).
INSERT INTO schema_migrations (version, note)
VALUES ('006', 'Reportes: horario operativo + RPCs report_activity/report_coverage')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ---------------------------------------------------------------------------
-- SMOKE TEST:
--   SELECT * FROM report_activity(CURRENT_DATE - 7, CURRENT_DATE);
--     -> una fila por vehículo; activity_pct entre 0 y 100.
--   SELECT * FROM report_coverage(CURRENT_DATE - 7, CURRENT_DATE);
--     -> una fila por (vehículo, paradero de su ruta); visited=true solo si
--        pasó a <50 m, con first/last_visited_at poblados.
--   Ajustar horario de una ruta:
--     UPDATE routes SET operating_start='06:00', operating_end='20:00' WHERE id=...;
-- ---------------------------------------------------------------------------
