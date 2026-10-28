"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { useCan } from "@/components/access/Can";
import { addDays, todayIn } from "@/components/shifts/shiftModel";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal, useConfirm } from "@/components/ui/overlay";
import { newIdempotencyKey } from "@/lib/payroll/api";

import { TEAM_TYPES, teamsApi, type Team, type TeamDetail, type TeamPatchBody, type TeamType } from "./api";
import { TeamErrorNotice, useBranches, useLegalEntities, useTeamOptions } from "./TeamBits";
import { TEAM_TYPE_LABEL, validateTeam, type TeamValues } from "./teamModel";

const FORM_ID = "team-form";

function initialValues(team: TeamDetail | Team | null | undefined, today: string): TeamValues {
  return {
    code: team?.code ?? "",
    name: team?.name ?? "",
    team_type: team?.team_type ?? "FUNCTIONAL",
    parent_team_id: team?.parent_team_id ? String(team.parent_team_id) : "",
    legal_entity_id: team?.legal_entity_id ? String(team.legal_entity_id) : "",
    branch_id: team?.branch_id ? String(team.branch_id) : "",
    description: team?.description ?? "",
    effective_from: team?.effective_from ?? today,
  };
}

const num = (v: string) => (v ? Number(v) : null);

/**
 * `TeamForm` (X 01 §15.2 "same form"): create (code, name, type, parent, home unit, start date, description) and edit
 * (code read-only; a re-parent is dated "Parent changes from", default the actor's local tomorrow, box P-10).
 */
