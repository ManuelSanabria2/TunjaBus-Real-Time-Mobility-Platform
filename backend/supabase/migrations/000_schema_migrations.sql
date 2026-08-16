-- ============================================================================
-- Migration 000 — Registro de migraciones aplicadas (schema_migrations)
--
-- Problema que resuelve: hasta ahora la única forma de saber qué migraciones
-- tenía una base era acordarse (o inferirlo consultando el catálogo). Con
-- varias bases en juego (producción, staging, la de un comprador) eso es una
-- fuente garantizada de aplicar dos veces o saltarse una.
--
-- Esta tabla es el registro: cada migración escribe su fila DENTRO de su misma
-- transacción, así que "migración aplicada" y "migración registrada" no pueden
-- separarse — si la migración falla, su fila tampoco queda.
--
-- Ejecuta este archivo PRIMERO, antes de 001. En una instalación limpia con
-- `schema.sql` no hace falta: ese archivo ya crea la tabla y la deja marcada.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,               -- '001', '002', ...
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note       TEXT
);

COMMENT ON TABLE schema_migrations IS
  'Migraciones de backend/supabase/migrations/ ya aplicadas a esta base.';

-- Metadatos de operación: no es dato público. RLS activo y SIN policies =
-- anon y authenticated no ven nada; service_role (y el SQL editor) sí, porque
-- bypasean RLS.
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON schema_migrations FROM anon, authenticated;

INSERT INTO schema_migrations (version, note)
VALUES ('000', 'Registro de migraciones aplicadas')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ---------------------------------------------------------------------------
-- ¿BASE QUE YA VENÍA MIGRADA A MANO?
-- Si esta base ya tenía aplicadas migraciones antes de existir este registro,
-- márcalas aquí (y solo esas) para no volver a ejecutarlas:
--
--   INSERT INTO schema_migrations (version, note) VALUES
--     ('001', 'aplicada antes del registro'),
--     ('002', 'aplicada antes del registro')
--   ON CONFLICT (version) DO NOTHING;
--
-- Para comprobar qué hay realmente en la base antes de marcar nada:
--   001 -> SELECT to_regprocedure('insert_vehicle_position(text,float8,float8,float8,float8,timestamptz)');
--   002 -> SELECT to_regclass('vehicle_rate_limit');
--   003 -> SELECT to_regclass('operators');
--   004 -> SELECT to_regclass('latest_vehicle_positions');
--   005 -> SELECT to_regclass('alerts');
--   006 -> SELECT to_regprocedure('report_activity(uuid,date,date)');
--   007 -> SELECT to_regclass('daily_stats');
--   008 -> columna captured_at en la firma de insert_vehicle_position (ver 001).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- SMOKE TEST:
--   SELECT * FROM schema_migrations ORDER BY version;
--     -> tras aplicar 000-008 debe listar las 9 versiones.
-- ---------------------------------------------------------------------------
