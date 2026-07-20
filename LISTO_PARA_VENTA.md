# Checklist "Listo para venta" — TunjaBus / Andén

**Fecha de auditoría:** 19 de julio de 2026
**Método:** revisión del código real del repositorio (no de la documentación).

> ⚠️ **Advertencia global que condiciona todo el checklist:** el código está
> completo en el repo, pero **ninguna migración se ha aplicado aún en
> Supabase** (decisión del flujo de trabajo: se aplican todas al final, ver
> `backend/supabase/migrations/README.md`). Los ítems marcados ⚠️ están
> **implementados pero inactivos** hasta ejecutar ese checklist de
> activación. La base de datos de producción, hoy, sigue con el esquema
> viejo (token en texto plano, sin rate limit, sin roles).

**Leyenda:** ✅ cumplido · ⚠️ implementado, pendiente de activación o con
salvedad · ❌ falta

---

## 1. ⚠️ Autenticación de conductores segura (hash, RPC, sin insert directo)

**Código: cumplido.** Verificado en el repo:
- `vehicles.token_hash` SHA-256 con índice único y CHECK que impide guardar
  texto plano (`migrations/001`, `schema.sql`). La columna `token` se elimina.
- Única vía de escritura: RPC `insert_vehicle_position()` SECURITY DEFINER;
  RLS activo **sin** policy de INSERT → el insert directo del cliente está
  bloqueado.
- Tokens de 32 bytes CSPRNG generados server-side (`provision_vehicle_token`),
  mostrados una sola vez en el panel (con QR).
- `driver-app` verificado: **cero** inserts directos, cero tokens
  hardcodeados; solo `rpc('insert_vehicle_position')`.

**Falta para marcarlo ✅:** aplicar migraciones 001–008 en Supabase,
provisionar el token del bus piloto e instalar el APK nuevo (el instalado usa
el flujo viejo y quedará bloqueado al migrar).

## 2. ⚠️ Rate limiting activo

**Código: cumplido.** `vehicle_rate_limit` con upsert atómico (1 insert/s por
vehículo, descarte silencioso) dentro del RPC (`migrations/002`, ventana
ajustada a 1 s por decisión registrada; `008` lo preserva). Log de intentos
fallidos en `auth_failures`.

**Falta:** aplicar migraciones. Nota honesta ya documentada en la migración:
esto limita el **abuso con token válido filtrado**; no es una defensa contra
fuerza bruta (esa la da la entropía de 256 bits del token).

## 3. ⚠️ Multi-operador y multi-ruta con permisos correctos

**Código: cumplido.** `operators` / `operator_members` / `authority_users`,
`operator_id` en rutas y vehículos con backfill, 19 policies RLS en el schema
(gestión aislada por cooperativa con `WITH CHECK` que impide mover filas entre
operadores; Secretaría solo lectura), helpers `is_authority()` /
`member_operator_ids()` (`migrations/003`).

**Falta:** aplicar migraciones + crear las cuentas reales (cooperativa piloto,
usuario operador, usuario Secretaría — SQL listo en el README de migraciones).
El aislamiento entre operadores solo podrá **probarse** cuando existan ≥2
cooperativas con datos.

## 4. ⚠️ Panel admin operativo (flota, alertas, reportes, onboarding)

**Código: cumplido en las 4 áreas pedidas** — verificado que compila
(`typecheck` + `lint` + `next build` en verde):
- **Flota:** tabla con estados (activo / >2 min / >10 min en rojo), mapa
  Leaflet en tiempo real, historial del día por vehículo.
- **Alertas:** badge en vivo en el sidebar, página con tabs, resolución
  manual, Edge Function `check-signal-lost` + auto-resolución.
- **Reportes:** actividad y cobertura por rango de fechas, export CSV/PDF,
  vista comparativa para authority.
- **Onboarding:** alta de vehículo + token de exhibición única + QR +
  regeneración.

**Salvedades:** `Dashboard`, `Rutas` y `Configuración` son **placeholders**
("Próximamente") — el panel es operativo pero no completo. Login requiere
migraciones aplicadas y usuarios con rol; sin eso todo login cae en
`/sin-acceso` (comportamiento esperado). No desplegado (sin proyecto
Vercel/hosting para admin-app aún).

## 5. ⚠️ Retención de datos documentada y automatizada

**Código y documento: cumplidos.** `daily_stats` + función
`aggregate_and_purge_positions()` con garantía anti-pérdida (solo purga días
ya agregados), Edge Function `purge-old-positions`, cron diario listo
(`migrations/007`). `POLITICA_DATOS.md` cubre Ley 1581/2012, tabla de
retenciones, ciclo de vida y derechos habeas data.

