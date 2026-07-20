import { requireRole } from "@/lib/auth";
import PagePlaceholder from "@/components/PagePlaceholder";

// Solo operadores: la Secretaría es de solo lectura y no gestiona configuración.
// requireRole redirige al Dashboard a cualquier otro rol (defensa en profundidad
// además de que el Sidebar no muestra el enlace).
export default async function ConfiguracionPage() {
  await requireRole(["operator"]);
  return (
    <PagePlaceholder
      title="Configuración"
      description="Datos de tu cooperativa, miembros del equipo y preferencias del panel."
    />
  );
}
