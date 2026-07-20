"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bus, KeyRound, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError(
        signInError.message === "Invalid login credentials"
          ? "Correo o contraseña incorrectos."
          : signInError.message
      );
      setLoading(false);
      return;
    }

    // El proxy y el layout del panel resuelven el rol; solo navegamos.
    router.push("/");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-tinta text-piedra shadow-anden-md">
            <Bus size={28} />
          </div>
          <h1 className="font-serif text-3xl font-semibold text-tinta">
            Andén Admin
          </h1>
          <p className="text-sm text-niebla">
            Gestión de flota para cooperativas y Secretaría de Movilidad
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-anden-lg bg-white p-8 shadow-anden-md"
        >
          <label className="mb-1 block text-sm font-semibold text-tinta">
            Correo
          </label>
          <div className="relative mb-5">
            <Mail
              size={18}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-niebla"
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              required
              autoComplete="email"
              placeholder="tu@cooperativa.co"
              className="w-full rounded-anden border border-niebla/30 bg-piedra/40 py-2.5 pl-10 pr-3 text-sm text-tinta outline-none transition focus:border-terracota focus:bg-white"
            />
          </div>

          <label className="mb-1 block text-sm font-semibold text-tinta">
            Contraseña
          </label>
          <div className="relative mb-6">
            <KeyRound
              size={18}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-niebla"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className="w-full rounded-anden border border-niebla/30 bg-piedra/40 py-2.5 pl-10 pr-3 text-sm text-tinta outline-none transition focus:border-terracota focus:bg-white"
            />
          </div>

          {error && (
            <p className="mb-4 rounded-anden bg-terracota-soft px-4 py-2.5 text-sm font-medium text-terracota">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-anden bg-terracota py-3 text-sm font-bold text-piedra shadow-anden-sm transition hover:brightness-110 disabled:opacity-60"
          >
            {loading ? "Ingresando…" : "Ingresar"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-niebla">
          ¿Sin cuenta? El acceso lo asigna el administrador del sistema.
        </p>
      </div>
    </main>
  );
}
