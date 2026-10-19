import type { PermissionCode, Scope } from "./permissions.generated";
import type { Me } from "./types";

/**
 * UI-only permission helpers. These decide what to *show*; the API enforces
 * every rule independently, so a stale or tampered client cannot gain access.
 * Scope semantics mirror app/core/permission_registry.scope_covers.
 */
export function scopesOf(me: Me | null | undefined, code: PermissionCode): Scope[] {
  return (me?.permissions?.[code] as Scope[] | undefined) ?? [];
}

export function can(me: Me | null | undefined, code: PermissionCode, scope?: Scope): boolean {
  const held = scopesOf(me, code);
  if (held.length === 0) return false;
  if (!scope) return true;
  if (held.includes("COMPANY") || held.includes(scope)) return true;
  return scope === "DIRECT_REPORTS" && held.includes("REPORTING_TREE");
}

export function canAny(me: Me | null | undefined, codes: PermissionCode[]): boolean {
  return codes.some((c) => can(me, c));
}

/** True when the permission reaches beyond the user's own records. */
export function canBeyondSelf(me: Me | null | undefined, code: PermissionCode): boolean {
  return scopesOf(me, code).some((s) => s !== "SELF");
}

export function companyWide(me: Me | null | undefined, code: PermissionCode): boolean {
  return scopesOf(me, code).includes("COMPANY");
}
