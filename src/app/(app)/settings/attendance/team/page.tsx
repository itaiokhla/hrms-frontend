"use client";

import { motion } from "framer-motion";
import { Save, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { RequireAccess } from "@/components/access/Can";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/layout";
import { Card, Skeleton } from "@/components/ui/primitives";
import { toApiError } from "@/lib/api";
import { can } from "@/lib/access";
import { P } from "@/lib/permissions.generated";
import { teamApi, type TeamSettings } from "@/lib/teamAttendance";

/** Settings › Attendance › Team attendance (IG-AS-98): what managers may do for their team. */
export default function TeamAttendanceSettingsPage() {
  return (
    <RequireAccess check={(me) => can(me, P.ATTENDANCE_MANAGE_POLICY)}>
      <TeamSettingsForm />
    </RequireAccess>
  );
}

function Toggle({ label, help, checked, onChange, testId, disabled }: {
  label: string; help: string; checked: boolean; onChange: (v: boolean) => void; testId: string; disabled?: boolean;
}) {
  return (
    <label className={`flex items-start justify-between gap-4 rounded-2xl border border-border p-4 ${disabled ? "opacity-60" : ""}`}>
      <span><span className="block font-medium">{label}</span><span className="text-sm text-muted-foreground">{help}</span></span>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} data-testid={testId} disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted"}`}>
        <motion.span layout transition={{ type: "spring", stiffness: 500, damping: 32 }}
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow ${checked ? "end-0.5" : "start-0.5"}`} />
      </button>
    </label>
  );
}

function TeamSettingsForm() {
  const [saved, setSaved] = useState<TeamSettings | null>(null);
  const [draft, setDraft] = useState<TeamSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    teamApi.settings().then((s) => { setSaved(s); setDraft(s); }).catch((e) => toast.error(toApiError(e).message));
  }, []);

  if (!draft || !saved) return <Skeleton className="h-96" />;
  const dirty = JSON.stringify({ ...draft, can_manage: undefined }) !== JSON.stringify({ ...saved, can_manage: undefined });
  const set = (patch: Partial<TeamSettings>) => setDraft({ ...draft, ...patch });
  const canManage = !!saved.can_manage;

  const save = async () => {
    setSaving(true);
    try {
      const { can_manage: _ignored, ...body } = draft;
      void _ignored;
      const next = await teamApi.saveSettings({ ...body, reason: "Team attendance settings changed" });
      setSaved(next);
      setDraft(next);
      toast.success("Team attendance settings saved");
    } catch (e) {
      toast.error(toApiError(e).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title="Team attendance" description="What managers and supervisors can do for the people they manage. Who counts as their team follows reporting lines, teams and role scopes."
        actions={<Button data-testid="team-settings-save" loading={saving} disabled={!dirty || !canManage} onClick={save}><Save className="h-4 w-4" /> Save</Button>} />
      {!canManage && <p className="mb-4 flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="h-4 w-4" /> Only company-wide attendance administrators can change these settings.</p>}
      <Card className="space-y-3 p-5" data-testid="team-settings">
        <Toggle label="Managers punch for their team" testId="ts-proxy-enabled" disabled={!canManage}
          help="Managers can punch team members in and out when they cannot (no phone, no network). Recorded as the manager's action."
          checked={draft.proxy_punch_enabled} onChange={(v) => set({ proxy_punch_enabled: v })} />
        <div className={`grid gap-3 sm:grid-cols-2 ${draft.proxy_punch_enabled ? "" : "pointer-events-none opacity-50"}`}>
          <Field label="Location for team punches">
            <Select data-testid="ts-location" disabled={!canManage} value={draft.proxy_punch_location}
              onChange={(e) => set({ proxy_punch_location: e.target.value as TeamSettings["proxy_punch_location"] })}>
              <option value="REQUIRED">Required</option><option value="OPTIONAL">Optional</option><option value="OFF">Not collected</option>
            </Select>
          </Field>
          <div />
          <Toggle label="Location entered by hand" testId="ts-manual" disabled={!canManage}
            help="When the device cannot give a position, the manager enters coordinates or an address."
            checked={draft.allow_manual_location} onChange={(v) => set({ allow_manual_location: v })} />
          <Toggle label="Reason required" testId="ts-reason" disabled={!canManage}
            help="Every team punch needs a reason, kept in the audit trail."
            checked={draft.reason_required} onChange={(v) => set({ reason_required: v })} />
        </div>
        <Toggle label="Managers correct and delete team attendance" testId="ts-edit" disabled={!canManage}
          help="Managers with the correct-attendance permission can edit and delete their team's sessions. Deleted sessions are kept for audit."
          checked={draft.edit_enabled} onChange={(v) => set({ edit_enabled: v })} />
      </Card>
    </div>
  );
}
