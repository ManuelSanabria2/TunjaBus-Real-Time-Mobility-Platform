-- ============================================================================
-- Migration 008 — Timestamp de captura en insert_vehicle_position()
--
-- La app del conductor ahora tiene cola offline: si no hay red, los puntos se
-- guardan localmente y se reenvían al reconectar. Para que el historial no se
-- corrompa, cada punto debe registrarse con SU hora de captura, no con la hora
-- del reenvío. Se agrega el parámetro opcional `captured_at`:
--
--   * NULL (APK viejo o envío en vivo sin reloj) -> now(), como antes.
--   * Con valor -> se valida: máx. 2 min en el futuro (deriva de reloj) y
--     máx. 3 días en el pasado (cola offline razonable). Fuera de eso se
--     rechaza con 'invalid_timestamp' (y se registra en auth_failures).
--
-- El RATE LIMIT no cambia: sigue siendo 1 insert/segundo por vehículo medido
-- con now() — es un límite de caudal de escritura, no de la fecha del dato.
-- El cliente drena la cola a ~1 punto/1.2 s para respetarlo.
--
-- Compatibilidad: se elimina la función de 5 parámetros y se crea la de 6 con
-- DEFAULT NULL — las llamadas del APK viejo (5 params nombrados) resuelven a
-- la nueva sin cambios.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS insert_vehicle_position(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION);

-- Returns: 'ok'                -> insertado, o descartado en silencio por rate limit
--          'invalid_token'     -> token no autenticó (registrado)
--          'out_of_range'      -> coordenadas inválidas (registrado)
--          'invalid_timestamp' -> captured_at fuera de rango (registrado)
CREATE FUNCTION insert_vehicle_position(
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

  -- Validación del timestamp de captura (solo cuando viene explícito).
  IF captured_at IS NOT NULL AND (
       captured_at > now() + interval '2 minutes'
    OR captured_at < now() - interval '3 days'
  ) THEN
    INSERT INTO auth_failures (vehicle_id, reason, client_ip) VALUES (v_id, 'invalid_timestamp', v_ip);
    RETURN 'invalid_timestamp';
  END IF;

  -- Rate limit atómico (1/s por vehículo, medido con now()).
  INSERT INTO vehicle_rate_limit AS rl (vehicle_id, last_insert_at)
  VALUES (v_id, now())
  ON CONFLICT (vehicle_id) DO UPDATE
    SET last_insert_at = now()
    WHERE rl.last_insert_at <= now() - interval '1 second'
  RETURNING rl.vehicle_id INTO v_allowed;

  IF v_allowed IS NULL THEN
    RETURN 'ok';  -- descartado en silencio; indistinguible de éxito
  END IF;

  INSERT INTO vehicle_positions (vehicle_id, latitude, longitude, speed_kmh, heading, timestamp)
  VALUES (
    v_id,
    lat,
    lon,
    GREATEST(speed, 0),
    CASE WHEN heading >= 0 AND heading <= 360 THEN heading ELSE 0 END,
    COALESCE(captured_at, now())
  );

  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION insert_vehicle_position(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION insert_vehicle_position(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TIMESTAMPTZ) TO anon, authenticated;

-- Registro en el control de migraciones (requiere 000_schema_migrations.sql).
INSERT INTO schema_migrations (version, note)
VALUES ('008', 'captured_at en insert_vehicle_position (cola offline)')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ---------------------------------------------------------------------------
-- SMOKE TEST:
--   * SELECT insert_vehicle_position('<token>', 5.53, -73.36, 10, 90);
--       -> 'ok' (sin captured_at, timestamp = now(); compatible con APK viejo)
--   * SELECT insert_vehicle_position('<token>', 5.53, -73.36, 10, 90, now() - interval '1 hour');
--       -> 'ok'; la fila queda con timestamp de hace 1 hora
--   * SELECT insert_vehicle_position('<token>', 5.53, -73.36, 10, 90, now() + interval '1 day');
--       -> 'invalid_timestamp' + fila en auth_failures
--   * SELECT insert_vehicle_position('<token>', 5.53, -73.36, 10, 90, now() - interval '10 days');
--       -> 'invalid_timestamp'
-- ---------------------------------------------------------------------------
