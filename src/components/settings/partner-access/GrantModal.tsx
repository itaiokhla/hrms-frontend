"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import { ErrorSummary, Notice } from "@/components/payroll/inputs/shared";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/overlay";
import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

import { partnerAccessApi } from "./api";
import type { CatalogueItem, Delegation, NarrowKind, Overview } from "./types";

const DAY_CHOICES = [1, 3, 7, 14, 30];
const DAY_MS = 86_400_000;

/** Whether a permission survives the chosen narrowing (always, when nothing is narrowed). */
export function stillAllowed(item: CatalogueItem, entities: number[], groups: number[]): boolean {
  if (!entities.length && !groups.length) return true;
  const kinds: NarrowKind[] = [...(entities.length ? (["LEGAL_ENTITY"] as const) : []), ...(groups.length ? (["PAY_GROUP"] as const) : [])];
  return kinds.some((k) => item.narrowable_by.includes(k));
}

export function validateGrant(d: { codes: string[]; reason: string }, reasonMin: number): Record<string, string> {
  const e: Record<string, string> = {};
  if (!d.codes.length) e.codes = "Choose at least one permission to share.";
  if (d.reason.trim().length < reasonMin) e.reason = `Say why in at least ${reasonMin} characters. It is kept in the audit trail.`;
  return e;
}

