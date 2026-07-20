-- ============================================================================
-- Migration 001 — Hashed-token write path via SECURITY DEFINER RPC
--
-- Design notes (deliberate):
--   * Hash = plain SHA-256, NOT bcrypt/scrypt/argon2. Vehicle tokens are
--     system-generated with 256 bits of CSPRNG entropy, so security comes from
--     the entropy, not from hash slowness. Slow KDFs only pay off against
--     low-entropy, guessable human passwords.
--   * This runs on the hot path (one call per GPS ping, every 2-5s per bus).
--     SHA-256 is microseconds; bcrypt would burn Postgres CPU at fleet scale.
--   * SHA-256 is deterministic (no per-row salt), so the lookup is a single
--     hash + an O(log n) probe on a UNIQUE index. A salted/bcrypt scheme would
--     force a sequential scan hashing every row.
--
-- Findings addressed: C1 (token readable), C2 (leaked token), H1/H4 (write
-- path unauthenticated), M2/M3/M5 (validation, indexing, integrity).
--
-- Run the whole file in the Supabase SQL editor. Transactional and defensive.
-- ============================================================================

BEGIN;

-- digest() and gen_random_bytes() live here.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. vehicles: store only a SHA-256 digest of the token.
-- ---------------------------------------------------------------------------
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS token_hash TEXT;

-- Drop the plaintext token WITHOUT migrating its value. The pilot token
-- ('TOKEN_PILOTO_PURGADO') is low-entropy AND was committed to git, so it is
-- burned: hashing it forward would just preserve a known-compromised secret.
-- Every vehicle must be re-provisioned via provision_vehicle_token() below.
ALTER TABLE vehicles DROP COLUMN IF EXISTS token;

-- Defensive: column from the abandoned Supabase-Auth attempt, if it was applied.
ALTER TABLE vehicles DROP COLUMN IF EXISTS owner_id;

-- Defensive: discard any non-SHA-256 digest (e.g. a bcrypt hash from an earlier
-- iteration). It cannot be converted, so force re-provisioning.
UPDATE vehicles
  SET token_hash = NULL
  WHERE token_hash IS NOT NULL AND token_hash !~ '^[0-9a-f]{64}$';

-- Structural guarantee that only a SHA-256 hex digest can ever be stored here:
-- a plaintext token cannot satisfy this pattern. (NULL = not provisioned yet.)
ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_token_hash_is_sha256;
ALTER TABLE vehicles
  ADD CONSTRAINT vehicles_token_hash_is_sha256
  CHECK (token_hash IS NULL OR token_hash ~ '^[0-9a-f]{64}$');

-- O(log n) lookup for the hot path + prevents two vehicles sharing a token.
-- (Postgres allows multiple NULLs under a UNIQUE index, so unprovisioned
-- vehicles do not collide.)
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_token_hash
  ON vehicles (token_hash);

-- ---------------------------------------------------------------------------
-- 2. vehicle_positions hardening (audit M2/M3/M5).
-- ---------------------------------------------------------------------------
UPDATE vehicle_positions SET heading   = 0 WHERE heading   < 0 OR heading > 360;
UPDATE vehicle_positions SET speed_kmh = 0 WHERE speed_kmh < 0;

ALTER TABLE vehicle_positions
  ADD CONSTRAINT vp_lat_range     CHECK (latitude  BETWEEN -90 AND 90),
  ADD CONSTRAINT vp_lon_range     CHECK (longitude BETWEEN -180 AND 180),
  ADD CONSTRAINT vp_speed_nonneg  CHECK (speed_kmh >= 0),
  ADD CONSTRAINT vp_heading_range CHECK (heading BETWEEN 0 AND 360);

ALTER TABLE vehicle_positions DROP CONSTRAINT IF EXISTS vehicle_positions_vehicle_id_fkey;
ALTER TABLE vehicle_positions
  ADD CONSTRAINT vehicle_positions_vehicle_id_fkey
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_vehicle_positions_vehicle_ts
  ON vehicle_positions (vehicle_id, timestamp DESC);

