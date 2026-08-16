-- ==========================================
-- SUPABASE SCHEMA - TUNJABUS
--
-- Write model: the driver holds a 256-bit CSPRNG token on their device; the DB
-- stores ONLY its SHA-256 digest (vehicles.token_hash, UNIQUE-indexed).
-- Positions can only be written through insert_vehicle_position() — direct
-- client INSERT is blocked by RLS. No plaintext secret ever lives in the DB.
--
-- Hash choice: plain SHA-256, not bcrypt/argon2. The token is system-generated
-- with 256 bits of entropy, so security comes from entropy, not hash slowness;
-- and this runs on the hot path (one call per GPS ping per bus). SHA-256 is
-- also deterministic, which is what makes the UNIQUE-index lookup possible.
-- ==========================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 0. OPERATORS (cooperativas) + role tables.
--    "Secretaría" is an application-level role (a row in authority_users), not
--    a Postgres role: custom DB roles don't flow through Supabase JWTs, and a
--    membership table is auditable in SQL.
CREATE TABLE operators (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,
  contact_email TEXT,
  contact_phone TEXT,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Staff of a cooperative.
CREATE TABLE operator_members (
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'admin',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (operator_id, user_id)
);

-- Secretaría de Movilidad: read EVERYTHING, write nothing.
CREATE TABLE authority_users (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1. ROUTES — each route belongs to one operator. operating_start/end es el
--    horario operativo local (America/Bogota) que usa report_activity().
CREATE TABLE routes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     UUID REFERENCES operators(id) ON DELETE SET NULL,
  short_name      TEXT NOT NULL,
  long_name       TEXT NOT NULL,
  color           TEXT DEFAULT 'FF0000',
  operating_start TIME NOT NULL DEFAULT '05:00',
  operating_end   TIME NOT NULL DEFAULT '21:00',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 2. STOPS
CREATE TABLE stops (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id      UUID REFERENCES routes(id) ON DELETE CASCADE,
  stop_name     TEXT NOT NULL,
  stop_lat      DOUBLE PRECISION NOT NULL,
  stop_lon      DOUBLE PRECISION NOT NULL,
  stop_sequence INT NOT NULL
);

-- 3. VEHICLES — token_hash holds a SHA-256 hex digest; NULL = not provisioned.
--    The CHECK makes it structurally impossible to store a plaintext token.
CREATE TABLE vehicles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id    UUID REFERENCES routes(id) ON DELETE SET NULL,
  operator_id UUID REFERENCES operators(id) ON DELETE SET NULL,
  token_hash  TEXT,
  label       TEXT NOT NULL,
  CONSTRAINT vehicles_token_hash_is_sha256
    CHECK (token_hash IS NULL OR token_hash ~ '^[0-9a-f]{64}$')
);

-- O(log n) token lookup on the hot path; also prevents duplicate tokens.
CREATE UNIQUE INDEX idx_vehicles_token_hash ON vehicles (token_hash);

-- Labels only need to be unique within one cooperative.
CREATE UNIQUE INDEX idx_vehicles_operator_label ON vehicles (operator_id, label);

-- 4. REAL-TIME POSITIONS
CREATE TABLE vehicle_positions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  latitude   DOUBLE PRECISION NOT NULL,
  longitude  DOUBLE PRECISION NOT NULL,
  speed_kmh  DOUBLE PRECISION DEFAULT 0,
  heading    DOUBLE PRECISION DEFAULT 0,
  timestamp  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT vp_lat_range     CHECK (latitude  BETWEEN -90 AND 90),
  CONSTRAINT vp_lon_range     CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT vp_speed_nonneg  CHECK (speed_kmh >= 0),
  CONSTRAINT vp_heading_range CHECK (heading BETWEEN 0 AND 360)
);

CREATE INDEX idx_vehicle_positions_vehicle_ts
  ON vehicle_positions (vehicle_id, timestamp DESC);

-- Rango de fechas sin fijar vehículo (report_activity).
CREATE INDEX idx_vehicle_positions_ts ON vehicle_positions (timestamp DESC);

-- Última posición por vehículo (la usa admin-app/Flota). security_invoker:
-- se evalúa con los permisos del consultante, aplicando el RLS de la tabla.
CREATE OR REPLACE VIEW latest_vehicle_positions
WITH (security_invoker = true) AS
SELECT DISTINCT ON (vehicle_id)
  vehicle_id, latitude, longitude, speed_kmh, heading, timestamp
FROM vehicle_positions
ORDER BY vehicle_id, timestamp DESC;

