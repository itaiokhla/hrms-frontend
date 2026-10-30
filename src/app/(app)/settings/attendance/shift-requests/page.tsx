"use client";

import { motion } from "framer-motion";
import { ArrowLeftRight, CalendarPlus, Save, ShieldCheck, UserCheck } from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { RequireAccess } from "@/components/access/Can";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/layout";
import { Card, Skeleton } from "@/components/ui/primitives";
import { toApiError } from "@/lib/api";
import { canAny } from "@/lib/access";
import { P } from "@/lib/permissions.generated";
import { shiftRequestsApi, type KindRules, type ShiftRequestSettings } from "@/lib/shiftRequests";

/** Settings › Attendance › Shift swaps & open shifts (AS-M6, 03-shifts/03 §3.1): the switches and the company
 * scheduling policy's request rules. */
export default function ShiftRequestSettingsPage() {
  return (
    <RequireAccess check={(me) => canAny(me, [P.ATTENDANCE_MANAGE_POLICY, P.SHIFT_MANAGE])}>
      <SettingsForm />
    </RequireAccess>
  );
}

function Switch({ label, help, checked, onChange, testId, disabled }: {
  label: string; help?: string; checked: boolean; onChange: (v: boolean) => void; testId: string; disabled?: boolean;
}) {
  return (
    <label className={`flex items-start justify-between gap-4 ${disabled ? "opacity-60" : ""}`}>
      <span><span className="block text-sm font-medium">{label}</span>{help && <span className="text-xs text-muted-foreground">{help}</span>}</span>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} data-testid={testId} disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted"}`}>
        <motion.span layout transition={{ type: "spring", stiffness: 500, damping: 32 }}
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow ${checked ? "end-0.5" : "start-0.5"}`} />
      </button>
    </label>
  );
}

const KINDS: { key: "swap" | "drop" | "release"; label: string; help: string }[] = [
  { key: "swap", label: "Swaps", help: "Two coworkers exchange shifts; the coworker accepts first." },
  { key: "drop", label: "Give a shift away", help: "A named coworker takes the shift; the giver's day becomes off." },
  { key: "release", label: "Release to the open pool", help: "The shift is offered to everyone eligible; the giver stays responsible until it is picked up." },
];

function SettingsForm() {
  const [saved, setSaved] = useState<ShiftRequestSettings | null>(null);
  const [draft, setDraft] = useState<ShiftRequestSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    shiftRequestsApi.settings().then((s) => { setSaved(s); setDraft(s); }).catch((e) => toast.error(toApiError(e).message));
  }, []);
  if (!draft || !saved) return <Skeleton className="h-96" />;
  const canManage = saved.can_manage;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const setKind = (kind: "swap" | "drop" | "release", patch: Partial<KindRules>) =>
    setDraft({ ...draft, requests: { ...draft.requests, [kind]: { ...draft.requests[kind], ...patch } } });

  const save = async () => {
    setSaving(true);
    try {
      const next = await shiftRequestsApi.saveSettings({
        requests_enabled: draft.requests_enabled, open_shifts_enabled: draft.open_shifts_enabled,
        planner_cannot_publish: draft.planner_cannot_publish, publish_requires_approval: draft.publish_requires_approval,
        requests: draft.requests,
        open_shift_eligibility: draft.open_shift_eligibility, availability: draft.availability,
        acknowledge_published_shifts: draft.acknowledge_published_shifts, reason: "Shift request settings changed",
      });
      setSaved(next);
      setDraft(next);
      toast.success("Shift request settings saved");
    } catch (e) {
      toast.error(toApiError(e).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-4" data-testid="shift-request-settings">
      <PageHeader title="Shift swaps & open shifts" description="What employees may change on their published schedule, and how open shifts are offered."
        actions={<Button data-testid="srs-save" loading={saving} disabled={!dirty || !canManage} onClick={save}><Save className="h-4 w-4" /> Save</Button>} />
      {!canManage && <p className="flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="h-4 w-4" /> Only company-wide attendance and shift administrators can change these settings.</p>}
      <Card className="space-y-4 p-5">
        <Switch label="Shift swaps and changes" testId="srs-requests" disabled={!canManage}
          help="Employees can ask to swap, give away, release or change their published shifts." checked={draft.requests_enabled}
          onChange={(v) => setDraft({ ...draft, requests_enabled: v })} />
        <Switch label="Open shifts" testId="srs-open" disabled={!canManage}
          help="Planners post open shifts; eligible employees claim them." checked={draft.open_shifts_enabled}
          onChange={(v) => setDraft({ ...draft, open_shifts_enabled: v })} />
        <Switch label="Planners cannot publish their own drafts" testId="srs-sod" disabled={!canManage}
          help="The person who last saved a roster's drafts cannot publish them; a second person with Publish schedules does."
          checked={draft.planner_cannot_publish} onChange={(v) => setDraft({ ...draft, planner_cannot_publish: v })} />
        <Switch label="Roster publication needs approval" testId="srs-publish-approval" disabled={!canManage}
          help="Planners send rosters for approval; a second person with Publish schedules approves them as previewed."
          checked={draft.publish_requires_approval} onChange={(v) => setDraft({ ...draft, publish_requires_approval: v })} />
      </Card>
      <Card className={`space-y-4 p-5 ${draft.requests_enabled ? "" : "opacity-60"}`} data-testid="srs-kinds">
        <p className="flex items-center gap-2 font-medium"><ArrowLeftRight className="h-4 w-4 text-primary" /> Request kinds</p>
        {KINDS.map((k) => (
          <div key={k.key} className="grid items-end gap-3 rounded-2xl border border-border p-3 sm:grid-cols-[2fr_1fr_1fr_1fr]">
            <Switch label={k.label} help={k.help} testId={`srs-${k.key}`} disabled={!canManage}
              checked={draft.requests[k.key].enabled} onChange={(v) => setKind(k.key, { enabled: v })} />
            <Field label="Cutoff (hours before)"><Input type="number" min={0} max={336} disabled={!canManage}
              value={draft.requests[k.key].cutoff_hours} onChange={(e) => setKind(k.key, { cutoff_hours: Number(e.target.value) })} /></Field>
            <Switch label="Needs approval" testId={`srs-${k.key}-approval`} disabled={!canManage}
              checked={draft.requests[k.key].approval_required} onChange={(v) => setKind(k.key, { approval_required: v })} />
            {k.key !== "swap" ? (
              <Field label="Pay when given away"><Select disabled={!canManage} data-testid={`srs-${k.key}-pay`}
                value={draft.requests[k.key].pay_effect ?? "LEAVE_REQUIRED"} onChange={(e) => setKind(k.key, { pay_effect: e.target.value as KindRules["pay_effect"] })}>
                <option value="LEAVE_REQUIRED">Salaried: apply for leave</option><option value="PAID_OFF">Hourly: not worked, not paid</option>
              </Select></Field>
            ) : <div />}
          </div>
        ))}
        <div className="grid gap-3 sm:grid-cols-3">
          <Switch label="Shift changes" help="Another shift or other times (always approved)." testId="srs-change" disabled={!canManage}
            checked={draft.requests.change_enabled} onChange={(v) => setDraft({ ...draft, requests: { ...draft.requests, change_enabled: v } })} />
          <Field label="Change cutoff (hours)"><Input type="number" min={0} max={336} disabled={!canManage} value={draft.requests.change_cutoff_hours}
            onChange={(e) => setDraft({ ...draft, requests: { ...draft.requests, change_cutoff_hours: Number(e.target.value) } })} /></Field>
          <Switch label="Pickups need approval" testId="srs-pickup-approval" disabled={!canManage}
            checked={draft.requests.pickup_approval_required} onChange={(v) => setDraft({ ...draft, requests: { ...draft.requests, pickup_approval_required: v } })} />
        </div>
      </Card>
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <p className="flex items-center gap-2 font-medium sm:col-span-2"><CalendarPlus className="h-4 w-4 text-primary" /> Who may take a shift</p>
        <Switch label="Same team only" testId="srs-same-team" disabled={!canManage} checked={draft.open_shift_eligibility.same_team}
          onChange={(v) => setDraft({ ...draft, open_shift_eligibility: { ...draft.open_shift_eligibility, same_team: v } })} />
        <Switch label="Same branch only" testId="srs-same-branch" disabled={!canManage} checked={draft.open_shift_eligibility.same_branch}
          onChange={(v) => setDraft({ ...draft, open_shift_eligibility: { ...draft.open_shift_eligibility, same_branch: v } })} />
      </Card>
      <Card className="grid gap-4 p-5 sm:grid-cols-3">
        <p className="flex items-center gap-2 font-medium sm:col-span-3"><UserCheck className="h-4 w-4 text-primary" /> Availability and acknowledgement</p>
        <Switch label="Employees state their availability" testId="srs-availability" disabled={!canManage} checked={draft.availability.enabled}
          onChange={(v) => setDraft({ ...draft, availability: { ...draft.availability, enabled: v } })} />
        <Field label="Notice for availability changes (days)"><Input type="number" min={0} max={60} disabled={!canManage}
          value={draft.availability.change_notice_days} onChange={(e) => setDraft({ ...draft, availability: { ...draft.availability, change_notice_days: Number(e.target.value) } })} /></Field>
        <Switch label="Availability needs approval" testId="srs-availability-approval" disabled={!canManage} checked={draft.availability.approval_required}
          onChange={(v) => setDraft({ ...draft, availability: { ...draft.availability, approval_required: v } })} />
        <Switch label="Employees acknowledge published shifts" testId="srs-ack" disabled={!canManage} checked={draft.acknowledge_published_shifts}
          onChange={(v) => setDraft({ ...draft, acknowledge_published_shifts: v })} />
      </Card>
    </div>
  );
}