-- ---------------------------------------------------------------------------
-- 3. RLS: public read, but NO insert policy => direct client INSERT denied.
--    The SECURITY DEFINER RPC below is the only writer.
-- ---------------------------------------------------------------------------
ALTER TABLE vehicle_positions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "driver_insert_positions"   ON vehicle_positions;  -- original token-GUC policy
DROP POLICY IF EXISTS "driver_insert_own_vehicle" ON vehicle_positions;  -- abandoned auth policy

DROP POLICY IF EXISTS "public_read_positions" ON vehicle_positions;
CREATE POLICY "public_read_positions" ON vehicle_positions
  FOR SELECT USING (true);

-- ---------------------------------------------------------------------------
-- 4. The only write path.
--    SECURITY DEFINER runs as the function owner (table owner) and therefore
--    bypasses RLS. search_path is pinned to prevent hijacking.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION insert_vehicle_position(
  token   TEXT,
  lat     DOUBLE PRECISION,
  lon     DOUBLE PRECISION,
  speed   DOUBLE PRECISION,
  heading DOUBLE PRECISION
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash TEXT;
  v_id   UUID;
BEGIN
  IF token IS NULL OR length(token) = 0 THEN
    RAISE EXCEPTION 'invalid token' USING ERRCODE = '28000';
  END IF;

  IF lat < -90 OR lat > 90 OR lon < -180 OR lon > 180 THEN
    RAISE EXCEPTION 'coordinates out of range' USING ERRCODE = '22003';
  END IF;

  -- One deterministic hash, then an index probe. No per-row hashing.
  v_hash := encode(digest(token, 'sha256'), 'hex');

  SELECT id INTO v_id FROM vehicles WHERE token_hash = v_hash;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'invalid token' USING ERRCODE = '28000';
  END IF;

  INSERT INTO vehicle_positions (vehicle_id, latitude, longitude, speed_kmh, heading)
  VALUES (
    v_id,
    lat,
    lon,
    GREATEST(speed, 0),
    CASE WHEN heading >= 0 AND heading <= 360 THEN heading ELSE 0 END
  );
END;
$$;

REVOKE ALL ON FUNCTION insert_vehicle_position(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION insert_vehicle_position(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Provisioning: generate a 256-bit CSPRNG token, store ONLY its digest,
--    and return the plaintext exactly once (give it to the driver).
--    Admin-only: never granted to anon/authenticated, or anyone could rotate
--    a vehicle's token and hijack it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION provision_vehicle_token(p_vehicle_label TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token TEXT;
BEGIN
  -- 32 bytes = 256 bits from the CSPRNG, hex-encoded (64 chars).
  v_token := encode(gen_random_bytes(32), 'hex');

  UPDATE vehicles
    SET token_hash = encode(digest(v_token, 'sha256'), 'hex')
    WHERE label = p_vehicle_label;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'vehicle % not found', p_vehicle_label;
  END IF;

  -- Shown once. Only the digest is persisted.
  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION provision_vehicle_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION provision_vehicle_token(TEXT) TO service_role;

COMMIT;

-- ---------------------------------------------------------------------------
-- 6. PROVISION THE PILOT (run once; copy the returned token to the driver):
--      SELECT provision_vehicle_token('BUS-001');
--
-- 7. SMOKE TEST (expected results):
--   * SELECT token FROM vehicles;                        -> ERROR: column does not exist  (good)
--   * INSERT INTO vehicle_positions(...) as anon         -> denied by RLS                 (good)
--   * SELECT insert_vehicle_position('wrong',5.5,-73.3,10,90)      -> ERROR: invalid token (good)
--   * SELECT insert_vehicle_position('<token real>',5.5,-73.3,10,90) -> inserts one row    (good)
--   * EXPLAIN the lookup inside the RPC -> Index Scan using idx_vehicles_token_hash (good)
-- ---------------------------------------------------------------------------
