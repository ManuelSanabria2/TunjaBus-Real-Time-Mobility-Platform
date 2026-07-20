# Migraciones TunjaBus — guía de aplicación

Ejecutar **en orden**, cada archivo completo, en el **SQL editor de Supabase**
(Dashboard → SQL Editor → New query → pegar → Run). Cada migración es
transaccional: si falla, no deja cambios a medias.

> ⚠️ `../schema.sql` es SOLO para instalaciones limpias (proyecto Supabase
> nuevo). Si tu base ya tiene datos, usa estas migraciones y NO ejecutes
> `schema.sql`.

## Antes de empezar

- [ ] Backup: Dashboard → Database → Backups (o exporta `vehicles` y
      `vehicle_positions` si quieres doble seguridad).
- [ ] Ten a mano el acceso al SQL editor con rol de administrador.

## Orden de aplicación

| # | Archivo | Qué hace |
|---|---|---|
| 1 | `001_hashed_token_rpc.sql` | Elimina el token en texto plano (`vehicles.token` → `token_hash` SHA-256 con índice único), bloquea el INSERT directo del cliente por RLS, crea el RPC `insert_vehicle_position()` (única vía de escritura) y `provision_vehicle_token()`. Añade CHECKs de lat/lon/velocidad/rumbo, FKs con `ON DELETE` e índice `(vehicle_id, timestamp)`. |
| 2 | `002_rate_limit_and_auth_log.sql` | Rate limit atómico de 1 insert/segundo por vehículo (descarte silencioso) y tabla `auth_failures` para intentos de token inválido. El RPC pasa a devolver `'ok' / 'invalid_token' / 'out_of_range'` en vez de lanzar error. |
| 3 | `003_operators_multi_tenant.sql` | Multi-operador: tablas `operators`, `operator_members`, `authority_users` (Secretaría, solo lectura); `operator_id` en `routes`/`vehicles` con backfill al operador semilla; RLS de gestión por cooperativa; `provision_vehicle_token()` ahora recibe el **UUID** del vehículo y pueden llamarla los miembros de la cooperativa dueña. |
| 4 | `004_latest_positions_view.sql` | Vista `latest_vehicle_positions` (última posición por vehículo, `security_invoker`). La usa la página Flota del admin-app; sin ella esa página no muestra últimas señales. |
| 5 | `005_alerts.sql` | Tabla `alerts` (signal_lost) con dedupe por índice único parcial, RLS (operador lee/resuelve las suyas; Secretaría solo lee) y Realtime. La alimenta la Edge Function `check-signal-lost`. |
| 6 | `006_reports.sql` | Módulo de reportes: horario operativo por ruta (`routes.operating_start/end`, default 05:00–21:00), índice por timestamp, y RPCs `report_activity` / `report_coverage` que usa la página Reportes del admin-app. |
| 7 | `007_retention.sql` | Retención de datos (ver `POLITICA_DATOS.md`): tabla `daily_stats` (resumen por vehículo/día) y función `aggregate_and_purge_positions()` — agrega días completos y purga posiciones >60 días (solo días ya resumidos). La invoca a diario la Edge Function `purge-old-positions`. |
| 8 | `008_captured_at.sql` | Cola offline del conductor: `insert_vehicle_position()` acepta `captured_at` opcional (hora real de captura, validada: ≤2 min futuro / ≤3 días pasado) para que los puntos reenviados tras un corte de red no se registren con la hora del reenvío. Compatible con el APK viejo. |

## Después de las migraciones (obligatorio)

1. **Provisionar el token del bus piloto** (la migración quema el token viejo
   a propósito — estaba commiteado en git):
   ```sql
   SELECT provision_vehicle_token('22222222-2222-2222-2222-222222222222');
   ```
   Copia el token devuelto (se muestra UNA sola vez) y entrégaselo al
   conductor para que lo ingrese en la app.

2. **Instalar el APK nuevo del conductor.** El APK viejo hace INSERT directo
   (ahora bloqueado por RLS) — dejará de reportar hasta actualizarlo.
   Desde `driver-app/`: `flutter build apk`.

3. **Usuarios del panel de administración (`admin-app`).** El login funciona
   con cualquier cuenta de Supabase Auth, pero sin rol asignado cae en
   `/sin-acceso`. Crea la cuenta en Dashboard → Authentication → Add user y
   asígnale rol:
   ```sql
   -- Operador (gestiona su cooperativa):
   INSERT INTO operator_members (operator_id, user_id)
   VALUES ('33333333-3333-3333-3333-333333333333', '<uuid del usuario auth>');

   -- O Secretaría de Movilidad (ve todo, solo lectura):
   INSERT INTO authority_users (user_id, note)
   VALUES ('<uuid del usuario auth>', 'Secretaría de Movilidad');
   ```
   (`33333333-...` es el operador semilla "Operador Piloto" que crea la
   migración 003; usa el id de la cooperativa real si ya la creaste.)

## Después de las migraciones (recomendado)

4. **Sistema de alertas** (después de aplicar `005`):
   - Despliega la Edge Function (requiere [Supabase CLI](https://supabase.com/docs/guides/cli)):
     ```bash
     supabase functions deploy check-signal-lost --project-ref <PROJECT_REF>
     ```
   - Habilita las extensiones `pg_cron` y `pg_net` (Dashboard → Database →
     Extensions) y programa la función cada 2 minutos con el `cron.schedule`
     que está comentado al final de `005` (rellena PROJECT_REF y ANON_KEY).
   - Opcional (email): `supabase secrets set RESEND_API_KEY=re_xxx ALERTS_FROM_EMAIL=alertas@tudominio.co`

4b. **Retención de datos** (después de aplicar `007`):
   - Despliega la segunda Edge Function:
     ```bash
     supabase functions deploy purge-old-positions --project-ref <PROJECT_REF>
     ```
   - Programa la corrida diaria (03:30 hora de Tunja) con el `cron.schedule`
     comentado al final de `007`.
   - Opcional: cambiar la ventana con `supabase secrets set RETENTION_DAYS=90`.

5. **Retención de logs** — con `pg_cron` ya habilitado, ejecuta el
   `cron.schedule` comentado al final de `002` (poda de `auth_failures`; sin
   ella es un vector de llenado de disco).

6. **Alta de más cooperativas** cuando las necesites — ejemplos listos en la
   sección 8 de `003`.

## Verificación (smoke test)

Cada migración trae su smoke test al final del archivo. Los esenciales:

```sql
-- El secreto ya no existe:
SELECT token FROM vehicles;                                   -- ERROR: column does not exist ✓

-- Escritura directa bloqueada (córrelo con la anon key, no en el SQL editor):
-- INSERT INTO vehicle_positions (...) VALUES (...);          -- denegado por RLS ✓

-- El RPC autentica:
SELECT insert_vehicle_position('token-falso', 5.53, -73.36, 10, 90);  -- 'invalid_token' ✓
SELECT * FROM auth_failures ORDER BY occurred_at DESC LIMIT 1;        -- intento registrado ✓

-- Con el token real provisionado en el paso 1:
SELECT insert_vehicle_position('<token real>', 5.53, -73.36, 10, 90); -- 'ok' + fila nueva ✓
```

Prueba E2E final: conductor inicia turno en la app → el bus aparece y se
mueve en el mapa de pasajeros.
