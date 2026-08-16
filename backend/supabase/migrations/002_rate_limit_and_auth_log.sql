-- ============================================================================
-- Migration 002 — Abuse protection for insert_vehicle_position()
--
--   1. Rate limit: at most one successful insert per vehicle_id per second.
--      (1s, not the originally proposed 5s: the driver app emits >1 ping/s in
--      motion — a 5s window would silently discard most legitimate updates.
--      1s still caps abuse at 86,400 inserts/day/vehicle.)
--   2. Over-limit calls are dropped SILENTLY (indistinguishable from success).
--   3. Failed authentication attempts are recorded in auth_failures.
--
-- IMPORTANT DESIGN NOTE — why the function now RETURNS TEXT instead of RAISEing:
--   PostgREST runs each RPC call in one transaction. If the function RAISEs,
--   that transaction rolls back — and the auth_failures INSERT rolls back with
--   it, so the log would never persist. Postgres has no autonomous
--   transactions, so the only way to both log a failure and report it is to
--   return normally with a status value. This changes the client contract:
--   the Flutter app now checks the returned string instead of catching an
--   exception.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Rate-limit state: one row per vehicle, holding its last accepted insert.
--    Not readable/writable by clients (RLS on, zero policies); only the
--    SECURITY DEFINER function (which bypasses RLS as owner) touches it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_rate_limit (
  vehicle_id     UUID PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
  last_insert_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE vehicle_rate_limit ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. Auth failure log. Security telemetry: RLS on with NO policies, so anon and
--    authenticated can neither read nor write it. service_role (and the table
--    owner) bypass RLS, so admins can query it.
--
--    The attempted token is deliberately NOT stored — logging a secret to
--    diagnose secret handling would defeat the purpose.
--
--    vehicle_id is NULL for 'invalid_token': when the digest matches no row
--    there is, by construction, no vehicle to attribute the attempt to. It is
--    only populated for failures that happen AFTER a token authenticates
--    (e.g. 'out_of_range').
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_failures (
  id          BIGSERIAL PRIMARY KEY,
  vehicle_id  UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  reason      TEXT NOT NULL,
  client_ip   TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_failures_occurred_at
  ON auth_failures (occurred_at DESC);

ALTER TABLE auth_failures ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. Rebuild the RPC.
--    The return type changes (VOID -> TEXT), and Postgres cannot CREATE OR
--    REPLACE across a return-type change, so the old one must be dropped.
--    Dropping also drops its grants; they are re-issued below.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS insert_vehicle_position(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION);

-- Returns: 'ok'            -> inserted, OR silently dropped by the rate limit
--          'invalid_token' -> token did not authenticate (logged)
--          'out_of_range'  -> authenticated but coordinates rejected (logged)
CREATE FUNCTION insert_vehicle_position(
  token   TEXT,
  lat     DOUBLE PRECISION,
  lon     DOUBLE PRECISION,
  speed   DOUBLE PRECISION,
  heading DOUBLE PRECISION
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash    TEXT;
  v_id      UUID;
  v_allowed UUID;
  v_ip      TEXT;
BEGIN
  -- Best-effort caller IP for triage. NULL when not called through PostgREST.
  BEGIN
    v_ip := nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for';
  EXCEPTION WHEN OTHERS THEN
    v_ip := NULL;
  END;

  IF token IS NULL OR length(token) = 0 THEN
    INSERT INTO auth_failures (vehicle_id, reason, client_ip)
    VALUES (NULL, 'empty_token', v_ip);
    RETURN 'invalid_token';
  END IF;

  -- One deterministic hash, then an O(log n) probe on the unique index.
  v_hash := encode(digest(token, 'sha256'), 'hex');
  SELECT id INTO v_id FROM vehicles WHERE token_hash = v_hash;

  IF v_id IS NULL THEN
    INSERT INTO auth_failures (vehicle_id, reason, client_ip)
    VALUES (NULL, 'invalid_token', v_ip);
    RETURN 'invalid_token';
  END IF;

  IF lat < -90 OR lat > 90 OR lon < -180 OR lon > 180 THEN
    INSERT INTO auth_failures (vehicle_id, reason, client_ip)
    VALUES (v_id, 'out_of_range', v_ip);
    RETURN 'out_of_range';
  END IF;

  -- Atomic rate limit. The ON CONFLICT UPDATE only fires when 1s has elapsed,
  -- so two concurrent calls cannot both pass: the row lock serializes them and
  -- the loser's WHERE fails, returning no row. No read-then-write race.
  INSERT INTO vehicle_rate_limit AS rl (vehicle_id, last_insert_at)
  VALUES (v_id, now())
  ON CONFLICT (vehicle_id) DO UPDATE
    SET last_insert_at = now()
    WHERE rl.last_insert_at <= now() - interval '1 second'
  RETURNING rl.vehicle_id INTO v_allowed;

  IF v_allowed IS NULL THEN
    -- Over the limit: drop silently. Returning 'ok' keeps this
    -- indistinguishable from a real insert, so a caller learns nothing.
    RETURN 'ok';
  END IF;

  INSERT INTO vehicle_positions (vehicle_id, latitude, longitude, speed_kmh, heading)
  VALUES (
    v_id,
    lat,
    lon,
    GREATEST(speed, 0),
    CASE WHEN heading >= 0 AND heading <= 360 THEN heading ELSE 0 END
  );

  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION insert_vehicle_position(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION insert_vehicle_position(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO anon, authenticated;

-- Registro en el control de migraciones (requiere 000_schema_migrations.sql).
INSERT INTO schema_migrations (version, note)
VALUES ('002', 'Rate limit por vehiculo + log de auth_failures')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ---------------------------------------------------------------------------
-- 4. RETENTION (strongly recommended — enable pg_cron in the dashboard).
--    auth_failures is attacker-controlled in volume: anyone who can call the
--    RPC can make it grow. Without pruning it is a disk-exhaustion vector.
-- ---------------------------------------------------------------------------
-- SELECT cron.schedule(
--   'purge-auth-failures', '0 4 * * *',
--   $$ DELETE FROM auth_failures WHERE occurred_at < NOW() - INTERVAL '30 days' $$
-- );

-- ---------------------------------------------------------------------------
-- 5. SMOKE TEST
--   * SELECT insert_vehicle_position('wrong',5.5,-73.3,10,90);  -> 'invalid_token'
--     SELECT * FROM auth_failures ORDER BY occurred_at DESC LIMIT 1;  -> row logged, vehicle_id NULL
--   * Twice in a row with a valid token within 1s:
--       first  -> 'ok' and a new vehicle_positions row
--       second -> 'ok' and NO new row (silently rate limited)
--   * As anon: SELECT * FROM auth_failures;      -> 0 rows (RLS, no policy)
--   * As anon: SELECT * FROM vehicle_rate_limit; -> 0 rows (RLS, no policy)
-- ---------------------------------------------------------------------------
