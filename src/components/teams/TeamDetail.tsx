"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Archive, ArrowLeft, Ban, CalendarX, Pencil, Repeat2, Star, UserPlus, UsersRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, PageHeader, TabPanel, Tabs } from "@/components/ui/layout";
import { Modal, useConfirm } from "@/components/ui/overlay";
import { Badge, Card, MotionCard, Skeleton } from "@/components/ui/primitives";
import { canSeeTeams } from "@/lib/attendance-routes";
import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { useTabParam } from "@/lib/useTabParam";

import { teamsApi, type ArchivePreview, type Membership, type TeamDetail } from "./api";
import { MembershipChangeModal, MembershipFormModal, type MembershipAction } from "./MembershipForm";
import {
  LeadsCell, RoleChip, TeamErrorNotice, TeamStatusBadge, TeamTypeBadge, WarningList, useBranches, useLegalEntities,
  useTeamOptions,
} from "./TeamBits";
import { TeamFormModal } from "./TeamForm";
import { IN_USE_TEXT, MEMBER_ROLE_LABEL, homeText, membershipActions, rangeText, stateLabel } from "./teamModel";

const TABS = ["details", "members"] as const;
type Tab = (typeof TABS)[number];

function Fact({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm" data-testid={testId}>{children}</dd>
    </div>
  );
}

/** Archive (§3.2): a dry run first; in use → blocked with the reasons; role targets → type the team code (L3). */
function ArchiveModal({ team, open, onOpenChange, onArchived }: {
  team: TeamDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onArchived: () => void;
}) {
  const [preview, setPreview] = useState<ArchivePreview | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setCode("");
    setError(null);
    teamsApi.previewArchive(team.id, team.row_version).then(setPreview).catch(setError);
  }, [open, team.id, team.row_version]);
  const blocked = !!preview?.in_use.length;
  const needsCode = !!preview?.confirm_code_required;
  const codeOk = !needsCode || code.trim().toUpperCase() === team.code;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await teamsApi.archive(team.id, { confirm_code: needsCode ? code.trim() : undefined, row_version: team.row_version });
      toast.success(`${team.code} archived.`);
      onOpenChange(false);
      onArchived();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} size="md" title={`Archive ${team.code}?`}
      description="Archived teams stay readable for history and keep their code; nobody can join them."
      footer={<>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="danger" data-testid="archive-confirm" loading={busy} disabled={!preview || blocked || !codeOk}
          onClick={() => void submit()}>Archive team</Button>
      </>}>
      <div className="space-y-4" data-testid="archive-modal">
        <TeamErrorNotice error={error} />
        {!preview && !error && <Skeleton className="h-16 w-full" />}
        {preview && blocked && (
          <div className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm" data-testid="archive-in-use">
            <p className="font-medium text-danger">The team is still in use.</p>
            <ul className="mt-1 list-disc ps-5 text-muted-foreground">
              {preview.in_use.map((r) => <li key={r} data-code={r}>{IN_USE_TEXT[r] ?? r}</li>)}
            </ul>
          </div>
        )}
        {preview && preview.target_holders.length > 0 && (
          <div className="space-y-2 text-sm" data-testid="archive-holders">
            <p className="font-medium">These roles name this team and lose it:</p>
            <ul className="space-y-1">
              {preview.target_holders.map((h) => (
                <li key={h.assignment_id} className="rounded-lg bg-surface-muted px-3 py-1.5">
                  {h.user_name}&apos;s <span className="italic">{h.role_name}</span> loses {team.code}
                </li>
              ))}
            </ul>
          </div>
        )}
        {preview && !blocked && needsCode && (
          <Field label={`Type ${team.code} to confirm`}>
            <Input data-testid="archive-confirm-code" value={code} autoComplete="off" onChange={(e) => setCode(e.target.value)} />
          </Field>
        )}
        {preview && !blocked && !needsCode && <p className="text-sm text-muted-foreground">Nothing uses this team any more.</p>}
      </div>
    </Modal>
  );
}

