# Andén — Plataforma de movilidad en tiempo real (TunjaBus)

Seguimiento en vivo del transporte público de Tunja, Boyacá. Los conductores
emiten su posición GPS desde una app Flutter, los pasajeros ven los buses
moverse en un mapa web/Android, y las cooperativas y la Secretaría de
Movilidad gestionan flota, alertas y reportes desde un panel administrativo.

> **Software propietario.** Todos los derechos reservados — ver [`LICENSE`](LICENSE).
> Este repositorio es público para evaluación técnica; no es código abierto.

---

## Componentes

| Carpeta | Qué es | Stack |
|---|---|---|
| `user-app/` | App de pasajeros: mapa en vivo, bus más cercano, ETA. Web **y** APK Android (Capacitor, appId `com.tunjabus.passenger`). | Next.js 16 · React 19 · Leaflet |
| `admin-app/` | Panel de administración: flota, rutas, alertas y reportes. Dos roles: **operador** (su cooperativa) y **autoridad** (Secretaría, solo lectura). | Next.js 16 · React 19 · Tailwind v4 · Supabase Auth |
| `driver-app/` | App del conductor: emite GPS (filtro de Kalman + cola offline). | Flutter (Android) |
| `backend/supabase/` | Todo el backend: `schema.sql`, `migrations/` y dos Edge Functions. | Postgres · RLS · Realtime · Deno |
| `scripts/` | Semilla de paraderos desde OpenStreetMap/Overpass. | Node |

No hay servidor propio: **Supabase es el backend completo** (Postgres +
Realtime + RLS). La documentación y los comentarios están en español.

### Flujo de datos

```
driver-app  ──RPC insert_vehicle_position()──►  Supabase  ──postgres_changes──►  user-app (BusMap)
                                                    │
                                                    └── admin-app (flota, alertas, reportes)
```

### Modelo de seguridad (resumen)

- El conductor guarda en su dispositivo un **token de 256 bits** generado por
  el servidor. La base solo almacena su **hash SHA-256** (`vehicles.token_hash`,
  con un CHECK que hace imposible guardar texto plano).
- La **única** vía de escritura de posiciones es el RPC
  `insert_vehicle_position()` (SECURITY DEFINER). El INSERT directo del cliente
  está bloqueado por RLS.
- Rate limit de 1 posición/segundo por vehículo; los intentos con token
  inválido quedan en `auth_failures`.
- Lectura pública (el mapa de pasajeros no requiere cuenta). Los datos de
  gestión están segmentados por cooperativa vía RLS.
- Retención: las posiciones GPS se resumen y se purgan a los 60 días — ver
  [`POLITICA_DATOS.md`](POLITICA_DATOS.md).

---

## Puesta en marcha

### 1. Base de datos (hazlo primero: todo lo demás depende de ella)

**Proyecto Supabase nuevo:** pega [`backend/supabase/schema.sql`](backend/supabase/schema.sql)
completo en el SQL Editor y ejecútalo. Ya incluye el estado final de todas las
migraciones.

**Base existente con datos:** NO ejecutes `schema.sql`. Aplica en orden los
archivos de [`backend/supabase/migrations/`](backend/supabase/migrations/) (000
a 008) siguiendo su [README](backend/supabase/migrations/README.md), que
incluye backup, orden, pasos posteriores y smoke tests.

Para saber qué tiene aplicado una base:

```sql
SELECT version, applied_at FROM schema_migrations ORDER BY version;
```

Después de la base, dos pasos **obligatorios** (detallados en el README de
migraciones):

1. Provisionar el token de cada vehículo — se muestra **una sola vez**:
   ```sql
   SELECT provision_vehicle_token('<uuid del vehículo>');
   ```
2. Dar rol a las cuentas del panel (`operator_members` o `authority_users`);
   sin rol, cualquier login cae en `/sin-acceso`.

### 2. Variables de entorno

Tres ubicaciones con **nombres distintos** — no copies nombres entre ellas.
[`.env.example`](.env.example) en la raíz documenta todas.

| App | Archivo | Variables |
|---|---|---|
| `user-app/` | `.env.local` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `admin-app/` | `.env.local` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `driver-app/` | `.env` (se empaqueta como asset de Flutter) | `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| `scripts/` | lee `../user-app/.env.local` | además `SUPABASE_SERVICE_ROLE_KEY` |

La `service_role key` solo se usa desde `scripts/` y desde las Edge Functions.
**Nunca** en código de cliente ni en variables `NEXT_PUBLIC_*`.

### 3. Ejecutar en local

```bash
# App de pasajeros  → http://localhost:3000
cd user-app && npm install && npm run dev

# Panel admin       → http://localhost:3001
cd admin-app && npm install && npm run dev

