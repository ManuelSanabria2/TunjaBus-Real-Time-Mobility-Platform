import { getUserRole } from "@/lib/auth";
import AlertasClient from "@/components/alertas/AlertasClient";

export default async function AlertasPage() {
  const role = await getUserRole();
  return <AlertasClient role={role} />;
}