export function GrantModal({
  open,
  onOpenChange,
  overview,
  onGranted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  overview: Overview;
  onGranted: (row: Delegation) => void;
}) {
  const partner = overview.partner?.name ?? "the partner";
  const [codes, setCodes] = useState<string[]>([]);
  const [days, setDays] = useState(7);
  const [limit, setLimit] = useState(false);
  const [entities, setEntities] = useState<number[]>([]);
  const [groups, setGroups] = useState<number[]>([]);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCodes([]);
    setDays(7);
    setLimit(false);
    setEntities([]);
    setGroups([]);
    setReason("");
    setErrors({});
    setError(null);
  }, [open]);

  const activeEntities = limit ? entities : [];
  const activeGroups = limit ? groups : [];
  const byModule = useMemo(() => {
    const out = new Map<string, CatalogueItem[]>();
    overview.catalogue.forEach((item) => out.set(item.module, [...(out.get(item.module) ?? []), item]));
    return [...out.entries()];
  }, [overview.catalogue]);
  const toggle = (list: number[], id: number, on: boolean) => (on ? [...list, id] : list.filter((v) => v !== id));
  const changeLimit = (on: boolean) => {
    setLimit(on);
    if (on) return;
    setEntities([]);
    setGroups([]);
  };
  // A permission that cannot be limited to the chosen entities / pay groups drops out of the selection.
  const narrow = (nextEntities: number[], nextGroups: number[]) => {
    setEntities(nextEntities);
    setGroups(nextGroups);
    setCodes((current) =>
      current.filter((c) => {
        const item = overview.catalogue.find((i) => i.code === c);
        return item ? stillAllowed(item, nextEntities, nextGroups) : false;
      }),
    );
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problems = validateGrant({ codes, reason }, overview.reason_min);
    if (limit && !activeEntities.length && !activeGroups.length) problems.limit = "Choose at least one legal entity or pay group, or share the whole company.";
    setErrors(problems);
    if (Object.keys(problems).length) return;
    setBusy(true);
    setError(null);
    try {
      const expires = new Date(Date.now() + days * DAY_MS - 60_000);
      const row = await partnerAccessApi.grant({
        permission_codes: codes,
        legal_entity_ids: activeEntities,
        pay_group_ids: activeGroups,
        expires_at: expires.toISOString(),
        reason: reason.trim(),
      });
      onGranted(row);
      onOpenChange(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={`Give ${partner} read-only access`}
      description="Time-limited, read-only and recorded in your audit log. You can end it at any moment."
      footer={
        <>
          <Button variant="ghost" className="min-h-[44px]" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="grant-partner-access" className="min-h-[44px]" loading={busy}>
            Grant access
          </Button>
        </>
      }
    >
      <form id="grant-partner-access" onSubmit={submit} className="space-y-5" noValidate>
        <ErrorSummary error={error} fields={errors} />
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            What can they read? <span className="text-danger">*</span>
          </legend>
          <p className="text-xs text-muted-foreground">
            Payments, approvals, finalizing a payroll run, full bank numbers and user or role changes can never be shared.
            You can only share what you hold company-wide yourself.
          </p>
          <div className="max-h-64 space-y-3 overflow-y-auto rounded-xl border border-border p-2" role="group" aria-label="Permissions to share">
            {byModule.map(([module, items]) => (
              <div key={module}>
                <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{module}</p>
                {items.map((item) => {
                  const allowed = stillAllowed(item, activeEntities, activeGroups);
                  return (
                    <label key={item.code} className={cn("flex min-h-[44px] items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-muted", !allowed && "opacity-50")}>
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4"
                        disabled={!allowed}
                        checked={codes.includes(item.code)}
                        onChange={(e) => setCodes(e.target.checked ? [...codes, item.code] : codes.filter((c) => c !== item.code))}
                      />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2 text-sm">
                          {item.label}
                          {item.sensitivity !== "standard" && (
                            <Badge tone={item.sensitivity === "restricted" ? "danger" : "warning"}>{item.sensitivity === "restricted" ? "Sensitive" : "Confidential"}</Badge>
                          )}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {item.description}
                          {!allowed && " Can't be limited to the chosen entities or pay groups."}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            ))}
            {!byModule.length && <p className="p-2 text-sm text-muted-foreground">There is nothing you can share.</p>}
          </div>
          {errors.codes && <p role="alert" className="text-sm text-danger">{errors.codes}</p>}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Which part of the company?</legend>
          <label className="flex min-h-[44px] items-center gap-2 text-sm">
            <input type="radio" name="reach" className="h-4 w-4" checked={!limit} onChange={() => changeLimit(false)} />
            The whole company
          </label>
          <label className="flex min-h-[44px] items-center gap-2 text-sm">
            <input type="radio" name="reach" className="h-4 w-4" checked={limit} onChange={() => changeLimit(true)} />
            Only selected legal entities or pay groups
          </label>
          {limit && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1" role="group" aria-label="Legal entities">
                <p className="text-xs font-medium text-muted-foreground">Legal entities</p>
                {overview.targets.legal_entities.map((le) => (
                  <label key={le.id} className="flex min-h-[44px] items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4" checked={entities.includes(le.id)} onChange={(e) => narrow(toggle(entities, le.id, e.target.checked), groups)} />
                    {le.name} <span className="text-xs text-muted-foreground">{le.code}</span>
                  </label>
                ))}
              </div>
              <div className="space-y-1" role="group" aria-label="Pay groups">
                <p className="text-xs font-medium text-muted-foreground">Pay groups</p>
                {overview.targets.pay_groups.map((pg) => (
                  <label key={pg.id} className="flex min-h-[44px] items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4" checked={groups.includes(pg.id)} onChange={(e) => narrow(entities, toggle(groups, pg.id, e.target.checked))} />
                    {pg.name} <span className="text-xs text-muted-foreground">{pg.code}</span>
                  </label>
                ))}
                {!overview.targets.pay_groups.length && <p className="text-xs text-muted-foreground">No pay groups yet.</p>}
              </div>
            </div>
          )}
          {errors.limit && <p role="alert" className="text-sm text-danger">{errors.limit}</p>}
          {limit && (
            <Notice title="Some permissions can't be limited">
              Permissions that only exist company-wide (for example holiday calendars) are switched off while you limit access.
            </Notice>
          )}
        </fieldset>

        <Field label="For how long?" htmlFor="partner-access-days" hint={`At most ${overview.max_days} days. Access starts now and ends by itself.`}>
          <Select id="partner-access-days" className="min-h-[44px]" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {DAY_CHOICES.filter((d) => d <= overview.max_days).map((d) => (
              <option key={d} value={d}>
                {d === 1 ? "1 day" : `${d} days`}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Why are you sharing this?" required error={errors.reason} hint="For example: month-end payroll review by our bureau.">
          <Textarea rows={3} maxLength={500} value={reason} onChange={(e) => { setReason(e.target.value); setErrors((cur) => ({ ...cur, reason: "" })); }} />
        </Field>
      </form>
    </Modal>
  );
}
