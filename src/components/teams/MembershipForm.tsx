"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { todayIn } from "@/components/shifts/shiftModel";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal, useConfirm } from "@/components/ui/overlay";
import { cn } from "@/lib/cn";
import { newIdempotencyKey } from "@/lib/payroll/api";

import {
  TeamApiError, teamsApi, type MemberCandidate, type MemberRole, type Membership, type MembershipPatchBody,
  type MembershipWarning, type TeamDetail,
} from "./api";
import { TeamErrorNotice, WarningList } from "./TeamBits";
import { MEMBER_ROLE_LABEL, allowedRoles, validateMembership, withRole, type MembershipValues } from "./teamModel";

const FORM_ID = "member-form";

/** A labelled native checkbox (stable for e2e `check()`), animated tick. */
function Check2({ testId, label, hint, checked, disabled, onChange }: {
  testId: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border border-border px-3 py-2.5 transition-colors",
      checked && "border-primary/50 bg-primary-soft/40", disabled && "cursor-not-allowed opacity-50")}>
      <input type="checkbox" data-testid={testId} className="mt-0.5 h-4 w-4 accent-primary" checked={checked}
        disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-sm">
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

/** Employee picker over the masked member-candidate lookup (X-ROLE-36): type ≥ 2 characters. */
function CandidatePicker({ teamId, effectiveFrom, picked, onPick, error }: {
  teamId: number;
  effectiveFrom: string;
  picked: MemberCandidate | null;
  onPick: (c: MemberCandidate | null) => void;
  error?: string;
}) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<MemberCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setItems([]);
      setFailed(null);
      return;
    }
    const id = ++seq.current;
    setLoading(true);
    const timer = setTimeout(() => {
      teamsApi.candidates(teamId, text, effectiveFrom || undefined)
        .then((r) => { if (id === seq.current) { setItems(r.items); setFailed(null); } })
        .catch((e) => { if (id === seq.current) { setItems([]); setFailed(e instanceof Error ? e.message : "Search failed."); } })
        .finally(() => { if (id === seq.current) setLoading(false); });
    }, 250);
    return () => clearTimeout(timer);
  }, [q, teamId, effectiveFrom]);

  if (picked) {
    return (
      <Field label="Person" required>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/40 bg-primary-soft/40 px-3 py-2"
          data-testid="member-picked" data-employee={picked.employee_id}>
          <span className="text-sm">
            <span className="font-medium">{picked.name}</span>
            <span className="text-muted-foreground"> · {[picked.employee_code, picked.branch].filter(Boolean).join(" · ")}</span>
          </span>
          <Button variant="ghost" size="sm" onClick={() => onPick(null)} aria-label="Choose another person">
            <X className="h-3.5 w-3.5" aria-hidden /> Change
          </Button>
        </div>
      </Field>
    );
  }
  return (
    <Field label="Person" required error={error} hint="Type at least 2 letters of a name, or an employee code.">
      <div>
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input data-testid="member-search" className="ps-9" value={q} autoComplete="off" placeholder="Search people…"
            onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
        </div>
        <AnimatePresence>
          {q.trim().length >= 2 && (
            <motion.ul initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-sm" role="listbox"
              aria-busy={loading || undefined} data-testid="member-candidates">
              {failed ? <li className="px-3 py-2 text-sm text-danger">{failed}</li>
                : items.length === 0 ? <li className="px-3 py-2 text-sm text-muted-foreground">{loading ? "Searching…" : "No one found."}</li>
                  : items.map((c) => (
                    <li key={c.employee_id}>
                      <button type="button" role="option" aria-selected={false} data-testid={`member-candidate-${c.employee_id}`}
                        onClick={() => onPick(c)}
                        className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-muted focus:bg-surface-muted focus:outline-none">
                        <span className="font-medium">{c.name}</span>
                        <span className="text-xs text-muted-foreground">{[c.employee_code, c.branch].filter(Boolean).join(" · ")}</span>
                      </button>
                    </li>
                  ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    </Field>
  );
}

/**
 * `TeamMemberForm` (X 01 §15.2): person (member-candidate lookup), member role, primary team, routing lead (LEAD
 * only), from, until, reason. Lead fields are hidden for holders limited to members (§3.2).
 */
export function MembershipForm({ team, idempotencyKey, setDirty, setSubmitting, onSaved }: {
  team: TeamDetail;
  idempotencyKey: string;
  setDirty: (dirty: boolean) => void;
  setSubmitting: (busy: boolean) => void;
  onSaved: (warnings: MembershipWarning[]) => void;
}) {
  const { me } = useCan();
  const today = useMemo(() => todayIn(me?.company?.timezone), [me?.company?.timezone]);
  const canLeads = team.permissions.leads;
  const roles = allowedRoles(canLeads);
  const [picked, setPicked] = useState<MemberCandidate | null>(null);
  const [values, setValues] = useState<MembershipValues>({
    employee_id: null, member_role: "MEMBER", is_primary_team: false, is_routing_lead: false,
    effective_from: today > team.effective_from ? today : team.effective_from, effective_to: "", reason: "", move_primary: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const update = (next: Partial<MembershipValues>) => {
    setValues((v) => ({ ...v, ...next }));
    setDirty(true);
  };
  const primaryConflict = error instanceof TeamApiError && error.code === "PRIMARY_TEAM_CONFLICT";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validateMembership(values, { canLeads });
    setErrors(found);
    if (Object.keys(found).length) return;
    setSubmitting(true);
    setError(null);
    try {
      const saved = await teamsApi.addMember(team.id, {
        employee_id: values.employee_id!, member_role: values.member_role, is_primary_team: values.is_primary_team,
        is_routing_lead: values.member_role === "LEAD" && values.is_routing_lead,
        effective_from: values.effective_from || null, effective_to: values.effective_to || null,
        reason: values.reason.trim() || null, move_primary: values.is_primary_team && values.move_primary,
      }, idempotencyKey);
      setDirty(false);
      onSaved(saved.warnings ?? []);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form id={FORM_ID} data-testid="member-form" onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
      <TeamErrorNotice error={error} />
      <CandidatePicker teamId={team.id} effectiveFrom={values.effective_from} picked={picked} error={errors.employee_id}
        onPick={(c) => { setPicked(c); update({ employee_id: c?.employee_id ?? null }); }} />
      {canLeads && (
        <Field label="Role in the team" error={errors.member_role}>
          <Select data-testid="member-role" value={values.member_role}
            onChange={(e) => { setValues((v) => withRole(v, e.target.value as MemberRole)); setDirty(true); }}>
            {roles.map((r) => <option key={r} value={r}>{MEMBER_ROLE_LABEL[r]}</option>)}
          </Select>
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Check2 testId="member-primary" label="Primary team" hint="Routes their team-lead approvals here."
          checked={values.is_primary_team} onChange={(v) => update({ is_primary_team: v, move_primary: v ? values.move_primary : false })} />
        {canLeads && (
          <Check2 testId="member-routing" label="Routing lead ★" hint="Gets the team-lead approval steps."
            checked={values.is_routing_lead} disabled={values.member_role !== "LEAD"} onChange={(v) => update({ is_routing_lead: v })} />
        )}
      </div>
      {errors.is_routing_lead && <p className="text-xs font-medium text-danger" role="alert">{errors.is_routing_lead}</p>}
      <AnimatePresence>
        {values.is_primary_team && (primaryConflict || values.move_primary) && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <Check2 testId="member-move-primary" label="Move primary team here"
              hint="Their current primary team stays a membership, no longer primary, from the day before."
              checked={values.move_primary} onChange={(v) => update({ move_primary: v })} />
          </motion.div>
        )}
      </AnimatePresence>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From">
          <Input type="date" data-testid="member-from" value={values.effective_from} min={team.effective_from}
            onChange={(e) => update({ effective_from: e.target.value })} />
        </Field>
        <Field label="Until" error={errors.effective_to} hint="Leave empty for an open membership.">
          <Input type="date" data-testid="member-until" value={values.effective_to} min={values.effective_from || undefined}
            onChange={(e) => update({ effective_to: e.target.value })} />
        </Field>
      </div>
      <Field label="Reason" error={errors.reason}>
        <Textarea data-testid="member-reason" rows={2} maxLength={500} value={values.reason}
          onChange={(e) => update({ reason: e.target.value })} />
      </Field>
    </form>
  );
}

const DISCARD = { title: "Discard changes?", message: "Your changes in this form haven't been saved.",
  confirmLabel: "Discard", cancelLabel: "Keep editing", tone: "danger" as const };

/** "+ Add member" Modal; after a save with warnings it stays open to show them (ABOVE_LEAD, DEPUTY_CANNOT_APPROVE). */
export function MembershipFormModal({ open, onOpenChange, team, onSaved }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  team: TeamDetail;
  onSaved: () => void;
}) {
  const confirm = useConfirm();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const [warnings, setWarnings] = useState<MembershipWarning[] | null>(null);
  const [round, setRound] = useState(0);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setKey(newIdempotencyKey());
      setDirty(false);
      setWarnings(null);
      setRound((r) => r + 1);
    }
    wasOpen.current = open;
  }, [open]);
  const close = async () => {
    if (dirty && !(await confirm(DISCARD))) return;
    setDirty(false);
    onOpenChange(false);
  };
  const saved = (list: MembershipWarning[]) => {
    onSaved();
    if (list.length) {
      setWarnings(list);
      toast.success("Member added, with warnings.");
    } else {
      toast.success("Member added.");
      onOpenChange(false);
    }
  };
  const addAnother = () => {
    setWarnings(null);
    setKey(newIdempotencyKey());
    setRound((r) => r + 1);
  };
  return (
    <Modal open={open} onOpenChange={(o) => (o ? onOpenChange(true) : void close())} size="lg"
      title={`Add a member to ${team.name}`}
      description={team.permissions.leads ? undefined : "You can add members. Leads are set by HR or a team administrator."}
      footer={warnings ? <>
        <Button variant="secondary" onClick={addAnother}>Add another</Button>
        <Button data-testid="member-done" onClick={() => onOpenChange(false)}>Done</Button>
      </> : <>
        <Button variant="secondary" onClick={() => void close()}>Cancel</Button>
        <Button type="submit" form={FORM_ID} data-testid="member-save" loading={busy}>Add member</Button>
      </>}>
      {open && (warnings ? (
        <div className="space-y-3" data-testid="member-saved">
          <p className="flex items-center gap-2 text-sm font-medium text-success"><Check className="h-4 w-4" aria-hidden /> Saved.</p>
          <WarningList warnings={warnings} />
        </div>
      ) : (
        <MembershipForm key={round} team={team} idempotencyKey={key} setDirty={setDirty} setSubmitting={setBusy} onSaved={saved} />
      ))}
    </Modal>
  );
}

/* ------------------------------------------------------------------ row actions */

export type MembershipAction = "end" | "change";

/**
 * End an ACTIVE row ("Last day", TM-7) or change role / primary / routing from a date (TM-3: the old row ends the day
 * before and a new one starts). Cancel of a FUTURE row is a confirm on the members list.
 */
export function MembershipChangeModal({ action, row, team, onClose, onSaved }: {
  action: MembershipAction | null;
  row: Membership | null;
  team: TeamDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { me } = useCan();
  const today = useMemo(() => todayIn(me?.company?.timezone), [me?.company?.timezone]);
  const open = !!action && !!row;
  const [date, setDate] = useState(today);
  const [role, setRole] = useState<MemberRole>("MEMBER");
  const [primary, setPrimary] = useState(false);
  const [routing, setRouting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [warnings, setWarnings] = useState<MembershipWarning[] | null>(null);
  const [key, setKey] = useState(newIdempotencyKey);
  useEffect(() => {
    if (!row) return;
    const start = row.effective_from > today ? row.effective_from : today;
    setDate(start);
    setRole((row.member_role as MemberRole) ?? "MEMBER");
    setPrimary(row.is_primary_team);
    setRouting(row.is_routing_lead);
    setReason("");
    setError(null);
    setWarnings(null);
    setKey(newIdempotencyKey());
  }, [row, action, today]);
  if (!row) return null;
  const name = row.employee_name ?? `Employee #${row.employee_id}`;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: MembershipPatchBody = { row_version: row.row_version, reason: reason.trim() || null };
      if (action === "end") body.effective_to = date;
      else {
        if (role !== row.member_role) body.member_role = role;
        if (primary !== row.is_primary_team) body.is_primary_team = primary;
        const nextRouting = role === "LEAD" && routing;
        if (nextRouting !== row.is_routing_lead) body.is_routing_lead = nextRouting;
        body.change_from = date;
      }
      const saved = await teamsApi.updateMembership(row.id, body, key);
      onSaved();
      if (saved.warnings?.length) setWarnings(saved.warnings);
      else {
        toast.success(action === "end" ? "Membership ended." : "Membership changed.");
        onClose();
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const roles = allowedRoles(team.permissions.leads);
  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} size="md"
      title={action === "end" ? `End ${name}'s membership` : `Change ${name}'s membership`}
      description={action === "end" ? "The membership stays in the history; it ends on the last day you choose."
        : "The current row ends the day before; the new one starts on this date."}
      footer={warnings ? <Button data-testid="member-done" onClick={onClose}>Done</Button> : <>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button data-testid={action === "end" ? "end-confirm" : "change-confirm"} variant={action === "end" ? "danger" : "primary"}
          loading={busy} onClick={() => void submit()}>{action === "end" ? "End membership" : "Save change"}</Button>
      </>}>
      <div className="space-y-4" data-testid="member-change-form">
        <TeamErrorNotice error={error} />
        {warnings ? <WarningList warnings={warnings} /> : (
          <>
            {action === "change" && (
              <>
                {team.permissions.leads && (
                  <Field label="Role in the team">
                    <Select data-testid="change-role" value={role} onChange={(e) => {
                      const next = e.target.value as MemberRole;
                      setRole(next);
                      if (next !== "LEAD") setRouting(false);
                    }}>
                      {roles.map((r) => <option key={r} value={r}>{MEMBER_ROLE_LABEL[r]}</option>)}
                    </Select>
                  </Field>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Check2 testId="change-primary" label="Primary team" checked={primary} onChange={setPrimary} />
                  {team.permissions.leads && (
                    <Check2 testId="change-routing" label="Routing lead ★" checked={routing} disabled={role !== "LEAD"} onChange={setRouting} />
                  )}
                </div>
              </>
            )}
            <Field label={action === "end" ? "Last day" : "Change from"}>
              <Input type="date" data-testid={action === "end" ? "end-date" : "change-from"} value={date}
                min={row.effective_from} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Reason">
              <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}
