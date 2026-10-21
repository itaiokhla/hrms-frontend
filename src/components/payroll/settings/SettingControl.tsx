"use client";

import { Hourglass, Info, Lock, Unlock } from "lucide-react";
import { useId, type ReactNode } from "react";

import { SwitchCard, type SwitchLock } from "@/components/payroll/SwitchCard";
import { Input, Select, Textarea } from "@/components/ui/field";
import { Badge } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApi } from "@/lib/hooks";
import { CURRENCY_LIST } from "@/lib/payroll/catalogues.generated";
import type { SettingDefinition } from "@/lib/settings.generated";

import { SettingBadge, inheritanceProps } from "./InheritanceBadge";
import { decisionFor, fmtDay, formatValue, humanize, splitHelp, type DraftValue, type MoneyDraft } from "./model";
import type { SettingValueItem } from "./types";

/** Payroll-allowed ISO 4217 currencies, from the generated catalogue (never Intl defaults). */
export const PAY_CURRENCIES = CURRENCY_LIST.filter((c) => c.payroll_allowed && c.status === "ACTIVE");

/** Lists that back `ui.reference` controls; unknown references fall back to an id field. */
const REFERENCE_SOURCES: Record<string, string> = {
  holiday_calendar: "/payroll/org/holiday-calendars",
};

export interface SettingControlProps {
  def: SettingDefinition;
  item: SettingValueItem | undefined;
  draft: DraftValue;
  onDraft: (value: DraftValue) => void;
  dirty: boolean;
  locked: boolean;
  onLocked?: (locked: boolean) => void;
  /** Whether the user may change this value at the selected scope. */
  canEdit: boolean;
  /** Why it can't be changed here, shown under the control. */
  readOnlyReason?: string | null;
  canLock?: boolean;
  errors: string[];
  warnings?: string[];
  onExplain?: (key: string) => void;
}

function controlId(key: string) {
  return `setting-${key.replace(/[^a-z0-9]+/gi, "-")}`;
}

