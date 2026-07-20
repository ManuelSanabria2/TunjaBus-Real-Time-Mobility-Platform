import { getUserRole } from "@/lib/auth";
import ReportesClient from "@/components/reportes/ReportesClient";

export default async function ReportesPage() {
  const role = await getUserRole();
  return <ReportesClient role={role} />;
}