**Falta:**
- Aplicar 007, desplegar la Edge Function y programar los crons (purga diaria
  + poda de `auth_failures` de la 002).
- **`POLITICA_DATOS.md` tiene 2 placeholders sin llenar**: responsable del
  tratamiento y correo de contacto. Sin eso el documento no es válido para
  cumplimiento.

## 6. ⚠️ App conductor resiliente a pérdida de conexión

**Código: cumplido.** Cola FIFO persistente en Hive
(`services/offline_queue.dart`, integrada en `driver_screen.dart` —
verificado), drenaje serializado a ~1/1.2 s que respeta el rate limit,
timestamps de captura preservados (`captured_at`, migración 008), indicador
"Sin conexión — X puntos en cola" / "Enviando cola". `flutter analyze` limpio.

**Falta:** compilar e instalar el APK (`flutter build apk`) y la prueba de
campo real (modo avión → reconexión). Requiere la migración 008 aplicada.

## 7. ⚠️ Variables de entorno y secretos fuera del repo

**Estado actual verificado con `git ls-files` / `git check-ignore`:**
- ✅ Ningún `.env`, `.env.local`, keystore ni key.properties trackeado; todos
  correctamente ignorados (incluido `tunjabus-passenger.jks`). Solo
  `.env.example` (placeholders, sin valores reales) está en el repo.
- ❌ **El token viejo `TOKEN_PILOTO_PURGADO` sigue en el historial de git**
  (commit `fea6915`). El scrub con `git filter-repo` está pendiente desde la
  auditoría inicial (comandos listos, requiere force-push). Al migrar queda
  inservible, pero un secreto en historial es un hallazgo que cualquier
  auditoría de un comprador va a marcar.
- ⚠️ `TunjaBus-Passenger.apk` está **trackeado** en git (el `.gitignore`
  nuevo ignora `*.apk`, pero no des-trackea lo ya commiteado). Es un binario
  viejo del modelo inseguro. Recomendado: `git rm --cached TunjaBus-Passenger.apk`
  y distribuir APKs por releases, no en el árbol.

## 8. ❌ LICENSE agregada al repo

**No existe ningún archivo LICENSE.** No lo agrego unilateralmente: la
elección de licencia es una decisión de negocio, más aún si el plan es
**vender** — una licencia permisiva (MIT/Apache-2.0) permite a cualquiera
usar el código gratis, mientras que "todos los derechos reservados" o una
licencia comercial protegen la venta. Decide el modelo y lo agrego.

## 9. ❌ README actualizado con instrucciones reales

**Desactualizado en puntos que hoy son falsos** (verificado):
- Dice "Next.js 14" (es Next.js 16) y URL de clone placeholder
  (`github.com/TuUsuario/...`).
- El checklist de campo instruye guardar el token `TOKEN_PILOTO_PURGADO` — el
  modelo de token plano que fue **eliminado** por inseguro.
- No menciona: `admin-app`, la carpeta de migraciones, las Edge Functions,
  la política de datos, ni el flujo real de provisioning de tokens.

---

## Resumen

| # | Ítem | Estado |
|---|---|---|
| 1 | Autenticación conductores segura | ⚠️ código listo, BD sin migrar |
| 2 | Rate limiting | ⚠️ código listo, BD sin migrar |
| 3 | Multi-operador con permisos | ⚠️ código listo, BD sin migrar + sin cuentas |
| 4 | Panel admin | ⚠️ 4 áreas completas; 3 secciones placeholder; sin desplegar |
| 5 | Retención de datos | ⚠️ listo; 2 placeholders en la política + cron sin programar |
| 6 | App conductor offline | ⚠️ código listo; APK sin compilar/instalar |
| 7 | Secretos fuera del repo | ⚠️ árbol limpio; **historial con secreto** + APK trackeado |
| 8 | LICENSE | ❌ no existe |
| 9 | README | ❌ desactualizado y con placeholders |

**Ruta crítica para pasar todo a ✅:**
1. Aplicar migraciones 001–008 + pasos del `migrations/README.md` (tokens,
   usuarios, Edge Functions, crons).
2. Compilar e instalar el APK nuevo del conductor; prueba E2E de campo.
3. Scrub de historial (`git filter-repo`) + `git rm --cached` del APK +
   force-push.
4. Llenar responsable/correo en `POLITICA_DATOS.md`.
5. Elegir licencia → agregar `LICENSE`.
6. Reescribir `README.md` al estado real del proyecto.