/** One setting at the selected scope: typed control, unit, constraints, inheritance and errors. */
export function SettingControl(props: SettingControlProps) {
  const { def, item, draft, onDraft, canEdit, errors, warnings = [], readOnlyReason } = props;
  const id = controlId(def.key);
  const help = splitHelp(def.help);
  const decision = decisionFor(def.key);
  const decisionOpen = !!decision && (!item?.here || item.here.source === "STARTER_PROFILE");
  const notAvailable = def.supportStatus === "NOT_IMPLEMENTED";
  const legal = item?.badge?.code === "REQUIRED_BY_LAW" ? `${item.badge.label}${item.badge.source ? ` (${item.badge.source})` : ""}` : null;
  const extras = <SettingExtras {...props} decision={decisionOpen ? decision : null} notAvailable={notAvailable} warnings={warnings} />;

  if (def.type === "bool") {
    const code = item?.badge?.code;
    const lock: SwitchLock | null =
      code === "REQUIRED_BY_LAW" ? "LAW" : code === "LOCKED" && item?.badge?.level === "TENANT" ? "TENANT" : decisionOpen && canEdit ? "DECISION" : null;
    const lockReason = lock === "LAW" ? legal : lock === "TENANT" ? readOnlyReason : lock === "DECISION" ? decision : null;
    const note = !canEdit && lock !== "LAW" && lock !== "TENANT" ? readOnlyReason : null;
    return (
      <div id={id} data-setting={def.key}>
        <SwitchCard
          title={def.label}
          description={[help.text, note].filter(Boolean).join(" ") || undefined}
          checked={draft === true}
          onChange={(v) => onDraft(v)}
          whenOn={help.on ?? "Turned on."}
          whenOff={help.off ?? "Turned off."}
          lock={lock}
          lockReason={lockReason}
          inheritance={inheritanceProps(item?.badge) ?? undefined}
          disabled={!canEdit}
          error={errors.join(" ") || null}
          className={def.ui.switch_card === true ? "shadow-card" : "shadow-none"}
        >
          <SettingExtras {...props} decision={null} notAvailable={notAvailable} warnings={warnings} />
        </SwitchCard>
      </div>
    );
  }

  const describedBy = `${id}-help`;
  const errorId = `${id}-error`;
  const unit = typeof def.ui.unit === "string" ? def.ui.unit : null;
  return (
    <div
      id={id}
      data-setting={def.key}
      className={cn("rounded-2xl border border-border/80 bg-surface p-4 sm:p-5", errors.length && "border-danger/60")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-input`} className="text-sm font-medium">
          {def.label}
        </label>
        <SettingBadge badge={item?.badge} />
      </div>
      <p id={describedBy} className="mt-1 text-sm text-muted-foreground">
        {def.help}
        {constraintText(def) && <span className="block text-xs">{constraintText(def)}</span>}
      </p>
      <div className="mt-3 flex max-w-xl items-center gap-2">
        <TypedInput
          def={def}
          id={`${id}-input`}
          value={draft}
          onChange={onDraft}
          disabled={!canEdit}
          invalid={errors.length > 0}
          describedBy={[describedBy, errors.length ? errorId : null].filter(Boolean).join(" ")}
        />
        {unit && <span className="shrink-0 text-sm text-muted-foreground">{unit}</span>}
      </div>
      {legal && (
        <p className="mt-3 rounded-xl bg-surface-muted px-3 py-2 text-xs text-foreground">{legal}</p>
      )}
      {!canEdit && readOnlyReason && <p className="mt-2 text-xs text-muted-foreground">{readOnlyReason}</p>}
      {errors.length > 0 && (
        <p id={errorId} role="alert" className="mt-2 text-xs font-medium text-danger">
          {errors.join(" ")}
        </p>
      )}
      {extras}
    </div>
  );
}

function constraintText(def: SettingDefinition): string | null {
  const c = def.constraints as Record<string, unknown>;
  const parts: string[] = [];
  if (c.min !== undefined && c.max !== undefined) parts.push(`From ${c.min} to ${c.max}`);
  else if (c.min !== undefined) parts.push(`At least ${c.min}`);
  else if (c.max !== undefined) parts.push(`At most ${c.max}`);
  if (c.gt !== undefined) parts.push(`More than ${c.gt}`);
  if (typeof c.max_places === "number" && def.type === "decimal") parts.push(`up to ${c.max_places} decimals`);
  if (typeof c.max_length === "number" && def.type === "string" && c.format !== "iso4217") parts.push(`up to ${c.max_length} characters`);
  if (c.nullable === true) parts.push("optional");
  return parts.length ? `${parts.join(", ")}.` : null;
}

/** Decision callouts, pending approvals, lock toggle and the "Why this value?" link. */
function SettingExtras({
  def,
  item,
  dirty,
  locked,
  onLocked,
  canEdit,
  canLock,
  onExplain,
  decision,
  notAvailable,
  warnings,
}: SettingControlProps & { decision: string | null; notAvailable: boolean; warnings: string[] }) {
  const rows: ReactNode[] = [];
  if (notAvailable) rows.push(<Badge key="na" tone="neutral">Not available yet: saved, but not used by payroll</Badge>);
  if (def.supportStatus === "BETA") rows.push(<Badge key="beta" tone="info">Beta</Badge>);
  if (dirty) rows.push(<Badge key="dirty" tone="primary">Unsaved change</Badge>);
  return (
    <div className="mt-3 space-y-2 empty:hidden">
      {decision && (
        <p className="flex items-start gap-2 rounded-xl border border-info/30 bg-info-soft px-3 py-2 text-xs text-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            <span className="font-semibold">Decision required: </span>
            {decision}
          </span>
        </p>
      )}
      {item?.pending && (
        <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-foreground">
          <Hourglass className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            Waiting for approval: {formatValue(def, item.pending.value)} from {fmtDay(item.pending.effective_from)}. The current value
            stays in force until another administrator approves it.
          </span>
        </p>
      )}
      {warnings.map((w) => (
        <p key={w} className="rounded-xl border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-foreground">
          {w}
        </p>
      ))}
      {(rows.length > 0 || onExplain || (canLock && def.lockable)) && (
        <div className="flex flex-wrap items-center gap-2">
          {rows}
          <span className="flex-1" />
          {canLock && def.lockable && canEdit && onLocked && (
            <button
              type="button"
              onClick={() => onLocked(!locked)}
              aria-pressed={locked}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {locked ? <Lock className="h-3.5 w-3.5" aria-hidden /> : <Unlock className="h-3.5 w-3.5" aria-hidden />}
              {locked ? "Locked for lower levels" : "Lock for lower levels"}
            </button>
          )}
          {onExplain && (
            <button
              type="button"
              onClick={() => onExplain(def.key)}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-primary hover:bg-primary-soft"
            >
              <Info className="h-3.5 w-3.5" aria-hidden /> Why this value?
              <span className="sr-only"> ({def.label})</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ReferenceInput({ def, id, value, onChange, disabled, invalid, describedBy }: TypedInputProps) {
  const reference = typeof def.ui.reference === "string" ? def.ui.reference : "";
  const source = REFERENCE_SOURCES[reference];
  const { data } = useApi(() => api.get<{ id: number; name: string; code?: string }[]>(source), [source], { enabled: !!source });
  const text = typeof value === "string" ? value : "";
  if (!source) {
    return (
      <Input
        id={id}
        inputMode="numeric"
        value={text}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        placeholder={`${humanize(reference)} id`}
      />
    );
  }
  return (
    <Select id={id} value={text} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-invalid={invalid || undefined} aria-describedby={describedBy}>
      <option value="">Not set</option>
      {(data ?? []).map((o) => (
        <option key={o.id} value={String(o.id)}>
          {o.name}
        </option>
      ))}
      {text && !(data ?? []).some((o) => String(o.id) === text) && <option value={text}>#{text}</option>}
    </Select>
  );
}

interface TypedInputProps {
  def: SettingDefinition;
  id: string;
  value: DraftValue;
  onChange: (value: DraftValue) => void;
  disabled: boolean;
  invalid: boolean;
  describedBy: string;
}

/** The input matching a setting's type and `ui.control`. Values stay strings until saved. */
export function TypedInput(props: TypedInputProps) {
  const { def, id, value, onChange, disabled, invalid, describedBy } = props;
  const c = def.constraints as Record<string, unknown>;
  const common = { id, disabled, "aria-invalid": invalid || undefined, "aria-describedby": describedBy };
  const text = typeof value === "string" ? value : "";
  const groupId = useId();

  switch (def.type) {
    case "enum": {
      const choices = (c.choices as string[] | undefined) ?? [];
      return (
        <Select {...common} value={text} onChange={(e) => onChange(e.target.value)}>
          {(c.nullable === true || !text) && <option value="">Not set</option>}
          {choices.map((choice) => (
            <option key={choice} value={choice}>
              {humanize(choice)}
            </option>
          ))}
        </Select>
      );
    }
    case "int":
      return <Input {...common} inputMode="numeric" dir="ltr" className="max-w-[12rem]" value={text} onChange={(e) => onChange(e.target.value)} />;
    case "decimal":
      return <Input {...common} inputMode="decimal" dir="ltr" className="max-w-[12rem]" value={text} onChange={(e) => onChange(e.target.value)} />;
    case "date":
      return <Input {...common} type="date" className="max-w-[12rem]" value={text} onChange={(e) => onChange(e.target.value)} />;
    case "time":
      return <Input {...common} type="time" className="max-w-[10rem]" value={text} onChange={(e) => onChange(e.target.value)} />;
    case "ref":
      return <ReferenceInput {...props} />;
    case "money": {
      const money = (value as MoneyDraft | null) ?? { amount: "", currency: "" };
      return (
        <div className="flex w-full gap-2">
          <Input
            {...common}
            inputMode="decimal"
            dir="ltr"
            className="max-w-[12rem]"
            value={money.amount}
            onChange={(e) => onChange({ ...money, amount: e.target.value })}
          />
          <label htmlFor={`${id}-currency`} className="sr-only">
            Currency of {def.label}
          </label>
          <Select
            id={`${id}-currency`}
            className="max-w-[8rem]"
            disabled={disabled}
            value={money.currency}
            onChange={(e) => onChange({ ...money, currency: e.target.value })}
          >
            <option value="">Currency</option>
            {PAY_CURRENCIES.map((cur) => (
              <option key={cur.code} value={cur.code}>
                {cur.code}
              </option>
            ))}
          </Select>
        </div>
      );
    }
    case "set": {
      const chosen = Array.isArray(value) ? value : [];
      const choices = (c.choices as string[] | undefined) ?? [];
      return (
        <fieldset id={id} aria-describedby={describedBy} className="flex flex-wrap gap-2" disabled={disabled}>
          <legend className="sr-only">{def.label}</legend>
          {choices.map((choice) => {
            const inputId = `${groupId}-${choice}`;
            return (
              <label
                key={choice}
                htmlFor={inputId}
                className="inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-xl border border-border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
              >
                <input
                  id={inputId}
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={chosen.includes(choice)}
                  onChange={(e) => onChange(e.target.checked ? [...chosen, choice] : chosen.filter((x) => x !== choice))}
                />
                {humanize(choice)}
              </label>
            );
          })}
        </fieldset>
      );
    }
    case "json":
      return <Textarea {...common} dir="ltr" className="font-mono text-xs" value={text} onChange={(e) => onChange(e.target.value)} />;
    case "list":
      return <Input {...common} dir="ltr" placeholder="en-IN, ar-AE" value={text} onChange={(e) => onChange(e.target.value)} />;
    default:
      if (c.format === "iso4217") {
        return (
          <Select {...common} className="max-w-[16rem]" value={text} onChange={(e) => onChange(e.target.value)}>
            <option value="">{c.nullable === true || def.default === null ? "Entity currency (default)" : "Choose"}</option>
            {PAY_CURRENCIES.map((cur) => (
              <option key={cur.code} value={cur.code}>
                {cur.code} · {cur.name}
              </option>
            ))}
          </Select>
        );
      }
      return (
        <Input
          {...common}
          dir={def.ui.control === "pattern" ? "ltr" : undefined}
          className={cn(def.ui.control === "pattern" && "font-mono")}
          maxLength={typeof c.max_length === "number" ? c.max_length : undefined}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
