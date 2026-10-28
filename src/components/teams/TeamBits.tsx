"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Star } from "lucide-react";
import { useMemo } from "react";

import { useBranches } from "@/components/rosters/RosterPeriods";
import { Badge } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";

import { TeamApiError, teamsApi, type MembershipWarning, type Team } from "./api";
import { TEAM_ERROR_TEXT, TEAM_WARNING_TEXT, roleLabel, typeLabel } from "./teamModel";

export { useBranches };

interface Entity { id: number; name?: string; code?: string }

/** Legal entities for the Home picker and the list's Home column (best effort; empty without org:read). */
export function useLegalEntities() {
  const { data } = useApi(() => api.get<Entity[]>("/legal-entities").catch(() => [] as Entity[]), []);
  return useMemo(() => {
    const items = (Array.isArray(data) ? data : []).map((e) => ({ id: Number(e.id), label: String(e.name ?? e.code ?? `Entity #${e.id}`) }));
    return { items, name: (id: number) => items.find((e) => e.id === id)?.label };
  }, [data]);
}

/** Active teams for the Parent picker and the parent name on the Details pane. */
export function useTeamOptions() {
  const { data } = useApi(() => teamsApi.list({ status: "ACTIVE", limit: 200, sort: "name" }).catch(() => null), []);
  return useMemo(() => {
    const items = (data?.items ?? []).map((t) => ({ id: t.id, label: `${t.name} (${t.code})` }));
    return { items, name: (id: number | null | undefined) => (id ? items.find((t) => t.id === id)?.label ?? `Team #${id}` : "—") };
  }, [data]);
}

const TYPE_TONE: Record<string, "primary" | "info" | "warning" | "success" | "neutral"> = {
  FUNCTIONAL: "primary", PROJECT: "info", CREW: "warning", SITE: "success", OTHER: "neutral",
};

export function TeamTypeBadge({ type }: { type: string }) {
  return <Badge tone={TYPE_TONE[type] ?? "neutral"}>{typeLabel(type)}</Badge>;
}

export function TeamStatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={status === "ACTIVE" ? "success" : "neutral"} dot data-testid="team-status" data-status={status}>
      {status === "ACTIVE" ? "Active" : status === "ARCHIVED" ? "Archived" : status}
    </Badge>
  );
}

const ROLE_TONE: Record<string, "primary" | "info" | "neutral"> = { LEAD: "primary", DEPUTY_LEAD: "info", MEMBER: "neutral" };

export function RoleChip({ role }: { role: string }) {
  return <Badge tone={ROLE_TONE[role] ?? "neutral"} data-role={role}>{roleLabel(role)}</Badge>;
}

/** The Leads cell (§15.2): ★ marks the routing lead; a warning dot when the team has no active lead. */
export function LeadsCell({ team }: { team: Pick<Team, "leads" | "warnings" | "code"> }) {
  const noLead = team.warnings.includes("NO_LEAD");
  const noRouting = team.warnings.includes("NO_ROUTING_LEAD");
  if (!team.leads.length) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        {noLead && <span className="h-2 w-2 animate-pulse rounded-full bg-warning" data-testid={`team-warning-dot-${team.code}`}
          title={TEAM_WARNING_TEXT.NO_LEAD} aria-label="No lead" />}
        No lead
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {team.leads.map((l) => (
        <span key={l.employee_id} className="inline-flex items-center gap-1">
          <span className={l.member_role === "DEPUTY_LEAD" ? "text-muted-foreground" : undefined}>
            {l.name ?? `Employee #${l.employee_id}`}{l.member_role === "DEPUTY_LEAD" ? " (deputy)" : ""}
          </span>
          {l.routing && <Star className="h-3.5 w-3.5 fill-warning text-warning" aria-label="Routing lead" />}
        </span>
      ))}
      {noRouting && <span className="h-2 w-2 rounded-full bg-warning" title={TEAM_WARNING_TEXT.NO_ROUTING_LEAD} aria-label="No routing lead" />}
    </span>
  );
}

/** Team warnings (NO_LEAD, NO_ROUTING_LEAD) or membership warnings (ABOVE_LEAD, DEPUTY_CANNOT_APPROVE). */
export function WarningList({ warnings }: { warnings: (string | MembershipWarning)[] }) {
  const list = warnings.map((w) => (typeof w === "string" ? { code: w, message: TEAM_WARNING_TEXT[w] ?? w } : w));
  return (
    <AnimatePresence initial>
      {list.length > 0 && (
        <motion.ul initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-2">
          {list.map((w) => (
            <li key={w.code} data-testid={`team-warning-${w.code}`} data-code={w.code} role="status"
              className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning-soft px-3 py-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              <span>{w.message}</span>
            </li>
          ))}
        </motion.ul>
      )}
    </AnimatePresence>
  );
}

/** A refusal in plain words; `data-code` keeps the API code (MEMBERSHIP_OVERLAP, TEAM_IN_USE, NOT_ELIGIBLE…). */
export function TeamErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  const status = (error as { status?: number })?.status;
  const raw = error instanceof TeamApiError ? error.code : (error as { code?: string })?.code;
  const code = raw ?? (status === 403 ? "FORBIDDEN" : undefined);
  const serverMessage = error instanceof Error ? error.message : "";
  // A 403 carries the server's own sentence ("Only HR or a team administrator can change leads").
  const message = status === 403 && serverMessage ? serverMessage
    : (code && TEAM_ERROR_TEXT[code]) || serverMessage || "Something went wrong.";
  const reasons = error instanceof TeamApiError && Array.isArray(error.details?.reasons) ? (error.details!.reasons as string[]) : [];
  return (
    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} role="alert"
      className="space-y-1 rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm" data-testid="team-error" data-code={code}>
      <p className="font-medium text-danger">{message}</p>
      {serverMessage && serverMessage !== message && <p className="text-muted-foreground">{serverMessage}</p>}
      {reasons.length > 0 && <p className="text-muted-foreground">{reasons.join(" · ")}</p>}
      {code && <p className="font-mono text-xs text-muted-foreground">{code}</p>}
    </motion.div>
  );
}
