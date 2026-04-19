-- ==========================================
-- SUPABASE SCHEMA - TUNJABUS MVP
-- ==========================================

-- 1. ROUTES
CREATE TABLE routes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_name   TEXT NOT NULL,        
  long_name    TEXT NOT NULL,        
  color        TEXT DEFAULT 'FF0000',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 2. STOPS
CREATE TABLE stops (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id     UUID REFERENCES routes(id),
  stop_name    TEXT NOT NULL,
  stop_lat     DOUBLE PRECISION NOT NULL,
  stop_lon     DOUBLE PRECISION NOT NULL,
  stop_sequence INT NOT NULL          
);

-- 3. VEHICLES 
CREATE TABLE vehicles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id     UUID REFERENCES routes(id),
  token        TEXT UNIQUE NOT NULL,  
  label        TEXT NOT NULL          
);

-- 4. REAL-TIME POSITIONS
CREATE TABLE vehicle_positions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id   UUID REFERENCES vehicles(id),
  latitude     DOUBLE PRECISION NOT NULL,
  longitude    DOUBLE PRECISION NOT NULL,
  speed_kmh    DOUBLE PRECISION DEFAULT 0,
  heading      DOUBLE PRECISION DEFAULT 0,  
  timestamp    TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Enable Realtime in the vehicle_positions table
ALTER PUBLICATION supabase_realtime ADD TABLE vehicle_positions;

-- 6. ROW LEVEL SECURITY (RLS)
ALTER TABLE vehicle_positions ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "public_read_positions" ON vehicle_positions
  FOR SELECT USING (true);

-- Write access valid only with token
CREATE POLICY "driver_insert_positions" ON vehicle_positions
  FOR INSERT WITH CHECK (
    vehicle_id IN (
      SELECT id FROM vehicles WHERE token = current_setting('app.driver_token', true)
    )
  );

ALTER TABLE routes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_routes" ON routes FOR SELECT USING (true);

ALTER TABLE stops ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_stops" ON stops FOR SELECT USING (true);

ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_vehicles" ON vehicles FOR SELECT USING (true);


-- ==========================================
-- 7. SEED DATA
-- ==========================================

-- Insert demo route
INSERT INTO routes (id, short_name, long_name, color) 
VALUES (
  '11111111-1111-1111-1111-111111111111', 
  'Ruta 1', 
  'Terminal Norte', 
  '0055FF'
) ON CONFLICT DO NOTHING;

-- Insert demo vehicle
INSERT INTO vehicles (id, route_id, token, label) 
VALUES (
  '22222222-2222-2222-2222-222222222222', 
  '11111111-1111-1111-1111-111111111111', 
  'BUS01_TOKEN_SECRET', 
  'BUS-001'
) ON CONFLICT DO NOTHING;
