import { getUserRole } from "@/lib/auth";
import PagePlaceholder from "@/components/PagePlaceholder";

export default async function DashboardPage() {
  const role = await getUserRole();
  return (
    <PagePlaceholder
      title="Dashboard"
      description={
        role === "authority"
          ? "Vista general del sistema: todas las cooperativas, en modo solo lectura."
          : "Vista general de tu cooperativa: flota activa, rutas y actividad reciente."
      }
    />
  );
}
