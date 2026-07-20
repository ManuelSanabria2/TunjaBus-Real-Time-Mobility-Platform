import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Cliente para Server Components / Server Actions.
// En Next 16 cookies() es async, de ahí el await.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Llamado desde un Server Component: ignorable, el proxy
            // se encarga de refrescar la sesión.
          }
        },
      },
    }
  );
}
