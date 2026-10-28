"use client";

import { motion } from "framer-motion";
import { Plus, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { WorkspaceHeader } from "@/components/payroll/inputs/shared";
import { FilterBar, type FilterChip } from "@/components/shared/FilterBar";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { DataTable, EmptyState, ErrorState, Pagination, type Column } from "@/components/ui/layout";
import { Card, MotionSafe } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { cn } from "@/lib/cn";
import { useApi } from "@/lib/hooks";
import { P } from "@/lib/permissions.generated";
import { useModalRoute } from "@/lib/useModalRoute";

import { TEAM_TYPES, teamsApi, type Team } from "./api";
import { LeadsCell, TeamTypeBadge, useBranches, useLegalEntities } from "./TeamBits";
import { TeamFormModal } from "./TeamForm";
import { TEAM_TYPE_LABEL, TEAM_VIEWS, homeText, teamListParams, type TeamFilters, type TeamView } from "./teamModel";

const EMPTY: TeamFilters = { q: "", team_type: "", status: "ACTIVE", has_lead: "" };
const HAS_LEAD_LABEL: Record<string, string> = { yes: "Has a lead", no: "No lead" };

/** View tabs with a sliding highlight (motion ≤ 400 ms; none under reduced motion). */
function ViewTabs({ value, onChange }: { value: TeamView; onChange: (v: TeamView) => void }) {
  const id = useId();
  return (
    <MotionSafe>
      <div role="tablist" aria-label="Views" className="inline-flex flex-wrap gap-1 rounded-2xl border border-border bg-surface-muted p-1">
        {TEAM_VIEWS.map((v) => (
          <button key={v.value} type="button" role="tab" aria-selected={value === v.value} data-testid={`team-view-${v.value}`}
            onClick={() => onChange(v.value)}
            className={cn("relative rounded-xl px-3.5 py-1.5 text-sm font-medium transition-colors",
              value === v.value ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {value === v.value && (
              <motion.span layoutId={`team-view-${id}`} className="absolute inset-0 rounded-xl bg-surface shadow-sm"
                transition={{ type: "spring", stiffness: 420, damping: 34 }} />
            )}
            <span className="relative">{v.label}</span>
          </button>
        ))}
      </div>
    </MotionSafe>
  );
}

/**
 * `/teams` (X 01 §15.2): teams with search, Type / Branch / Status / Has-lead filters and the views All · Teams I lead
 * · Without a lead · Crews. A row opens the team page; "+ New team" (`team:manage`) opens `TeamForm` in a Modal
 * (`?modal=team`).
 */
export function TeamsWorkspace() {
  const { me } = useCan();
  const router = useRouter();
  const manage = can(me, P.TEAM_MANAGE);
  const create = useModalRoute("team", { keys: ["id"] });
  const branches = useBranches();
  const entities = useLegalEntities();
  const [view, setView] = useState<TeamView>("all");
  const [filters, setFilters] = useState<TeamFilters>(EMPTY);
  const [branch, setBranch] = useState("");
  const [search, setSearch] = useState("");
  const [skip, setSkip] = useState(0);
  const limit = 25;
  // Search is server-side; wait for a pause in typing.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((f) => (f.q === search ? f : { ...f, q: search }));
      setSkip(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const params = { ...teamListParams(view, filters, skip, limit), branch_id: branch ? Number(branch) : undefined };
  const { data, error, loading, reload } = useApi(() => teamsApi.list(params), [JSON.stringify(params)]);

  const setFilter = (key: keyof TeamFilters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setSkip(0);
  };
  const chips: FilterChip[] = [
    ...(filters.team_type && view !== "crews" ? [{ key: "team_type", label: "Type", values: [TEAM_TYPE_LABEL[filters.team_type as keyof typeof TEAM_TYPE_LABEL] ?? filters.team_type] }] : []),
    ...(filters.status ? [{ key: "status", label: "Status", values: [filters.status === "ACTIVE" ? "Active" : "Archived"] }] : []),
    ...(filters.has_lead && view !== "no-lead" ? [{ key: "has_lead", label: "Lead", values: [HAS_LEAD_LABEL[filters.has_lead]] }] : []),
    ...(branch ? [{ key: "branch", label: "Branch", values: [branches.name(Number(branch))] }] : []),
  ];
  const removeChip = (key: string) => {
    if (key === "branch") setBranch("");
    else setFilter(key as keyof TeamFilters, "");
    setSkip(0);
  };

  const columns: Column<Team>[] = [
    { key: "code", header: "Code", primary: true, hideable: false,
      cell: (t) => <span className="font-mono font-semibold" data-testid={`team-row-${t.code}`} data-team-id={t.id}>{t.code}</span> },
    { key: "name", header: "Name", cell: (t) => (
      <span className={cn(t.status === "ARCHIVED" && "text-muted-foreground line-through decoration-muted-foreground/40")}>{t.name}</span>
    ) },
    { key: "type", header: "Type", cell: (t) => <TeamTypeBadge type={String(t.team_type)} /> },
    { key: "home", header: "Home", hideOnMobile: true, cell: (t) => homeText(t, (id) => branches.items.find((b) => b.id === id)?.label, entities.name) },
    { key: "leads", header: "Leads", cell: (t) => <LeadsCell team={t} /> },
    { key: "members", header: "Members", className: "text-right tabular-nums", cell: (t) => t.member_count ?? "—" },
  ];

  return (
    <div>
      <WorkspaceHeader eyebrow="People" title="Teams" showHideAmounts={false}
        description="Project, functional, crew and site teams: who leads them, who belongs, and where approvals go."
        actions={manage && (
          <Button data-testid="open-new-team" onClick={() => create.openModal()}>
            <Plus className="h-4 w-4" aria-hidden /> New team
          </Button>
        )} />
      <Card>
        <FilterBar resultCount={data?.total}
          views={<ViewTabs value={view} onChange={(v) => { setView(v); setSkip(0); }} />}
          search={{ value: search, onChange: setSearch, placeholder: "Search teams…", label: "Search teams by name or code" }}
          chips={chips} onRemoveChip={removeChip}
          onClearAll={() => { setFilters({ ...EMPTY, status: "" }); setSearch(""); setBranch(""); setSkip(0); }}>
          {view !== "crews" && (
            <Field label="Type" className="w-40">
              <Select data-testid="teams-filter-type" value={filters.team_type} onChange={(e) => setFilter("team_type", e.target.value)}>
                <option value="">All types</option>
                {TEAM_TYPES.map((t) => <option key={t} value={t}>{TEAM_TYPE_LABEL[t]}</option>)}
              </Select>
            </Field>
          )}
          {branches.items.length > 1 && (
            <Field label="Branch" className="w-44">
              <Select data-testid="teams-filter-branch" value={branch} onChange={(e) => { setBranch(e.target.value); setSkip(0); }}>
                <option value="">All branches</option>
                {branches.items.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Status" className="w-36">
            <Select data-testid="teams-filter-status" value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="ARCHIVED">Archived</option>
            </Select>
          </Field>
          {view !== "no-lead" && (
            <Field label="Has lead" className="w-36">
              <Select data-testid="teams-filter-lead" value={filters.has_lead} onChange={(e) => setFilter("has_lead", e.target.value)}>
                <option value="">Any</option>
                <option value="yes">Has a lead</option>
                <option value="no">No lead</option>
              </Select>
            </Field>
          )}
        </FilterBar>
        <div data-testid="teams-table">
          {error ? <ErrorState message={error.message} onRetry={reload} /> : (
            <DataTable columns={columns} rows={data?.items} loading={loading && !data} busy={loading && !!data} rowKey={(t) => t.id}
              rowHref={(t) => `/teams/${t.id}`} onRowClick={(t) => router.push(`/teams/${t.id}`)} caption="Teams"
              empty={<EmptyState icon={<UsersRound />} title={view === "mine" ? "You don't lead any team" : "No teams here"}
                description={manage ? "Create a team to group people for approvals and rosters." : "Nothing matches these filters."}
                action={manage && view === "all" ? <Button variant="secondary" onClick={() => create.openModal()}>
                  <Plus className="h-4 w-4" aria-hidden /> New team</Button> : undefined} />} />
          )}
        </div>
        {data && <Pagination total={data.total} skip={skip} limit={limit} onChange={setSkip} />}
      </Card>
      {manage && (
        <TeamFormModal open={create.open} onOpenChange={(o) => { if (!o) void create.close({ force: true }); }}
          onSaved={(t) => {
            toast.success("Team created.");
            void reload();
            // Replace the create URL so Back from the team returns to the list (X-UI-09).
            router.replace(`/teams/${t.id}`);
          }} />
      )}
    </div>
  );
}
