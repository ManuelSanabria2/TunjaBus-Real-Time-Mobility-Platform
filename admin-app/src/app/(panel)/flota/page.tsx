import { getUserRole } from "@/lib/auth";
import FlotaClient from "@/components/flota/FlotaClient";

// El layout del panel ya garantizó sesión y rol != 'none'; aquí solo se
// resuelve el rol para definir el alcance de la flota (propia vs. todas).
export default async function FlotaPage() {
  const role = await getUserRole();
  return <FlotaClient role={role} />;
}