export function TeamForm({ team, idempotencyKey, setDirty, setSubmitting, onSaved }: {
  team?: TeamDetail | Team | null;
  idempotencyKey: string;
  setDirty: (dirty: boolean) => void;
  setSubmitting: (busy: boolean) => void;
  onSaved: (team: Team) => void;
}) {
  const { me } = useCan();
  const today = useMemo(() => todayIn(me?.company?.timezone), [me?.company?.timezone]);
  const mode = team ? "edit" : "create";
  const branches = useBranches();
  const entities = useLegalEntities();
  const parents = useTeamOptions();
  const [values, setValues] = useState<TeamValues>(() => initialValues(team, today));
  const [parentFrom, setParentFrom] = useState(() => addDays(today, 1));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const set = (key: keyof TeamValues, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setDirty(true);
  };
  const parentChanged = mode === "edit" && values.parent_team_id !== (team?.parent_team_id ? String(team.parent_team_id) : "");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validateTeam(values, mode);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSubmitting(true);
    setError(null);
    try {
      let saved: Team;
      if (!team) {
        saved = await teamsApi.create({
          code: values.code.trim().toUpperCase(), name: values.name.trim(), team_type: values.team_type as TeamType,
          parent_team_id: num(values.parent_team_id), legal_entity_id: num(values.legal_entity_id),
          branch_id: num(values.branch_id), description: values.description.trim() || null,
          effective_from: values.effective_from || null,
        }, idempotencyKey);
      } else {
        const body: TeamPatchBody = { row_version: team.row_version };
        if (values.name.trim() !== team.name) body.name = values.name.trim();
        if (values.team_type !== team.team_type) body.team_type = values.team_type as TeamType;
        if (num(values.legal_entity_id) !== team.legal_entity_id) body.legal_entity_id = num(values.legal_entity_id);
        if (num(values.branch_id) !== team.branch_id) body.branch_id = num(values.branch_id);
        if ((values.description.trim() || null) !== (team.description || null)) body.description = values.description.trim() || null;
        if (parentChanged) {
          if (values.parent_team_id) body.parent_team_id = Number(values.parent_team_id);
          else body.clear_parent = true;
          body.parent_effective_from = parentFrom || null;
        }
        saved = await teamsApi.update(team.id, body, idempotencyKey);
      }
      setDirty(false);
      onSaved(saved);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const parentOptions = parents.items.filter((p) => p.id !== team?.id);
  return (
    <form id={FORM_ID} data-testid="team-form" onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
      <TeamErrorNotice error={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" required error={errors.code}
          hint={mode === "edit" ? "The code never changes once the team is in use." : "Short and unique, e.g. PAYMENTS or CREW-A."}>
          <Input data-testid="team-code" value={values.code} maxLength={30} disabled={mode === "edit"} placeholder="e.g. PAYMENTS"
            onChange={(e) => set("code", e.target.value.toUpperCase())} />
        </Field>
        <Field label="Name" required error={errors.name}>
          <Input data-testid="team-name" value={values.name} maxLength={100} placeholder="e.g. Payments"
            onChange={(e) => set("name", e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" required error={errors.team_type}
          hint={values.team_type === "CREW" ? "A crew carries one rotation for all its members." : undefined}>
          <Select data-testid="team-type" value={values.team_type} onChange={(e) => set("team_type", e.target.value)}>
            {TEAM_TYPES.map((t) => <option key={t} value={t}>{TEAM_TYPE_LABEL[t]}</option>)}
          </Select>
        </Field>
        <Field label="Parent team" hint="Leads of the parent reach this team's people through “and sub-teams”.">
          <Select data-testid="team-parent" value={values.parent_team_id} onChange={(e) => set("parent_team_id", e.target.value)}>
            <option value="">No parent</option>
            {parentOptions.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </Select>
        </Field>
      </div>
      {parentChanged && (
        <Field label="Parent changes from" hint="Records before this date keep the old parent.">
          <Input type="date" data-testid="team-parent-from" value={parentFrom} min={team?.effective_from}
            onChange={(e) => { setParentFrom(e.target.value); setDirty(true); }} />
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Legal entity" hint="Home unit: for defaults and filters, never who may join.">
          <Select data-testid="team-entity" value={values.legal_entity_id} onChange={(e) => set("legal_entity_id", e.target.value)}>
            <option value="">Any entity</option>
            {entities.items.map((le) => <option key={le.id} value={le.id}>{le.label}</option>)}
          </Select>
        </Field>
        <Field label="Branch">
          <Select data-testid="team-branch" value={values.branch_id} onChange={(e) => set("branch_id", e.target.value)}>
            <option value="">Any branch</option>
            {branches.items.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </Select>
        </Field>
      </div>
      {mode === "create" && (
        <Field label="Starts on" hint="Members can join from this date.">
          <Input type="date" data-testid="team-from" value={values.effective_from} onChange={(e) => set("effective_from", e.target.value)} />
        </Field>
      )}
      <Field label="Description" error={errors.description}>
        <Textarea data-testid="team-description" value={values.description} maxLength={500} rows={3}
          onChange={(e) => set("description", e.target.value)} />
      </Field>
    </form>
  );
}

const DISCARD = { title: "Discard changes?", message: "Your changes in this form haven't been saved.",
  confirmLabel: "Discard", cancelLabel: "Keep editing", tone: "danger" as const };

/** `TeamForm` in a Modal, for create (list) and edit (team page). Closing a dirty form asks first. */
export function TeamFormModal({ open, onOpenChange, team, onSaved }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  team?: TeamDetail | null;
  onSaved: (team: Team) => void;
}) {
  const confirm = useConfirm();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setKey(newIdempotencyKey());
      setDirty(false);
    }
    wasOpen.current = open;
  }, [open]);
  const close = async () => {
    if (dirty && !(await confirm(DISCARD))) return;
    setDirty(false);
    onOpenChange(false);
  };
  return (
    <Modal open={open} onOpenChange={(o) => (o ? onOpenChange(true) : void close())} size="lg"
      title={team ? `Edit ${team.name}` : "New team"}
      description={team ? undefined : "Group people for approvals, rosters and reports, across departments if needed."}
      footer={<>
        <Button variant="secondary" onClick={() => void close()}>Cancel</Button>
        <Button type="submit" form={FORM_ID} data-testid="team-save" loading={busy}>{team ? "Save" : "Create team"}</Button>
      </>}>
      {open && <TeamForm key={team ? `edit-${team.id}-${team.row_version}` : "new"} team={team} idempotencyKey={key}
        setDirty={setDirty} setSubmitting={setBusy} onSaved={(t) => { setDirty(false); onSaved(t); }} />}
    </Modal>
  );
}