/** Members pane (§15.2): state filter, role chips, primary badge, routing ★, from–until, End / Cancel / Change. */
function MembersPane({ team, onChanged }: { team: TeamDetail; onChanged: () => void }) {
  const { me } = useCan();
  const confirm = useConfirm();
  const [state, setState] = useState<"ACTIVE,FUTURE" | "ALL">("ACTIVE,FUTURE");
  const [role, setRole] = useState("");
  const [adding, setAdding] = useState(false);
  const [acting, setActing] = useState<{ action: MembershipAction; row: Membership } | null>(null);
  const { data, error, loading, reload } = useApi(() => teamsApi.members(team.id, { state, member_role: role || undefined }),
    [team.id, state, role]);
  const perms = team.permissions;
  const own = me?.employee?.id;
  const archived = team.status === "ARCHIVED";
  const refresh = () => {
    void reload();
    onChanged();
  };
  const cancel = async (row: Membership) => {
    const ok = await confirm({ title: `Cancel ${row.employee_name ?? "this"} membership?`,
      message: `It was due to start on ${fmtDate(row.effective_from)}. The row stays in the history as cancelled.`,
      confirmLabel: "Cancel membership", cancelLabel: "Keep it", tone: "danger" });
    if (!ok) return;
    try {
      await teamsApi.updateMembership(row.id, { cancel: true, row_version: row.row_version });
      toast.success("Membership cancelled.");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not cancel.");
    }
  };
  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:flex-wrap sm:items-end">
        <div role="radiogroup" aria-label="Show" className="inline-flex gap-1 rounded-2xl border border-border bg-surface-muted p-1">
          {([["ACTIVE,FUTURE", "Active & upcoming"], ["ALL", "All, with history"]] as const).map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={state === value} data-testid={`members-state-${value === "ALL" ? "all" : "current"}`}
              onClick={() => setState(value)}
              className={cn("rounded-xl px-3.5 py-1.5 text-sm font-medium transition-colors",
                state === value ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {label}
            </button>
          ))}
        </div>
        <Field label="Role" className="w-36">
          <Select data-testid="members-filter-role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">All roles</option>
            {Object.entries(MEMBER_ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        {perms.members && !archived && (
          <Button className="sm:ms-auto" data-testid="open-add-member" onClick={() => setAdding(true)}>
            <UserPlus className="h-4 w-4" aria-hidden /> Add member
          </Button>
        )}
      </div>
      {!perms.member_list && (
        <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">You see this team&apos;s leads and your own membership.</p>
      )}
      {error ? <ErrorState message={error.message} onRetry={reload} /> : loading && !data ? (
        <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : !data?.items.length ? (
        <EmptyState icon={<UsersRound />} title="No members yet"
          description={perms.members && !archived ? "Add the first member or lead." : undefined} />
      ) : (
        <ul className={cn("divide-y divide-border/60 transition-opacity", loading && "opacity-60")} data-testid="members-list">
          <AnimatePresence initial={false}>
            {data.items.map((m, index) => {
              const actions = archived ? { end: false, cancel: false, changeRole: false } : membershipActions(m, perms, own);
              const faded = m.state === "ENDED" || m.state === "CANCELLED";
              return (
                <motion.li key={m.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.22, delay: Math.min(index, 12) * 0.02 }}
                  data-testid={`member-row-${m.employee_id}`} data-membership-id={m.id} data-role={m.member_role}
                  className={cn("flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center", faded && "opacity-60")}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{m.employee_name ?? `Employee #${m.employee_id}`}</span>
                      {m.employee_code && <span className="font-mono text-xs text-muted-foreground">{m.employee_code}</span>}
                      <RoleChip role={String(m.member_role)} />
                      {m.is_routing_lead && (
                        <span className="inline-flex items-center gap-1 text-xs text-warning" data-testid={`member-routing-${m.employee_id}`}>
                          <Star className="h-3.5 w-3.5 fill-warning" aria-hidden /> Routing lead
                        </span>
                      )}
                      {m.is_primary_team && <Badge tone="info" data-testid={`member-primary-${m.employee_id}`}>Primary</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {rangeText(m.effective_from, m.effective_to, (d) => fmtDate(d))}
                      {m.reason ? ` · ${m.reason}` : ""}
                    </p>
                  </div>
                  <Badge tone={m.state === "ACTIVE" ? "success" : m.state === "FUTURE" ? "info" : "neutral"} dot
                    data-testid={`member-state-${m.employee_id}`} data-state={m.state}>{stateLabel(String(m.state))}</Badge>
                  {(actions.end || actions.cancel || actions.changeRole) && (
                    <div className="flex gap-1">
                      {actions.changeRole && (
                        <Button variant="ghost" size="sm" data-testid={`member-change-${m.employee_id}`}
                          onClick={() => setActing({ action: "change", row: m })}>
                          <Repeat2 className="h-3.5 w-3.5" aria-hidden /> Change role
                        </Button>
                      )}
                      {actions.end && (
                        <Button variant="danger-ghost" size="sm" data-testid={`member-end-${m.employee_id}`}
                          onClick={() => setActing({ action: "end", row: m })}>
                          <CalendarX className="h-3.5 w-3.5" aria-hidden /> End
                        </Button>
                      )}
                      {actions.cancel && (
                        <Button variant="danger-ghost" size="sm" data-testid={`member-cancel-${m.employee_id}`} onClick={() => void cancel(m)}>
                          <Ban className="h-3.5 w-3.5" aria-hidden /> Cancel
                        </Button>
                      )}
                    </div>
                  )}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
      <MembershipFormModal open={adding} onOpenChange={setAdding} team={team} onSaved={refresh} />
      <MembershipChangeModal action={acting?.action ?? null} row={acting?.row ?? null} team={team}
        onClose={() => setActing(null)} onSaved={refresh} />
    </Card>
  );
}

/** `/teams/{team_id}` (X 01 §15.2 page twin): Details with Edit and Archive, and the Members tab. */
export function TeamDetailView({ id }: { id: string }) {
  const { data: team, error, loading, reload } = useApi(() => teamsApi.get(id), [id]);
  const [tab, setTab] = useTabParam<Tab>(TABS, "details");
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const branches = useBranches();
  const entities = useLegalEntities();
  const parents = useTeamOptions();

  if (error) {
    return (
      <div>
        <BackLink />
        <ErrorState message={error.status === 404 ? "This team doesn't exist or is outside what you can see." : error.message}
          onRetry={error.status === 404 ? undefined : reload} />
      </div>
    );
  }
  if (!team) {
    return (
      <div className="space-y-4" aria-busy={loading}>
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  const active = team.status === "ACTIVE";
  return (
    <div data-testid="team-detail" data-team-id={team.id}>
      <BackLink />
      <PageHeader eyebrow={<span className="font-mono">{team.code}</span>}
        title={<span className="inline-flex flex-wrap items-center gap-3">{team.name} <TeamStatusBadge status={String(team.status)} /></span>}
        description={team.description ?? undefined}
        actions={team.permissions.manage && active ? <>
          <Button variant="secondary" data-testid="edit-team" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" aria-hidden /> Edit
          </Button>
          <Button variant="danger-ghost" data-testid="archive-team" onClick={() => setArchiving(true)}>
            <Archive className="h-4 w-4" aria-hidden /> Archive
          </Button>
        </> : undefined} />
      <Tabs tabs={[{ value: "details", label: "Details" }, { value: "members", label: "Members", badge: team.member_count ?? undefined }]}
        value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabPanel value="details">
          <div className="space-y-4">
            {team.warnings.length > 0 && <WarningList warnings={team.warnings} />}
            <MotionCard className="p-5">
              <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                <Fact label="Code" testId="team-detail-code"><span className="font-mono font-semibold">{team.code}</span></Fact>
                <Fact label="Name" testId="team-detail-name">{team.name}</Fact>
                <Fact label="Type" testId="team-detail-type"><TeamTypeBadge type={String(team.team_type)} /></Fact>
                <Fact label="Parent team" testId="team-detail-parent">{team.parent_team_id ? (
                  <Link className="hover:underline" href={`/teams/${team.parent_team_id}`}>{parents.name(team.parent_team_id)}</Link>
                ) : "—"}</Fact>
                <Fact label="Home" testId="team-detail-home">
                  {homeText(team, (bid) => branches.items.find((b) => b.id === bid)?.label, entities.name)}
                </Fact>
                <Fact label="Dates" testId="team-detail-dates">{rangeText(team.effective_from, team.effective_to, (d) => fmtDate(d))}</Fact>
                <Fact label="Leads"><LeadsCell team={team} /></Fact>
                <Fact label="Members">{team.member_count ?? "—"}</Fact>
              </dl>
              {team.parent_history.length > 1 && (
                <div className="mt-5 border-t border-border pt-4">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Parent history</p>
                  <ul className="space-y-1 text-sm">
                    {team.parent_history.map((h) => (
                      <li key={`${h.effective_from}-${h.parent_team_id}`}>
                        {h.parent_team_id ? parents.name(h.parent_team_id) : "No parent"} · {rangeText(h.effective_from, h.effective_to, (d) => fmtDate(d))}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </MotionCard>
          </div>
        </TabPanel>
        <TabPanel value="members">
          <MembersPane team={team} onChanged={() => void reload()} />
        </TabPanel>
      </Tabs>
      {team.permissions.manage && (
        <>
          <TeamFormModal open={editing} onOpenChange={setEditing} team={team}
            onSaved={() => { toast.success("Saved."); setEditing(false); void reload(); }} />
          <ArchiveModal team={team} open={archiving} onOpenChange={setArchiving} onArchived={() => void reload()} />
        </>
      )}
    </div>
  );
}

function BackLink() {
  const { me } = useCan();
  // A SELF-only reader opens their own team from "My teams" and has no list to go back to.
  if (!me || !canSeeTeams(me)) return null;
  return (
    <Link href="/teams" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" aria-hidden /> Teams
    </Link>
  );
}
