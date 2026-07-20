import { getUserRole } from "@/lib/auth";
import PagePlaceholder from "@/components/PagePlaceholder";

export default async function RutasPage() {
  const role = await getUserRole();
  return (
    <PagePlaceholder
      title="Rutas"
      description={
        role === "authority"
          ? "Rutas y paraderos de todas las cooperativas (solo lectura)."
          : "Las rutas y paraderos de tu cooperativa."
      }
    />
  );
}
