"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  Bus,
  Eye,
  FileBarChart,
  LayoutDashboard,
  LogOut,
  Route as RouteIcon,
  Settings,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Role } from "@/lib/auth";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  roles: Role[];
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["operator", "authority"] },
  { href: "/flota", label: "Flota", icon: Bus, roles: ["operator", "authority"] },
  { href: "/rutas", label: "Rutas", icon: RouteIcon, roles: ["operator", "authority"] },
  { href: "/reportes", label: "Reportes", icon: FileBarChart, roles: ["operator", "authority"] },
  { href: "/alertas", label: "Alertas", icon: Bell, roles: ["operator", "authority"] },
  // La Secretaría es solo lectura: no gestiona configuración.
  { href: "/configuracion", label: "Configuración", icon: Settings, roles: ["operator"] },
];

export default function Sidebar({ role, email }: { role: Role; email: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  // Contador de alertas activas. El RLS de `alerts` ya limita el conteo al
  // alcance del rol (operador: sus vehículos; Secretaría: todo). Si la
  // migración 005 no está aplicada, la consulta falla y el badge queda en 0.
  const [alertCount, setAlertCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function fetchCount() {
      const { count, error } = await supabase
        .from("alerts")
        .select("id", { count: "exact", head: true })
        .is("resolved_at", null);
      if (!cancelled && !error) setAlertCount(count ?? 0);
    }

    fetchCount();

    const channel = supabase
      .channel("sidebar:alerts")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alerts" },
        () => fetchCount()
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col bg-tinta text-piedra">
      {/* Marca */}
      <div className="flex items-center gap-3 px-6 py-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-terracota">
          <Bus size={18} />
        </div>
        <div>
          <p className="font-serif text-lg font-semibold leading-tight">Andén</p>
          <p className="text-[11px] uppercase tracking-widest text-piedra/50">
            Admin
          </p>
        </div>
      </div>

      {/* Badge de rol */}
      <div className="mx-4 mb-4 rounded-anden bg-white/5 px-4 py-3">
        <p className="truncate text-xs font-medium text-piedra/80">{email}</p>
        {role === "authority" ? (
          <p className="mt-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-salvia">
            <Eye size={12} /> Secretaría · Solo lectura
          </p>
        ) : (
          <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-terracota">
            Operador
          </p>
        )}
      </div>

      {/* Navegación filtrada por rol */}
      <nav className="flex-1 space-y-1 px-3">
        {NAV_ITEMS.filter((item) => item.roles.includes(role)).map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-anden px-3 py-2.5 text-sm font-medium transition ${
                active
                  ? "bg-terracota text-piedra shadow-anden-sm"
                  : "text-piedra/70 hover:bg-white/5 hover:text-piedra"
              }`}
            >
              <Icon size={18} />
              {item.label}
              {item.href === "/alertas" && alertCount > 0 && (
                <span className="ml-auto rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">
                  {alertCount > 99 ? "99+" : alertCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="border-t border-white/10 p-3">
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-3 rounded-anden px-3 py-2.5 text-sm font-medium text-piedra/70 transition hover:bg-white/5 hover:text-piedra"
        >
          <LogOut size={18} />
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