GRANT SELECT ON latest_vehicle_positions TO anon, authenticated;

-- 4b. RATE-LIMIT STATE — one row per vehicle, its last accepted insert.
CREATE TABLE vehicle_rate_limit (
  vehicle_id     UUID PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
  last_insert_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4c. AUTH FAILURE LOG — security telemetry. The attempted token is never
--     stored. vehicle_id is NULL for 'invalid_token' (a digest that matches no
--     row cannot be attributed to a vehicle); it is only set for failures after
--     a token authenticates.
CREATE TABLE auth_failures (
  id          BIGSERIAL PRIMARY KEY,
  vehicle_id  UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  reason      TEXT NOT NULL,
  client_ip   TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_auth_failures_occurred_at ON auth_failures (occurred_at DESC);

-- 4d. ALERTS — las crea solo la Edge Function check-signal-lost (service_role,
--     cada 2 min). El índice único parcial impide dos alertas activas del
--     mismo tipo para el mismo vehículo.
CREATE TABLE alerts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  type        TEXT NOT NULL DEFAULT 'signal_lost',
  message     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX idx_alerts_active_unique
  ON alerts (vehicle_id, type) WHERE resolved_at IS NULL;
CREATE INDEX idx_alerts_created ON alerts (created_at DESC);

-- 4e. DAILY STATS — resumen por (vehículo, día local America/Bogota). Lo llena
--     aggregate_and_purge_positions() antes de purgar posiciones (retención
--     60 días). Ver POLITICA_DATOS.md.
CREATE TABLE daily_stats (
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

CREATE INDEX idx_daily_stats_day ON daily_stats (day DESC);

-- 5. Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE vehicle_positions;
ALTER PUBLICATION supabase_realtime ADD TABLE alerts;

-- ==========================================
-- 6. ROW LEVEL SECURITY
-- ==========================================
-- vehicle_positions: public read; NO insert policy => direct client INSERT is
-- denied. Writes happen only via the SECURITY DEFINER RPC in section 7.
ALTER TABLE vehicle_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_positions" ON vehicle_positions FOR SELECT USING (true);

ALTER TABLE routes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_routes" ON routes FOR SELECT USING (true);

ALTER TABLE stops ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_stops" ON stops FOR SELECT USING (true);

-- vehicles is public-read for the passenger map (label). token_hash is a
-- SHA-256 digest of a 256-bit random token: useless to an attacker who reads it.
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_vehicles" ON vehicles FOR SELECT USING (true);

-- Internal tables: RLS on with NO policies => anon/authenticated can neither
-- read nor write them. Only the SECURITY DEFINER function (as owner) and
-- service_role touch them.
ALTER TABLE vehicle_rate_limit ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_failures ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- 6b. ROLES + PER-OPERATOR MANAGEMENT
--     Passenger tables stay public-read; operator isolation applies to writes
--     and to the private operator/role tables.
-- ==========================================

-- Helper functions (SECURITY DEFINER => read membership tables regardless of
-- RLS, which also prevents policy recursion).
CREATE OR REPLACE FUNCTION is_authority()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM authority_users WHERE user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION member_operator_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT operator_id FROM operator_members WHERE user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION is_authority() FROM PUBLIC;
REVOKE ALL ON FUNCTION member_operator_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_authority() TO authenticated;
GRANT EXECUTE ON FUNCTION member_operator_ids() TO authenticated;

-- Private role tables.
ALTER TABLE operators        ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE authority_users  ENABLE ROW LEVEL SECURITY;  -- no policies: service_role only

CREATE POLICY "operators_select_own_or_authority" ON operators
  FOR SELECT TO authenticated
  USING (id IN (SELECT member_operator_ids()) OR is_authority());

CREATE POLICY "members_select_own_or_authority" ON operator_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_authority());

-- Per-operator management. WITH CHECK reuses the predicate, so an operator
-- cannot create rows for (or move rows to) another cooperative.
CREATE POLICY "routes_insert_own_operator" ON routes
  FOR INSERT TO authenticated
  WITH CHECK (operator_id IN (SELECT member_operator_ids()));
CREATE POLICY "routes_update_own_operator" ON routes
  FOR UPDATE TO authenticated
  USING (operator_id IN (SELECT member_operator_ids()))
  WITH CHECK (operator_id IN (SELECT member_operator_ids()));
CREATE POLICY "routes_delete_own_operator" ON routes
  FOR DELETE TO authenticated
  USING (operator_id IN (SELECT member_operator_ids()));

CREATE POLICY "stops_insert_own_operator" ON stops
  FOR INSERT TO authenticated
  WITH CHECK (route_id IN (SELECT id FROM routes WHERE operator_id IN (SELECT member_operator_ids())));
CREATE POLICY "stops_update_own_operator" ON stops
  FOR UPDATE TO authenticated
  USING (route_id IN (SELECT id FROM routes WHERE operator_id IN (SELECT member_operator_ids())))
  WITH CHECK (route_id IN (SELECT id FROM routes WHERE operator_id IN (SELECT member_operator_ids())));
CREATE POLICY "stops_delete_own_operator" ON stops
  FOR DELETE TO authenticated
  USING (route_id IN (SELECT id FROM routes WHERE operator_id IN (SELECT member_operator_ids())));

CREATE POLICY "vehicles_insert_own_operator" ON vehicles
  FOR INSERT TO authenticated
  WITH CHECK (operator_id IN (SELECT member_operator_ids()));
CREATE POLICY "vehicles_update_own_operator" ON vehicles
  FOR UPDATE TO authenticated
  USING (operator_id IN (SELECT member_operator_ids()))
  WITH CHECK (operator_id IN (SELECT member_operator_ids()));
CREATE POLICY "vehicles_delete_own_operator" ON vehicles
  FOR DELETE TO authenticated
  USING (operator_id IN (SELECT member_operator_ids()));

-- Authority: read-only security telemetry for institutional reports.
CREATE POLICY "auth_failures_select_authority" ON auth_failures
  FOR SELECT TO authenticated
  USING (is_authority());

-- Alerts: la cooperativa dueña lee y resuelve; la Secretaría solo lee.
-- Sin policies de INSERT/DELETE (solo la Edge Function con service_role crea).
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alerts_select_own_or_authority" ON alerts
  FOR SELECT TO authenticated
  USING (
    is_authority()
    OR vehicle_id IN (
      SELECT id FROM vehicles WHERE operator_id IN (SELECT member_operator_ids())
    )
  );

CREATE POLICY "alerts_resolve_own_operator" ON alerts
  FOR UPDATE TO authenticated
  USING (
    vehicle_id IN (
      SELECT id FROM vehicles WHERE operator_id IN (SELECT member_operator_ids())
    )
  )
  WITH CHECK (
    vehicle_id IN (
      SELECT id FROM vehicles WHERE operator_id IN (SELECT member_operator_ids())
    )
  );

-- daily_stats: lectura con el mismo alcance que alerts; sin escritura de
-- clientes (solo la función de retención, SECURITY DEFINER).
ALTER TABLE daily_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_stats_select_own_or_authority" ON daily_stats
  FOR SELECT TO authenticated
  USING (
    is_authority()
    OR vehicle_id IN (
      SELECT id FROM vehicles WHERE operator_id IN (SELECT member_operator_ids())
    )
  );

-- ==========================================
-- 7. WRITE PATH — hash the token once, probe the unique index, rate limit,
--    then insert.
--
--    Returns a status instead of RAISEing: PostgREST wraps each call in one
--    transaction, so a RAISE would roll back the auth_failures INSERT along
--    with it and the log would never persist.
--      'ok'                -> inserted, OR silently dropped by the rate limit
--      'invalid_token'     -> token did not authenticate (logged)
--      'out_of_range'      -> authenticated but coordinates rejected (logged)
--      'invalid_timestamp' -> captured_at fuera de rango (logged)
--
--    captured_at (opcional): hora de CAPTURA del punto — la cola offline del
--    conductor reenvía puntos tarde y deben registrarse con su hora real.
-- ==========================================
CREATE OR REPLACE FUNCTION insert_vehicle_position(
  token       TEXT,
  lat         DOUBLE PRECISION,
  lon         DOUBLE PRECISION,
  speed       DOUBLE PRECISION,
  heading     DOUBLE PRECISION,
  captured_at TIMESTAMPTZ DEFAULT NULL
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
  BEGIN
    v_ip := nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for';
  EXCEPTION WHEN OTHERS THEN
    v_ip := NULL;
  END;

  IF token IS NULL OR length(token) = 0 THEN
    INSERT INTO auth_failures (vehicle_id, reason, client_ip) VALUES (NULL, 'empty_token', v_ip);
    RETURN 'invalid_token';
  END IF;

  v_hash := encode(digest(token, 'sha256'), 'hex');
  SELECT id INTO v_id FROM vehicles WHERE token_hash = v_hash;

  IF v_id IS NULL THEN
    INSERT INTO auth_failures (vehicle_id, reason, client_ip) VALUES (NULL, 'invalid_token', v_ip);
    RETURN 'invalid_token';
  END IF;

  IF lat < -90 OR lat > 90 OR lon < -180 OR lon > 180 THEN
    INSERT INTO auth_failures (vehicle_id, reason, client_ip) VALUES (v_id, 'out_of_range', v_ip);
    RETURN 'out_of_range';
  END IF;

  -- captured_at: máx. 2 min en el futuro (deriva de reloj), 3 días al pasado.
  IF captured_at IS NOT NULL AND (
       captured_at > now() + interval '2 minutes'
    OR captured_at < now() - interval '3 days'
  ) THEN
    INSERT INTO auth_failures (vehicle_id, reason, client_ip) VALUES (v_id, 'invalid_timestamp', v_ip);
    RETURN 'invalid_timestamp';
  END IF;

  -- Atomic rate limit (1 insert/s per vehicle): the UPDATE only fires once 1s
  -- has elapsed, so two concurrent calls cannot both pass (the row lock
  -- serializes them). 1s preserves in-motion tracking (>1 ping/s) while still
  -- capping abuse at 86,400 inserts/day/vehicle.
  INSERT INTO vehicle_rate_limit AS rl (vehicle_id, last_insert_at)
  VALUES (v_id, now())
  ON CONFLICT (vehicle_id) DO UPDATE
    SET last_insert_at = now()
    WHERE rl.last_insert_at <= now() - interval '1 second'
  RETURNING rl.vehicle_id INTO v_allowed;

  IF v_allowed IS NULL THEN
    RETURN 'ok';  -- silently dropped; indistinguishable from success
  END IF;

  INSERT INTO vehicle_positions (vehicle_id, latitude, longitude, speed_kmh, heading, timestamp)
  VALUES (
    v_id, lat, lon,
    GREATEST(speed, 0),
    CASE WHEN heading >= 0 AND heading <= 360 THEN heading ELSE 0 END,
    COALESCE(captured_at, now())
  );

  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION insert_vehicle_position(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION insert_vehicle_position(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TIMESTAMPTZ) TO anon, authenticated;

-- ==========================================
-- 8. PROVISIONING — 256-bit CSPRNG token; only its digest is stored.
--    Takes the vehicle UUID (labels are only unique per operator). Callable by
--    service_role (auth.uid() IS NULL path) and by members of the vehicle's
--    own cooperative. The authority is read-only and CANNOT provision.
-- ==========================================
CREATE OR REPLACE FUNCTION provision_vehicle_token(p_vehicle_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token TEXT;
  v_operator UUID;
BEGIN
  SELECT operator_id INTO v_operator FROM vehicles WHERE id = p_vehicle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vehicle % not found', p_vehicle_id;
  END IF;

  IF auth.uid() IS NOT NULL AND
     (v_operator IS NULL OR v_operator NOT IN (SELECT member_operator_ids())) THEN
    RAISE EXCEPTION 'not authorized for this vehicle' USING ERRCODE = '42501';
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');  -- 32 bytes = 256 bits

  UPDATE vehicles
    SET token_hash = encode(digest(v_token, 'sha256'), 'hex')
    WHERE id = p_vehicle_id;

  RETURN v_token;  -- shown once; give it to the driver
END;
$$;

REVOKE ALL ON FUNCTION provision_vehicle_token(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION provision_vehicle_token(UUID) TO authenticated, service_role;

-- ==========================================
-- 8b. REPORTES (admin-app) — SECURITY INVOKER: corren con los permisos del
--     usuario del panel; el RLS de operators limita el nombre visible por rol.
--     Definiciones completas y notas en migrations/006_reports.sql.
-- ==========================================
CREATE OR REPLACE FUNCTION report_activity(p_from DATE, p_to DATE)
RETURNS TABLE (
  vehicle_id UUID, vehicle_label TEXT, route_id UUID, route_name TEXT,
  operator_id UUID, operator_name TEXT,
  expected_minutes BIGINT, active_minutes BIGINT, activity_pct NUMERIC
)
LANGUAGE sql STABLE SECURITY INVOKER
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
           GREATEST(0, ((p_to - p_from + 1) * (EXTRACT(EPOCH FROM (veh.op_end - veh.op_start)) / 60)))::bigint AS expected_minutes,
           COALESCE(act.active_minutes, 0)::bigint AS active_minutes
    FROM veh
    LEFT JOIN act ON act.vid = veh.id
  )
  SELECT b.id, b.label, b.route_id, b.route_name, b.operator_id, o.name,
         b.expected_minutes, b.active_minutes,
         COALESCE(ROUND(LEAST(100.0, 100.0 * b.active_minutes / NULLIF(b.expected_minutes, 0)), 1), 0)
  FROM base b
  LEFT JOIN operators o ON o.id = b.operator_id
  ORDER BY b.label;
$$;

CREATE OR REPLACE FUNCTION report_coverage(p_from DATE, p_to DATE)
RETURNS TABLE (
  vehicle_id UUID, vehicle_label TEXT, route_id UUID, route_name TEXT,
  operator_id UUID, operator_name TEXT,
  stop_id UUID, stop_name TEXT, stop_sequence INT,
  visited BOOLEAN, first_visited_at TIMESTAMPTZ, last_visited_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT v.id, v.label, r.id, r.short_name, v.operator_id, o.name,
         s.id, s.stop_name, s.stop_sequence,
         (vis.first_ts IS NOT NULL), vis.first_ts, vis.last_ts
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

REVOKE ALL ON FUNCTION report_activity(DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION report_coverage(DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION report_activity(DATE, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION report_coverage(DATE, DATE) TO authenticated, service_role;

-- ==========================================
-- 8c. RETENCIÓN — agrega días completos a daily_stats y purga posiciones más
--     viejas que la retención (60 días). El DELETE solo toca días ya
--     resumidos: nunca se pierde histórico sin agregar. La invoca a diario la
--     Edge Function purge-old-positions. Definición comentada y smoke tests
--     en migrations/007_retention.sql; política en POLITICA_DATOS.md.
-- ==========================================
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
           COALESCE(SUM(
             CASE WHEN p.prev_lat IS NULL THEN 0
             ELSE 6371000 * acos(GREATEST(-1.0, LEAST(1.0,
                    cos(radians(p.prev_lat)) * cos(radians(p.latitude))
                      * cos(radians(p.longitude) - radians(p.prev_lon))
                    + sin(radians(p.prev_lat)) * sin(radians(p.latitude))
                  )))
             END
           ), 0) / 1000.0 AS km_traveled,
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

REVOKE ALL ON FUNCTION aggregate_and_purge_positions(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aggregate_and_purge_positions(INT) TO service_role;

-- ==========================================
-- 9. SEED DATA
-- ==========================================
INSERT INTO operators (id, name)
VALUES ('33333333-3333-3333-3333-333333333333', 'Operador Piloto')
ON CONFLICT DO NOTHING;

INSERT INTO routes (id, operator_id, short_name, long_name, color)
VALUES ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'Ruta 1', 'Terminal Norte', '0055FF')
ON CONFLICT DO NOTHING;

-- Vehicle with no token yet. Provision it with:
--   SELECT provision_vehicle_token('22222222-2222-2222-2222-222222222222');
INSERT INTO vehicles (id, route_id, operator_id, token_hash, label)
VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', NULL, 'BUS-001')
ON CONFLICT DO NOTHING;

-- ==========================================
-- 10. MIGRATION REGISTRY — qué migraciones tiene esta base.
--     En una instalación limpia el esquema ya contiene todo lo que aportan
--     000-008, así que se marcan todas: aplicar cualquiera encima sería
--     redundante (y algunas no son re-ejecutables).
--     Metadato de operación, no dato público: RLS activo y sin policies →
--     solo service_role (que bypasea RLS) lo ve.
-- ==========================================
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note       TEXT
);

COMMENT ON TABLE schema_migrations IS
  'Migraciones de backend/supabase/migrations/ ya aplicadas a esta base.';

ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON schema_migrations FROM anon, authenticated;

INSERT INTO schema_migrations (version, note) VALUES
  ('000', 'Registro de migraciones aplicadas'),
  ('001', 'Token hasheado (SHA-256) + RPC insert_vehicle_position'),
  ('002', 'Rate limit por vehiculo + log de auth_failures'),
  ('003', 'Multi-operador: operators / operator_members / authority_users'),
  ('004', 'Vista latest_vehicle_positions'),
  ('005', 'Alertas de senal perdida'),
  ('006', 'Reportes: horario operativo + RPCs report_activity/report_coverage'),
  ('007', 'Retencion: daily_stats + aggregate_and_purge_positions'),
  ('008', 'captured_at en insert_vehicle_position (cola offline)')
ON CONFLICT (version) DO NOTHING;
