"use client";

import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Sesión válida pero sin rol: el usuario no figura en operator_members ni en
// authority_users (o las migraciones 001–003 aún no se aplicaron en Supabase).
export default function SinAccesoPage() {
  const router = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-anden-lg bg-white p-10 text-center shadow-anden-md">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-terracota-soft text-terracota">
          <ShieldAlert size={28} />
        </div>
        <h1 className="mb-2 font-serif text-2xl font-semibold text-tinta">
          Cuenta sin rol asignado
        </h1>
        <p className="mb-8 text-sm leading-relaxed text-niebla">
          Tu sesión es válida, pero esta cuenta no pertenece a ninguna
          cooperativa ni a la Secretaría de Movilidad. Contacta al
          administrador del sistema para que te asigne un rol.
        </p>
        <button
          onClick={handleSignOut}
          className="rounded-anden bg-tinta px-6 py-2.5 text-sm font-bold text-piedra transition hover:bg-tinta-soft"
        >
          Cerrar sesión
        </button>
      </div>
    </main>
  );
}
