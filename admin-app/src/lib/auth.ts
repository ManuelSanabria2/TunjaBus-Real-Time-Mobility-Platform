import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

export type Role = "authority" | "operator" | "none";

/**
 * Resuelve el rol del usuario autenticado consultando la BD — la fuente de
 * verdad son las tablas de la migración 003, expuestas como RPC a
 * `authenticated`:
 *   - is_authority()        -> true si está en authority_users (Secretaría)
 *   - member_operator_ids() -> operadores donde figura en operator_members
 * No se duplica ninguna lógica de roles en el frontend.
 */
export async function getUserRole(): Promise<Role> {
  const supabase = await createClient();

  const { data: isAuthority } = await supabase.rpc("is_authority");
  if (isAuthority === true) return "authority";

  const { data: operatorIds } = await supabase.rpc("member_operator_ids");
  if (Array.isArray(operatorIds) && operatorIds.length > 0) return "operator";

  return "none";
}

/**
 * Guard para páginas restringidas por rol. Redirige al Dashboard si el rol
 * actual no está permitido; devuelve el rol si sí lo está.
 */
export async function requireRole(allowed: Role[]): Promise<Role> {
  const role = await getUserRole();
  if (!allowed.includes(role)) {
    redirect("/");
  }
  return role;
}
