import { createBrowserClient } from "@supabase/ssr";

// Cliente para componentes "use client" (mismo patrón que user-app).
export const createClient = () =>
  createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
