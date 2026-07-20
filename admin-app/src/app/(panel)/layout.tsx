import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";

// Autorización del panel (server-side). El proxy ya garantizó que hay sesión;
// aquí se resuelve el rol contra la BD y se bloquea a quien no tenga ninguno.
export default async function PanelLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Defensa en profundidad: el proxy ya redirige, pero no dependemos solo de él.
  if (!user) redirect("/login");

  const role = await getUserRole();
  if (role === "none") redirect("/sin-acceso");

  return (
    <div className="flex min-h-screen">
      <Sidebar role={role} email={user.email ?? ""} />
      <main className="flex-1 overflow-y-auto p-10">{children}</main>
    </div>
  );
}
