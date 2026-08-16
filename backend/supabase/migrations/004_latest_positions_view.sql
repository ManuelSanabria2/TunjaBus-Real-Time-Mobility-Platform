-- ============================================================================
-- Migration 004 — Vista latest_vehicle_positions (para admin-app / Flota)
--
-- PostgREST no puede expresar "la última posición por vehículo" (DISTINCT ON)
-- y traer el historial completo al cliente sería inviable (hasta 86k filas por
-- vehículo/día con el rate limit de 1/s). Esta vista lo resuelve server-side
-- usando el índice idx_vehicle_positions_vehicle_ts de la migración 001.
--
-- security_invoker = true: la vista se evalúa con los permisos del que
-- consulta, así que aplica el RLS de vehicle_positions (lectura pública) en
-- lugar de los permisos del dueño de la vista.
-- ============================================================================

BEGIN;

CREATE OR REPLACE VIEW latest_vehicle_positions
WITH (security_invoker = true) AS
SELECT DISTINCT ON (vehicle_id)
  vehicle_id,
  latitude,
  longitude,
  speed_kmh,
  heading,
  timestamp
FROM vehicle_positions
ORDER BY vehicle_id, timestamp DESC;

GRANT SELECT ON latest_vehicle_positions TO anon, authenticated;

-- Registro en el control de migraciones (requiere 000_schema_migrations.sql).
INSERT INTO schema_migrations (version, note)
VALUES ('004', 'Vista latest_vehicle_positions')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ---------------------------------------------------------------------------
-- SMOKE TEST:
--   SELECT * FROM latest_vehicle_positions;
--     -> a lo sumo una fila por vehicle_id, la más reciente.
--   EXPLAIN SELECT * FROM latest_vehicle_positions;
--     -> debe usar idx_vehicle_positions_vehicle_ts (no Seq Scan) con datos.
-- ---------------------------------------------------------------------------
