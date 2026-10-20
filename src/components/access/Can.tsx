"use client";

import type { ReactNode } from "react";

import { AccessDenied } from "@/components/ui/layout";
import { can, canAny } from "@/lib/access";
import type { PermissionCode, Scope } from "@/lib/permissions.generated";
import type { Me } from "@/lib/types";
import { useSession } from "@/store/session";

/** Hook form of the permission check (UI only; the API enforces independently). */
export function useCan() {
  const me = useSession((s) => s.me);
  return {
    me,
    can: (code: PermissionCode, scope?: Scope) => can(me, code, scope),
    canAny: (codes: PermissionCode[]) => canAny(me, codes),
  };
}

export function Can({
  permission,
  scope,
  anyOf,
  children,
  fallback = null,
}: {
  permission?: PermissionCode;
  scope?: Scope;
  anyOf?: PermissionCode[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const me = useSession((s) => s.me);
  const allowed = permission ? can(me, permission, scope) : anyOf ? canAny(me, anyOf) : false;
  return <>{allowed ? children : fallback}</>;
}

/** Page-level guard: shows a clear access-denied state instead of a broken page. */
export function RequireAccess({ check, children }: { check: (me: Me) => boolean; children: ReactNode }) {
  const me = useSession((s) => s.me);
  if (!me) return null;
  return <>{check(me) ? children : <AccessDenied />}</>;
}
