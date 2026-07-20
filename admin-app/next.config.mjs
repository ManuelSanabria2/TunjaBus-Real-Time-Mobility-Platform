/** @type {import('next').NextConfig} */
// A diferencia de user-app, este proyecto NO usa output: 'export' —
// la protección de rutas (proxy.ts) y la sesión por cookies requieren servidor.
const nextConfig = {
  // Hay un package-lock.json extraviado en el home del usuario; sin esto Next
  // infiere mal el workspace root (y ese node_modules fantasma contamina la
  // resolución de tipos).
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
