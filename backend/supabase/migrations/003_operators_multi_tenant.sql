-- ============================================================================
-- Migration 003 — Multi-operator (cooperativas) + Secretaría de Movilidad
--
-- Adds: operators, operator_members (staff -> operator), authority_users
-- (Secretaría, read-all), operator_id on routes/vehicles, and per-operator
-- management RLS.
--
-- DESIGN NOTES (deliberate):
--   * Passenger data (routes/stops/vehicles/vehicle_positions) STAYS public
--     read: the passenger map is anonymous. Operator isolation therefore
--     applies to WRITES (gestión), plus to the new private tables. A
--     per-operator SELECT restriction on those tables would break the
--     passenger app.
--   * "Secretaría" is an application-level role: a row in authority_users,
--     not a Postgres role. Custom DB roles don't flow through Supabase JWTs;
--     a membership table is auditable in SQL and easy to manage. Read-only is
--     achieved by giving it SELECT policies and no write policies anywhere.
--   * Helper functions are SECURITY DEFINER STABLE so policies can consult
--     membership tables without recursive-RLS problems.
--   * Nothing existing breaks: current rows are backfilled onto a seed
--     operator; the driver-token write path (RPC) is untouched.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. New tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS operators (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,
  contact_email TEXT,
  contact_phone TEXT,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Staff of a cooperative. role is informational for now ('admin' manages).
CREATE TABLE IF NOT EXISTS operator_members (
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'admin',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (operator_id, user_id)
);

-- Secretaría de Movilidad: users listed here can read EVERYTHING, write nothing.
CREATE TABLE IF NOT EXISTS authority_users (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. Link existing tables to operators (nullable => nothing breaks), then
--    backfill current rows onto a seed operator.
-- ---------------------------------------------------------------------------
ALTER TABLE routes   ADD COLUMN IF NOT EXISTS operator_id UUID REFERENCES operators(id) ON DELETE SET NULL;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS operator_id UUID REFERENCES operators(id) ON DELETE SET NULL;

-- Labels only need to be unique within one cooperative.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_operator_label
  ON vehicles (operator_id, label);

INSERT INTO operators (id, name, contact_email)
VALUES ('33333333-3333-3333-3333-333333333333', 'Operador Piloto', NULL)
ON CONFLICT DO NOTHING;

UPDATE routes   SET operator_id = '33333333-3333-3333-3333-333333333333' WHERE operator_id IS NULL;
UPDATE vehicles SET operator_id = '33333333-3333-3333-3333-333333333333' WHERE operator_id IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Role helper functions (SECURITY DEFINER => they read the membership
--    tables regardless of RLS, which also prevents policy recursion).
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 4. RLS — new tables (private: no public read).
-- ---------------------------------------------------------------------------
ALTER TABLE operators        ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE authority_users  ENABLE ROW LEVEL SECURITY;

-- operators: a member sees their own cooperative; the authority sees all.
-- No client write policies: operators are provisioned via service_role.
CREATE POLICY "operators_select_own_or_authority" ON operators
  FOR SELECT TO authenticated
  USING (id IN (SELECT member_operator_ids()) OR is_authority());

-- operator_members: you see your own memberships; the authority sees all.
CREATE POLICY "members_select_own_or_authority" ON operator_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_authority());

-- authority_users: no policies (service_role only). is_authority() bypasses
-- RLS as SECURITY DEFINER, so nothing else needs to read this table.

-- ---------------------------------------------------------------------------
-- 5. RLS — per-operator MANAGEMENT of routes / stops / vehicles.
--    Public SELECT policies from earlier migrations stay untouched.
--    WITH CHECK reuses the same predicate, so an operator cannot move a row
--    to (or create a row for) another cooperative.
-- ---------------------------------------------------------------------------
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

-- stops belong to a route; management follows the route's operator.
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

-- ---------------------------------------------------------------------------
-- 6. Security telemetry for the authority (institutional reports):
--    read-only visibility into auth_failures. vehicle_rate_limit stays private.
-- ---------------------------------------------------------------------------
CREATE POLICY "auth_failures_select_authority" ON auth_failures
  FOR SELECT TO authenticated
  USING (is_authority());

-- ---------------------------------------------------------------------------
-- 7. Token provisioning, multi-tenant aware.
--    Label is no longer globally unique, so the function now takes the vehicle
--    UUID (breaking change vs. migration 001's label-based signature).
--    Callable by: service_role (auth.uid() IS NULL path) and by members of the
--    vehicle's own cooperative — so each operator rotates its own tokens.
--    The authority is read-only and deliberately CANNOT provision.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS provision_vehicle_token(TEXT);

CREATE FUNCTION provision_vehicle_token(p_vehicle_id UUID)
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

  -- service_role calls have no auth.uid(); authenticated callers must belong
  -- to the vehicle's cooperative.
  IF auth.uid() IS NOT NULL AND
     (v_operator IS NULL OR v_operator NOT IN (SELECT member_operator_ids())) THEN
    RAISE EXCEPTION 'not authorized for this vehicle' USING ERRCODE = '42501';
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');  -- 256-bit CSPRNG

  UPDATE vehicles
    SET token_hash = encode(digest(v_token, 'sha256'), 'hex')
    WHERE id = p_vehicle_id;

  RETURN v_token;  -- shown once; only the digest is stored
END;
$$;

REVOKE ALL ON FUNCTION provision_vehicle_token(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION provision_vehicle_token(UUID) TO authenticated, service_role;

-- Registro en el control de migraciones (requiere 000_schema_migrations.sql).
INSERT INTO schema_migrations (version, note)
VALUES ('003', 'Multi-operador: operators / operator_members / authority_users')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ---------------------------------------------------------------------------
-- 8. PROVISIONING EXAMPLES (run via service_role / SQL editor):
--
--   -- New cooperative:
--   INSERT INTO operators (name, contact_email, contact_phone)
--   VALUES ('Cooflotax', 'gerencia@cooflotax.co', '+57 300 000 0000');
--
--   -- Attach a staff account (create the auth user first, then):
--   INSERT INTO operator_members (operator_id, user_id)
--   VALUES ('<operator uuid>', '<auth user uuid>');
--
--   -- Secretaría de Movilidad (read-all) account:
--   INSERT INTO authority_users (user_id, note)
--   VALUES ('<auth user uuid>', 'Secretaría de Movilidad - reportes');
--
-- 9. SMOKE TEST (expected):
--   * As member of op A: UPDATE vehicles SET label='X' WHERE operator_id=<A>  -> ok
--                        UPDATE ... WHERE operator_id=<B>                     -> 0 rows (RLS)
--                        UPDATE vehicles SET operator_id=<B> WHERE ...=<A>    -> WITH CHECK error
--   * As member of op A: SELECT * FROM operators;      -> only A
--   * As authority:      SELECT * FROM operators;      -> all rows
--                        INSERT/UPDATE anywhere        -> denied (no policy)
--   * As anon:           SELECT * FROM operators;      -> 0 rows
--                        SELECT * FROM routes;         -> all (passenger map intact)
--   * provision_vehicle_token(<vehicle of B>) as member of A -> 'not authorized'
-- ---------------------------------------------------------------------------
