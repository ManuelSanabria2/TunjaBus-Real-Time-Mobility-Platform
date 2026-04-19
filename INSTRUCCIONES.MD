## 1. Visión General

TunjaBus es una plataforma de movilidad urbana para la ciudad de Tunja (Boyacá, Colombia) que permite visualizar en tiempo real la ubicación de buses urbanos sobre un mapa, estimar el tiempo de llegada (ETA) a paraderos cercanos y ofrecer a los conductores una app simple para emitir su posición GPS.

**Alcance del MVP:**
- 1 bus piloto en operación real
- 1 ruta definida con paraderos reales (datos OSM)
- App del Conductor (Android / Flutter)
- App del Usuario (Web / React + Next.js)
- Backend serverless con Supabase Realtime

---

## 2. Stack Tecnológico (Cero Costo)

| Capa | Tecnología | Justificación |
|---|---|---|
| Base de Datos | Supabase (PostgreSQL + Realtime) | Realtime nativo, RLS, gratis hasta 500MB |
| Backend | Supabase Edge Functions | Sin servidor propio, latencia baja |
| App Conductor | Flutter (Android) | GPS nativo, `geolocator`, APK directo |
| App Usuario | Next.js + React | SSR, fácil deploy en Vercel |
| Mapa | Leaflet.js + OpenStreetMap | 100% gratuito, sin API Key |
| Datos Geográficos | Overpass Turbo (OSM) | Paraderos reales de Tunja |
| Deploy Frontend | Vercel | CD automático desde GitHub |
| CI/CD | GitHub Actions | Gratis para repos públicos/privados |

---

## 3. Arquitectura del Sistema

```
┌─────────────────────────────────────────────────────────┐
│                    APP CONDUCTOR (Flutter)               │
│  GPS → Filtro de movimiento → Supabase Realtime (POST)  │
└─────────────────────────┬───────────────────────────────┘
                          │ HTTPS + Token RLS
                          ▼
┌─────────────────────────────────────────────────────────┐
│                    SUPABASE                             │
│  PostgreSQL · Realtime · Row Level Security · Auth      │
│                                                         │
│  Tablas: routes · stops · vehicles · vehicle_positions  │
└─────────────────────────┬───────────────────────────────┘
                          │ Supabase JS Client (Realtime)
                          ▼
┌─────────────────────────────────────────────────────────┐
│                APP USUARIO (Next.js / React)             │
│  Mapa Leaflet → Icono bus en tiempo real → ETA          │
└─────────────────────────────────────────────────────────┘
```

---

## 4. Esquema de Base de Datos (Lógica GTFS Adaptada)

```sql
-- RUTAS
CREATE TABLE routes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_name   TEXT NOT NULL,        -- Ej: "Ruta 1"
  long_name    TEXT NOT NULL,        -- Ej: "Terminal - Norte"
  color        TEXT DEFAULT 'FF0000',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- PARADEROS (cargados desde OSM/Overpass Turbo)
CREATE TABLE stops (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id     UUID REFERENCES routes(id),
  stop_name    TEXT NOT NULL,
  stop_lat     DOUBLE PRECISION NOT NULL,
  stop_lon     DOUBLE PRECISION NOT NULL,
  stop_sequence INT NOT NULL          -- Orden en la ruta
);

-- VEHÍCULOS (IDs anónimos, sin nombres reales)
CREATE TABLE vehicles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id     UUID REFERENCES routes(id),
  token        TEXT UNIQUE NOT NULL,  -- Token secreto del conductor
  label        TEXT NOT NULL          -- Ej: "Bus-01" (sin datos personales)
);

-- POSICIONES EN TIEMPO REAL (la tabla crítica)
CREATE TABLE vehicle_positions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id   UUID REFERENCES vehicles(id),
  latitude     DOUBLE PRECISION NOT NULL,
  longitude    DOUBLE PRECISION NOT NULL,
  speed_kmh    DOUBLE PRECISION DEFAULT 0,
  heading      DOUBLE PRECISION DEFAULT 0,  -- Dirección en grados
  timestamp    TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar Realtime en la tabla de posiciones
ALTER PUBLICATION supabase_realtime ADD TABLE vehicle_positions;

-- ROW LEVEL SECURITY
ALTER TABLE vehicle_positions ENABLE ROW LEVEL SECURITY;

-- Solo lectura pública (usuarios ven posiciones)
CREATE POLICY "public_read" ON vehicle_positions
  FOR SELECT USING (true);

-- Solo escritura con token válido (conductores insertan)
CREATE POLICY "driver_insert" ON vehicle_positions
  FOR INSERT WITH CHECK (
    vehicle_id IN (
      SELECT id FROM vehicles WHERE token = current_setting('app.driver_token', true)
    )
  );
```

---

## 5. Lógica de Negocio Clave

### 5.1 Filtro de Movimiento (App Conductor)
```dart
// Enviar GPS solo si:
// - Se movió más de 10 metros desde la última posición
// - O pasaron más de 30 segundos (heartbeat mínimo)
const double MIN_DISTANCE_METERS = 10.0;
const int MAX_INTERVAL_SECONDS = 30;
```

### 5.2 Interpolación de Movimiento (App Usuario)
```javascript
// Si el bus no envía señal por más de 5 segundos,
// animar el icono hacia adelante con base en:
// - Última posición conocida
// - Última velocidad conocida
// - Último heading (dirección)
// Esto evita que el ícono "salte" o se congele
const SIGNAL_TIMEOUT_MS = 5000;
```

### 5.3 Cálculo de ETA
```javascript
// ETA simple para MVP:
// 1. Calcular distancia Haversine entre bus y paradero objetivo
// 2. Dividir entre velocidad promedio de la ruta (25 km/h urbano)
// 3. Mostrar en minutos redondeados

function calculateETA(busLat, busLon, stopLat, stopLon, avgSpeedKmh = 25) {
  const distanceKm = haversineDistance(busLat, busLon, stopLat, stopLon);
  const timeHours = distanceKm / avgSpeedKmh;
  return Math.round(timeHours * 60); // minutos
}
```

---

## 6. Checklist de Seguridad y Calidad

- [ ] RLS habilitado en Supabase con token por vehículo
- [ ] IDs anónimos en la tabla `vehicles` (sin datos personales)
- [ ] Variables de entorno en `.env.local` (nunca en el repo)
- [ ] Paraderos cargados desde OSM (no hardcodeados)
- [ ] Filtro de movimiento activo en app del conductor
- [ ] Interpolación de movimiento activa en frontend
- [ ] ETA basado en distancia real Haversine + velocidad promedio
- [ ] Estructura de BD compatible con estándar GTFS