# App del conductor (dispositivo o emulador Android)
cd driver-app && flutter pub get && flutter run
```

### 4. Sembrar paraderos (opcional)

Exporta los paraderos de Tunja desde Overpass Turbo a
`scripts/stops_tunja.json` y ejecuta:

```bash
cd scripts
node load-stops.js <route_id>   # el route_id es obligatorio
```

Requiere `SUPABASE_SERVICE_ROLE_KEY` en `user-app/.env.local` (salta RLS).
Los datos derivados de OpenStreetMap están sujetos a la licencia ODbL.

---

## Despliegue

### App de pasajeros (Vercel)

Export estático (`next.config.mjs` usa `output: 'export'`).

1. Nuevo proyecto en Vercel conectado a este repositorio.
2. **Root Directory: `user-app`**.
3. Variables de entorno: `NEXT_PUBLIC_SUPABASE_URL` y
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (en Production y Preview).
4. Deploy. La configuración de build está en `user-app/vercel.json`.

### Panel de administración (Vercel, proyecto **aparte**)

No es export estático: la protección de rutas (`src/proxy.ts` — en Next 16
`middleware.ts` se llama `proxy.ts`) y la sesión por cookies necesitan
servidor. Por eso va en **su propio proyecto de Vercel**, no en el mismo.

1. Segundo proyecto en Vercel, mismo repositorio.
2. **Root Directory: `admin-app`**.
3. Mismas dos variables `NEXT_PUBLIC_*` (mismo proyecto Supabase).
4. Deploy. A diferencia de `user-app`, aquí los errores de TypeScript **sí**
   rompen el build (`npm run typecheck` antes de subir).

### Edge Functions y tareas programadas (Supabase CLI)

```bash
supabase functions deploy check-signal-lost   --project-ref <PROJECT_REF>
supabase functions deploy purge-old-positions --project-ref <PROJECT_REF>
```

Programa sus corridas con los `cron.schedule` comentados al final de las
migraciones `005` (alertas de señal perdida) y `007` (retención a 60 días), y
la poda de `auth_failures` al final de `002`. Sin esos crons, ni las alertas ni
la política de retención se ejecutan.

### APK de pasajeros (Capacitor, desde `user-app/`)

```bash
npm run build          # regenera ./out
npx cap sync android   # copia los assets al proyecto Android
npx cap open android   # compila el APK en Android Studio
```

### APK del conductor (Flutter, desde `driver-app/`)

```bash
flutter build apk
```

Los APK **no se versionan en git** (`.gitignore` los excluye). Distribúyelos
por GitHub Releases o entrega directa; el keystore de firma
(`tunjabus-passenger.jks`) tampoco se versiona y debe guardarse aparte: si se
pierde, no se puede volver a publicar una actualización de la app.

---

## Comandos por proyecto

```bash
# user-app
npm run dev | npm run build | npm run lint
# ⚠️ typescript.ignoreBuildErrors: true → un build verde NO garantiza tipos limpios

# admin-app
npm run dev | npm run build | npm run lint | npm run typecheck

# driver-app
flutter run | flutter build apk | flutter analyze | flutter test
```

---

## Checklist de salida a campo

- [ ] Migraciones aplicadas y verificadas (`SELECT * FROM schema_migrations`).
- [ ] Token provisionado por vehículo e ingresado en la app del conductor
      (se muestra una sola vez; si se pierde, se vuelve a provisionar).
- [ ] Paraderos de la ruta piloto cargados en `stops`.
- [ ] Web de pasajeros desplegada por HTTPS y panel admin accesible con una
      cuenta de operador y una de autoridad.
- [ ] Edge Functions desplegadas y sus crons programados.
- [ ] APK del conductor instalado, con plan de datos y permiso de ubicación
      "Todo el tiempo" (si no, Android mata el envío en segundo plano).
- [ ] Prueba E2E: el conductor inicia turno → el bus aparece y se mueve en el
      mapa del pasajero.
- [ ] `POLITICA_DATOS.md` con responsable y correo de contacto reales.

## Documentación adicional

- [`INSTRUCCIONES.MD`](INSTRUCCIONES.MD) — especificación de diseño original.
- [`POLITICA_DATOS.md`](POLITICA_DATOS.md) — tratamiento y retención de datos
  (Ley 1581 de 2012).
- [`LISTO_PARA_VENTA.md`](LISTO_PARA_VENTA.md) — auditoría de estado del
  producto.
- [`CLAUDE.md`](CLAUDE.md) — guía de arquitectura para trabajar en el código.
- [`backend/supabase/migrations/README.md`](backend/supabase/migrations/README.md)
  — guía de aplicación de migraciones.
