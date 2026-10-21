"use client";

import type { ReactNode } from "react";

import { ScopeBar, type ScopeSelection, type ScopeTarget } from "@/components/payroll/ScopeBar";
import { can, canAny, companyWide } from "@/lib/access";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";
import type { ScopeLevel } from "@/lib/settings.generated";
import type { Me } from "@/lib/types";

import type { EditableScope, ScopeOption, ScopeOptions, ScopeRef } from "./types";

interface AccessPreview {
  permissions: { permission: string; grants: { scope: string; targets?: { id: number; name: string }[] }[] }[];
}

function targetsOf(preview: AccessPreview | undefined, code: string, scope: string): ScopeOption[] {
  const perm = preview?.permissions.find((p) => p.permission === code);
  return (perm?.grants ?? []).filter((g) => g.scope === scope).flatMap((g) => g.targets ?? []);
}

/**
 * The scopes this user may open in Settings › Payroll. Company-wide configuration readers see every
 * entity, branch and pay group the API lists; entity- or pay-group-scoped readers see their own
 * targets (from the access preview), since `/legal-entities` needs `org:read`.
 */
export function useScopeOptions(me: Me | null): ScopeOptions {
  const companyReader = companyWide(me, P.PAYROLL_CONFIGURATION_READ);
  const orgEntities = canAny(me, [P.ORG_READ, P.ORG_MANAGE_ENTITIES]);
  const orgBranches = canAny(me, [P.ORG_READ, P.ORG_MANAGE_BRANCHES, P.EMPLOYEE_CREATE]);
  const preview = useApi(() => api.get<AccessPreview>("/payroll/access-preview"), [], { enabled: !!me && !companyReader });
  const entities = useApi(() => api.get<{ id: number; legal_name: string }[]>("/legal-entities"), [], { enabled: !!me && orgEntities });
  const branches = useApi(() => api.get<{ id: number; name: string; legal_entity_id: number | null }[]>("/branches"), [], {
    enabled: !!me && orgBranches,
  });
  const groups = useApi(
    () => api.get<{ id: number; name: string; legal_entity_id: number | null; status: string }[]>("/payroll/org/pay-groups"),
    [],
    { enabled: !!me && can(me, P.PAYROLL_CONFIGURATION_READ) },
  );

  const entityTargets = targetsOf(preview.data, P.PAYROLL_CONFIGURATION_READ, "LEGAL_ENTITY");
  const groupTargets = new Set(targetsOf(preview.data, P.PAYROLL_CONFIGURATION_READ, "PAY_GROUP").map((t) => t.id));
  const allowedEntity = (id: number | null | undefined) => companyReader || entityTargets.some((t) => t.id === id);

  let entityOptions: ScopeOption[] = companyReader
    ? (entities.data ?? []).map((e) => ({ id: e.id, name: e.legal_name }))
    : entityTargets.map((t) => ({ id: t.id, name: t.name }));
  if (companyReader && !orgEntities) {
    // Without org:read the entity names are not listed: fall back to the pay groups' entities.
    const ids = Array.from(new Set((groups.data ?? []).map((g) => g.legal_entity_id).filter((v): v is number => !!v)));
    entityOptions = ids.map((id) => ({ id, name: `Legal entity ${id}` }));
  }
  return {
    tenantEditable: companyWide(me, P.PAYROLL_CONFIGURATION_WRITE),
    entities: entityOptions,
    branches: (branches.data ?? [])
      .filter((b) => allowedEntity(b.legal_entity_id))
      .map((b) => ({ id: b.id, name: b.name, legal_entity_id: b.legal_entity_id })),
    payGroups: (groups.data ?? [])
      .filter((g) => g.status !== "ARCHIVED" && (companyReader || allowedEntity(g.legal_entity_id) || groupTargets.has(g.id)))
      .map((g) => ({ id: g.id, name: g.name, legal_entity_id: g.legal_entity_id })),
    loading: preview.loading || entities.loading || branches.loading || groups.loading,
  };
}

export function optionsFor(options: ScopeOptions, level: EditableScope): ScopeOption[] {
  if (level === "LEGAL_ENTITY") return options.entities;
  if (level === "BRANCH") return options.branches;
  if (level === "PAY_GROUP") return options.payGroups;
  return [];
}

/**
 * Which level is being edited: Tenant / Legal entity / Branch / Pay group (3.8 §5.16), on the shared
 * `components/payroll/ScopeBar`. Branch and pay-group names carry their entity when known.
 */
export function SettingsScopeBar({
  value,
  onChange,
  levels,
  options,
  actions,
}: {
  value: ScopeRef;
  onChange: (scope: ScopeRef) => void;
  levels: EditableScope[];
  options: ScopeOptions;
  actions?: ReactNode;
}) {
  const shown: EditableScope[] = Array.from(new Set<EditableScope>(["TENANT", ...levels]));
  const entityName = (entityId: number | null | undefined) => options.entities.find((e) => e.id === entityId)?.name;
  const targets: Partial<Record<ScopeLevel, ScopeTarget[]>> = {};
  for (const level of shown) {
    if (level === "TENANT") continue;
    targets[level] = optionsFor(options, level).map((o) => {
      const entity = level !== "LEGAL_ENTITY" ? entityName(o.legal_entity_id) : undefined;
      return { id: String(o.id), label: entity ? `${o.name} · ${entity}` : o.name };
    });
  }
  const selection: ScopeSelection = {
    level: value.scope_type,
    targetId: value.scope_type === "TENANT" || !value.scope_id ? null : String(value.scope_id),
  };
  return (
    <ScopeBar
      value={selection}
      levels={shown}
      targets={targets}
      // Every configuration reader may view company-level values; editing them is checked per control.
      tenantAllowed
      actions={actions}
      onChange={(next) => {
        if (next.level === "TENANT" || !next.targetId) return onChange({ scope_type: "TENANT", scope_id: null, name: "Company" });
        const level = next.level as EditableScope;
        const found = optionsFor(options, level).find((o) => String(o.id) === next.targetId);
        if (found) onChange({ scope_type: level, scope_id: found.id, name: found.name });
      }}
    />
  );
}
