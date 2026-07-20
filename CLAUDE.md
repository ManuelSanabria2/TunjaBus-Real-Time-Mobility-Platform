# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

TunjaBus (brand name **"Andén"**) is a real-time public-bus tracking MVP for Tunja, Colombia. It is a monorepo of three cooperating apps plus supporting scripts, all wired together through a single Supabase project. There is no custom backend server — Supabase (Postgres + Realtime + RLS) is the entire backend.

- `user-app/` — Passenger app. Next.js 16 + React 19, Leaflet map. Runs as a website **and** as a Capacitor Android APK (appId `com.tunjabus.passenger`).
- `admin-app/` — Admin panel for cooperatives ("operator") and the Secretaría de Movilidad ("authority", read-only). Next.js 16 + React 19 + Tailwind v4, Supabase Auth login. **Not** a static export (needs a server): route protection lives in `src/proxy.ts` (Next 16 renamed `middleware.ts` → `proxy.ts`), and role resolution happens server-side in `src/app/(panel)/layout.tsx` via the DB RPCs `is_authority()` / `member_operator_ids()` from migration 003 — never duplicate role logic in the frontend.
- `driver-app/` — Driver app. Flutter (Android). Emits GPS position to Supabase.
- `backend/supabase/schema.sql` — The full database schema, RLS policies, and seed data. Applied by hand in the Supabase SQL editor (no migration tooling).
- `scripts/` — Node script to seed the `stops` table from OpenStreetMap/Overpass data.
- `INSTRUCCIONES.MD` — The original design spec (Spanish). The single best reference for business logic and intended architecture.

Docs and code comments are largely in Spanish; keep that convention.

## Architecture: the real-time data flow

```
driver-app (Flutter)  ──INSERT vehicle_positions──►  Supabase (Postgres + Realtime + RLS)  ──postgres_changes stream──►  user-app (BusMap.tsx)
```

1. **Driver emits.** `driver-app/lib/services/gps_service.dart` reads the raw GPS stream, runs lat/lon through a Kalman filter (`kalman_filter.dart`) to cut jitter, then throttles: it only emits a position when the bus moved more than `min_distance` meters OR `max_interval` seconds have passed (a heartbeat). Both thresholds are user-tunable and stored in `SharedPreferences` (defaults 2 m / 5 s). Emitted positions are `INSERT`ed via `supabase_service.dart`.
2. **RLS gates writes.** Anyone can `SELECT` all tables (public read). Writes to `vehicle_positions` are only allowed for a row whose `vehicle_id` maps to a secret per-vehicle `token`. The driver looks up its `vehicle_id` from its token at startup (`getVehicleIdByToken`). Tokens live in the driver's `SharedPreferences`, never in the repo.
3. **Passenger renders.** `user-app/src/components/BusMap.tsx` is the heart of the passenger app — a single large client component. It loads stops + initial positions, subscribes to `postgres_changes` INSERTs on `vehicle_positions`, tracks **all** buses by `vehicle_id` in a `Map`, and picks the nearest bus to the user via Haversine distance. A ~30 fps `setInterval` animation loop smoothly eases each marker's rendered position toward its latest real position (interpolation constant `SMOOTHING_FACTOR = 0.15`) so markers glide instead of jumping.

Because `BusMap` uses `window`/Leaflet, it is loaded with `next/dynamic` and `ssr: false` from `page.tsx`. Never import it in a way that runs during SSR.

### Key geometry / routing helpers (`user-app/src/lib/`)
- `geo.ts` — Haversine distance, position interpolation, `Stop` type.
- `routes.ts` — Hardcoded catalog of Tunja routes as named landmark waypoints (`ROUTE_DEFINITIONS`). These are approximate coordinates, not from the DB.
- `routing.ts` — `getRoadSnappedRoute()` turns waypoints into a road-following polyline by calling the **public OSRM demo server** (`router.project-osrm.org`), with an in-memory cache and a straight-line fallback when OSRM fails.

## Database

