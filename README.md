#  TunjaBus - Sistema de Movilidad en Tiempo Real

TunjaBus es una plataforma de código abierto diseñada para rastrear y visualizar la posición de los autobuses de transporte público de Tunja, Colombia, en tiempo real. Este MVP está compuesto por una App móvil para conductores y un panel web interactivo para los usuarios.

## Arquitectura
*   **Backend (BaaS):** Supabase (PostgreSQL + Realtime + RLS).
*   **Frontend Web:** Next.js 14, React, Leaflet, Tailwind/CSS.
*   **App Conductor:** Flutter, Geolocator, Supabase SDK.

---

##  Setup Local y Ejecución

### 1. Clonar e Instalar Dependencias
```bash
git clone https://github.com/TuUsuario/Transitobusestunja.git
cd Transitobusestunja/user-app
npm install
```

### 2. Configurar Variables de Entorno
Copia el archivo `.env.example` ubicado en la raíz, pégalo dentro de la carpeta `user-app` y renómbralo a `.env.local`. Llena las variables con las URLs y Keys proporcionadas por tu panel de Supabase.

### 3. Cargar Paraderos de la Ciudad (OSM)
Asegúrate de llenar el `SUPABASE_SERVICE_ROLE_KEY` en un `.env.local` y ejecuta el motor de OpenStreetMap para sembrar la base de datos:
```bash
cd scripts
node load-stops.js
```

### 4. Ejecutar Entorno de Desarrollo (Web)
```bash
cd user-app
npm run dev
```
Dirígete a [http://localhost:3000](http://localhost:3000).

---

##  Instrucciones de Deploy en Vercel

1. Inicia sesión en [Vercel](https://vercel.com) y conecta tu repositorio de GitHub.
2. Selecciona la carpeta **`user-app`** como el "Root Directory" (Directorio raíz).
3. Vercel detectará el framework automáticamente gracias al `vercel.json`.
4. En **Environment Variables**, añade:
    *   `NEXT_PUBLIC_SUPABASE_URL`
    *   `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. Ejecuta **Deploy**.

---

##  Checklist de Prueba en Campo MVP

Antes de iniciar operaciones comerciales o de prueba, asegúrate de:

- [ ] **RLS Verificado:** Nadie debe poder escribir en `vehicle_positions` excepto los choferes, pero todos deben poder leer las posiciones. Comprobado en panel Supabase.
- [ ] **Token Seguro:** El `Driver Token` (Ej: `BUS01_TOKEN_SECRET`) debe estar guardado en las SharedPreferences de la app del Conductor.
- [ ] **Ruta Piloto:** Los paraderos específicos de la ruta piloto deben existir en la tabla `stops`.
- [ ] **Deploy Web Activo:** El Frontend debe estar desplegado y operando por HTTPS a través del enlace generado por Vercel.
- [ ] **APK Instalado:** El archivo *.apk* generado con `flutter build apk` debe estar instalado en el Android a bordo del sistema, provisto de plan de datos activo y permisos de "Ubicación Todo el Tiempo".