Core tables (GTFS-inspired): `routes`, `stops`, `vehicles`, `vehicle_positions`, plus `operators`/`operator_members`/`authority_users` (multi-operator roles) and `vehicle_rate_limit`/`auth_failures` (abuse protection). Realtime is enabled only on `vehicle_positions`. `vehicles` holds no personal data and no plaintext secret — only an anonymous `label` and a SHA-256 `token_hash`; position writes go exclusively through the `insert_vehicle_position()` SECURITY DEFINER RPC (direct INSERT is blocked by RLS).

Schema changes live in two places that must stay in sync: `backend/supabase/schema.sql` (canonical, clean installs only) and `backend/supabase/migrations/` (numbered incremental migrations for an existing database — see its README for apply order and post-steps). Both are applied by hand in the Supabase SQL editor; there is no automated migration runner.

## Environment variables — three different setups

The two apps read the **same Supabase project** but use **different variable names**. Do not copy names between them.

| Location | File | Variables |
|---|---|---|
| `user-app/` | `.env.local` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `driver-app/` | `.env` (bundled as a Flutter asset) | `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| `scripts/` | reads `../user-app/.env.local` | also needs `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS for seeding) |

Root `.env.example` documents all of them. The service role key is only ever used from `scripts/`, never in client code.

## Common commands

### Passenger web app (`user-app/`)
```bash
npm install
npm run dev      # dev server → http://localhost:3000
npm run build    # static export (next.config.mjs sets output: 'export' → ./out)
npm run lint     # eslint
```
Note: `next.config.mjs` sets `typescript.ignoreBuildErrors: true`, so a green build does **not** mean the types are clean — check types separately if it matters.

### Passenger Android APK (Capacitor, from `user-app/`)
The APK wraps the static export in `out/`. Rebuild flow:
```bash
npm run build              # regenerate ./out
npx cap sync android       # copy web assets into the Android project
npx cap open android       # then build the APK in Android Studio
```
App icons are generated by `generate-icons.js` (uses `sharp`).

### Admin panel (`admin-app/`)
```bash
npm install
npm run dev        # dev server → http://localhost:3001 (user-app uses 3000)
npm run build
npm run lint
npm run typecheck  # tsc --noEmit — build errors are NOT ignored here, unlike user-app
```
Env: `.env.local` with the same `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` as user-app (see `.env.local.example`). Logging in requires the migrations in `backend/supabase/migrations/` to be applied and the user to exist in `operator_members` or `authority_users`; otherwise every login lands on `/sin-acceso`.

### Driver app (`driver-app/`, Flutter)
```bash
flutter pub get
flutter run                # run on a connected device/emulator
flutter build apk          # release APK
flutter analyze            # lint (analysis_options.yaml → flutter_lints)
flutter test               # tests (flutter_test)
```

### Seed stops (`scripts/`)
```bash
node load-stops.js <route_id>   # requires stops_tunja.json (exported from Overpass Turbo) in scripts/
```
The route_id argument is required despite what the README implies.

### Deploy
The passenger web app deploys to Vercel with `user-app/` as the root directory. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel env vars.

## Design system: "Andén"

Both apps share the Andén visual language — a warm, flat, non-neon palette. Reuse these tokens rather than inventing colors.

| Token | Hex | Role |
|---|---|---|
| Tinta | `#1C2632` | Primary text, heavy elements |
| Terracota | `#B5603A` | Primary accent / highlights |
| Salvia | `#5C8265` | Success, "nearest bus" |
| Piedra | `#F3EFE9` | Warm background (replaces pure white) |
| Niebla | `#8C867E` | Secondary text, soft borders |

In `user-app` these are CSS variables (`--anden-*`) plus radius/shadow/transition tokens defined in `src/app/globals.css`; fonts are Fraunces (serif) and Plus Jakarta Sans (sans). In `driver-app` the same hex values are set in the `MaterialApp` theme in `lib/main.dart`. Bus/user marker icons in `BusMap.tsx` are inline SVG data-URIs using these colors (note `#` is URL-encoded as `%23` inside the SVG strings).

## Next.js version caution

`user-app/AGENTS.md` (referenced by `user-app/CLAUDE.md`) warns that this is Next.js 16 with breaking changes vs. older training data. Before writing Next.js code, consult `user-app/node_modules/next/dist/docs/` and heed deprecation notices rather than assuming older App Router conventions.
