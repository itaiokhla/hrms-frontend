"use client";

import { Plus, Trash2 } from "lucide-react";
import { createContext, useContext, useEffect, useId, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch } from "@/components/ui/field";
import { Badge } from "@/components/ui/primitives";
import type {
  AttachmentCategory,
  EventType,
  LeaveTypeRule,
  LeaveTypeV2,
  PlanIssue,
} from "@/lib/leave/adminTypes";

import {
  defaultCompOff,
  entitlementSummary,
  getIn,
  issueAt,
  issuesUnder,
  requestSummary,
  yearEndSummary,
} from "./planModel";
import { ChipToggleGroup, Section, type Option } from "./shared";

/* ------------------------------------------------------------------ document context */

interface DocCtx {
  doc: unknown;
  set: (path: string, value: unknown) => void;
  /** Issues with paths relative to `doc`. */
  issues: PlanIssue[];
  readOnly: boolean;
  testPrefix: string;
}

const Ctx = createContext<DocCtx | null>(null);

function useDoc(): DocCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("Rule fields need a DocProvider");
  return ctx;
}

export function DocProvider({ value, children }: { value: DocCtx; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const tid = (prefix: string, path: string) => `${prefix}-${path.replace(/[[\].]+/g, "-").replace(/-$/, "")}`;

/* ------------------------------------------------------------------ field components */

type Opt<T extends string> = readonly (readonly [T, string])[];

export function DecField({ path, label, hint, nullable, placeholder, className }: {
  path: string;
  label: string;
  hint?: ReactNode;
  nullable?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const c = useDoc();
  const value = getIn(c.doc, path);
  return (
    <Field label={label} hint={hint} error={issueAt(c.issues, path)} className={className}>
      <Input
        inputMode="decimal"
        value={value === null || value === undefined ? "" : String(value)}
        placeholder={placeholder ?? (nullable ? "No limit" : undefined)}
        disabled={c.readOnly}
        onChange={(e) => c.set(path, nullable && e.target.value.trim() === "" ? null : e.target.value)}
        data-testid={tid(c.testPrefix, path)}
      />
    </Field>
  );
}

export function IntField({ path, label, hint, nullable, placeholder, className }: {
  path: string;
  label: string;
  hint?: ReactNode;
  nullable?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const c = useDoc();
  const value = getIn(c.doc, path);
  return (
    <Field label={label} hint={hint} error={issueAt(c.issues, path)} className={className}>
      <Input
        inputMode="numeric"
        value={value === null || value === undefined ? "" : String(value)}
        placeholder={placeholder ?? (nullable ? "Not set" : undefined)}
        disabled={c.readOnly}
        onChange={(e) => {
          const text = e.target.value.trim();
          c.set(path, text === "" ? null : /^-?\d+$/.test(text) ? Number(text) : text);
        }}
        data-testid={tid(c.testPrefix, path)}
      />
    </Field>
  );
}

export function SelectField<T extends string>({ path, label, options, hint, className, onPick }: {
  path: string;
  label: string;
  options: Opt<T>;
  hint?: ReactNode;
  className?: string;
  /** Replaces the plain write (to set dependent fields too). */
  onPick?: (value: T) => void;
}) {
  const c = useDoc();
  const value = String(getIn(c.doc, path) ?? "");
  return (
    <Field label={label} hint={hint} error={issueAt(c.issues, path)} className={className}>
      <Select value={value} disabled={c.readOnly} onChange={(e) => (onPick ? onPick(e.target.value as T) : c.set(path, e.target.value))}
        data-testid={tid(c.testPrefix, path)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>
    </Field>
  );
}

export function BoolField({ path, label, hint }: { path: string; label: string; hint?: ReactNode }) {
  const c = useDoc();
  const id = useId();
  const error = issueAt(c.issues, path);
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
      <div className="min-w-0">
        <p id={id} className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        {error && <p className="text-xs font-medium text-danger" role="alert">{error}</p>}
      </div>
      <Switch checked={!!getIn(c.doc, path)} disabled={c.readOnly} onChange={(v) => c.set(path, v)} aria-labelledby={id} />
    </div>
  );
}

export function ChipsField<T extends string | number>({ path, label, options, nullWhenEmpty = true }: {
  path: string;
  label: string;
  options: { value: T; label: string }[];
  nullWhenEmpty?: boolean;
}) {
  const c = useDoc();
  const value = (getIn(c.doc, path) as T[] | null) ?? [];
  const error = issueAt(c.issues, path);
  return (
    <div className="space-y-1">
      <ChipToggleGroup label={label} options={options} value={value} disabled={c.readOnly} testId={tid(c.testPrefix, path)}
        onChange={(next) => c.set(path, nullWhenEmpty && !next.length ? null : next)} />
      {error && <p className="text-xs font-medium text-danger" role="alert">{error}</p>}
    </div>
  );
}

/** Comma-separated codes (`employment_types`, `countries`): typed freely, stored as a list (or null when empty). */
export function CodesField({ path, label, hint, upper }: { path: string; label: string; hint?: ReactNode; upper?: boolean }) {
  const c = useDoc();
  const value = (getIn(c.doc, path) as string[] | null) ?? [];
  const joined = value.join(", ");
  const [text, setText] = useState(joined);
  useEffect(() => {
    const parsed = text.split(/[\s,]+/).filter(Boolean).join(", ");
    if (parsed !== joined) setText(joined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined]);
  return (
    <Field label={label} hint={hint ?? "Comma-separated"} error={issueAt(c.issues, path)}>
      <Input
        dir="ltr"
        value={text}
        disabled={c.readOnly}
        onChange={(e) => {
          const raw = upper ? e.target.value.toUpperCase() : e.target.value;
          setText(raw);
          const items = raw.split(/[\s,]+/).filter(Boolean);
          c.set(path, items.length ? items : null);
        }}
        data-testid={tid(c.testPrefix, path)}
      />
    </Field>
  );
}

/** An optional block: a switch that sets the object to its default or to null. */
export function OptionalBlock({ path, label, hint, make, children }: {
  path: string;
  label: string;
  hint?: ReactNode;
  make: () => unknown;
  children: ReactNode;
}) {
  const c = useDoc();
  const id = useId();
  const on = getIn(c.doc, path) !== null && getIn(c.doc, path) !== undefined;
  return (
    <div className="rounded-xl border border-border">
      <div className="flex items-start justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0">
          <p id={id} className="text-sm font-medium">{label}</p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        <Switch checked={on} disabled={c.readOnly} onChange={(v) => c.set(path, v ? make() : null)} aria-labelledby={id} />
      </div>
      {on && <div className="space-y-3 border-t border-border/70 p-3">{children}</div>}
    </div>
  );
}

/** A list of rows (caps, notice scale, slabs…) with add / remove. */
export function RowsField({ path, label, hint, make, addLabel, children }: {
  path: string;
  label: string;
  hint?: ReactNode;
  make: () => unknown;
  addLabel: string;
  children: (rowPath: string, index: number) => ReactNode;
}) {
  const c = useDoc();
  const rows = (getIn(c.doc, path) as unknown[] | null) ?? [];
  const error = issueAt(c.issues, path);
  return (
    <fieldset className="space-y-2">
      <legend className="text-[13px] font-medium">{label}</legend>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {rows.map((_, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2 rounded-xl border border-border/70 bg-surface-muted/30 p-2">
          {children(`${path}[${i}]`, i)}
          {!c.readOnly && (
            <Button variant="danger-ghost" size="icon" aria-label={`Remove ${label.toLowerCase()} row ${i + 1}`}
              onClick={() => c.set(path, rows.filter((__, j) => j !== i))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ))}
      {error && <p className="text-xs font-medium text-danger" role="alert">{error}</p>}
      {!c.readOnly && (
        <Button variant="ghost" size="sm" onClick={() => c.set(path, [...rows, make()])} data-testid={tid(c.testPrefix, `${path}-add`)}>
          <Plus className="h-4 w-4" /> {addLabel}
        </Button>
      )}
    </fieldset>
  );
}

function Grid({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 }) {
  return <div className={cols === 3 ? "grid gap-3 sm:grid-cols-3" : "grid gap-3 sm:grid-cols-2"}>{children}</div>;
}

/* ------------------------------------------------------------------ choices */

const CYCLE_KINDS = [["CALENDAR_YEAR", "Calendar year"], ["FISCAL_YEAR", "Legal entity's fiscal year"], ["ANNIVERSARY", "Work anniversary"], ["CUSTOM", "Custom start day"]] as const;
const SCOPES = [["CYCLE", "One balance per leave year"], ["LOTS", "Expiring credits (comp-off)"], ["EVENT", "Per event"]] as const;
const BASES = [["WORKING_DAYS", "Working days"], ["CALENDAR_DAYS", "Calendar days"], ["CALENDAR_EXCL_HOLIDAYS", "Calendar days except holidays"], ["FIXED_WEEKDAYS", "Fixed weekdays"]] as const;
const METHODS = [
  ["FRONT_LOADED", "All at once at the start of the year"], ["PERIODIC", "Accrued through the year"], ["TENURE_SLABS", "By length of service"],
  ["PER_DAYS_WORKED", "Per days worked"], ["EVENT_GRANT", "Per event"], ["NONE", "No yearly entitlement"],
] as const;
const FREQUENCIES = [["MONTHLY", "Monthly"], ["QUARTERLY", "Quarterly"], ["HALF_YEARLY", "Half-yearly"]] as const;
const POST_AT = [["START", "Start of each period"], ["END", "End of each period"]] as const;
const PRORATE = [["PRORATE", "Pro-rata share"], ["FULL", "Full amount"]] as const;
const ROUNDING = [["NONE_2DP", "No rounding (2 decimals)"], ["NEAREST_HALF", "Nearest half"], ["UP_HALF", "Up to a half"], ["DOWN_HALF", "Down to a half"], ["NEAREST_QUARTER", "Nearest quarter"], ["NEAREST_WHOLE", "Nearest whole"]] as const;
const PROBATION = [["ALLOW", "Allowed"], ["ACCRUE_ONLY", "Accrues, cannot be used"], ["BLOCK", "Not available"]] as const;
const NOTICE = [["ALLOW", "Allowed"], ["BLOCK", "Not available"], ["ALLOW_EXTENDS_LWD", "Allowed, extends the last working day"]] as const;
const GENDERS = [["FEMALE", "Female"], ["MALE", "Male"], ["OTHER", "Other"], ["UNSPECIFIED", "Not recorded"]] as const;
const WORKER_CLASSES = [["EMPLOYEE", "Employees"], ["CONTRACTOR", "Contractors"], ["INTERN", "Interns"], ["APPRENTICE", "Apprentices"]] as const;
const UNKNOWN_GENDER = [["ELIGIBLE_VERIFY", "Eligible, HR verifies"], ["NOT_ELIGIBLE", "Not eligible"]] as const;
const TENURE_UNITS = [["DAYS", "Days"], ["MONTHS", "Months"], ["YEARS", "Years"]] as const;
const TENURE_BASIS = [["SERVICE_START", "Service start"], ["HIRE_DATE", "Hire date"], ["CONFIRMATION", "Confirmation"]] as const;
const TENURE_MODE = [["BLOCK_USE", "Accrues, usable once reached"], ["NO_ENTITLEMENT", "Nothing until reached"]] as const;
const SANDWICH = [["OFF", "Off"], ["WEEKLY_OFFS", "Weekly offs"], ["HOLIDAYS", "Holidays"], ["BOTH", "Weekly offs and holidays"]] as const;
const EDGES = [["IGNORE", "Half days do not close it"], ["COUNT", "Half days close it"]] as const;
const BALANCE_CHECK = [["CURRENT", "Current balance"], ["PROJECTED", "Projected (incl. future accrual)"]] as const;
const SHORT = [["BLOCK", "Refuse the request"], ["ALLOW_NEGATIVE", "Allow a negative balance"], ["SPLIT_TO_UNPAID", "Split the excess to unpaid leave"]] as const;
const NEG_END = [["CARRY_NEGATIVE", "Carry it into the next year"], ["WRITE_OFF", "Write it off"]] as const;
const PORTIONS = [["INHERIT", "Follow the type's half-day setting"], ["FULL_ONLY", "Full days only"], ["HOURS_ALLOWED", "Hours allowed"]] as const;
const CAP_PERIODS = [["MONTH", "Month"], ["QUARTER", "Quarter"], ["CYCLE", "Leave year"], ["ROLLING_12M", "Rolling 12 months"]] as const;
const INSTANCE_PERIODS = [...CAP_PERIODS, ["LIFETIME", "Employment"]] as const;
const NOTICE_UNITS = [["CALENDAR_DAYS", "Calendar days"], ["WORKING_DAYS", "Working days"]] as const;
const ADJACENT = [["ALLOW", "Allow"], ["WARN", "Warn the approver"], ["BLOCK", "Refuse"]] as const;
const APPLY = [["APPLY", "Apply"], ["EXEMPT", "Exempt"]] as const;
const REASON = [["OPTIONAL", "Optional"], ["REQUIRED", "Required"], ["HIDDEN", "Hidden"]] as const;
const DOC_WHEN = [["ALWAYS", "Always"], ["MIN_UNITS", "From a number of units"], ["MIN_CALENDAR_DAYS", "From a number of calendar days"], ["BACKDATED", "When back-dated"], ["ADJACENT_NON_WORKING", "Next to a weekly off or holiday"]] as const;
const DOC_DUE = [["AT_SUBMIT", "When submitting"], ["BEFORE_DECISION", "Before the decision"], ["WITHIN_DAYS_AFTER_RETURN", "Within days after returning"], ["WITHIN_DAYS_AFTER_SUBMIT", "Within days after submitting"]] as const;
const VERIFY = [["NONE", "No verification"], ["AFTER_APPROVAL", "HR verifies after approval"], ["BEFORE_APPROVAL", "HR verifies before approval"]] as const;
const CANCEL = [["INHERIT", "Follow the company setting"], ["ALWAYS", "Always needs approval"], ["NEVER", "Never needs approval"]] as const;
const DURATION = [["CALENDAR_DAYS", "Calendar days"], ["WORKING_DAYS", "Working days"], ["WEEKS", "Weeks"]] as const;
const TRIGGERS = [["EXIT", "On exit"], ["YEAR_END", "At year end (above the carry cap)"], ["ON_REQUEST", "On request"]] as const;
const EARN_ON = [["HOLIDAY", "Holidays"], ["WEEKLY_OFF", "Weekly offs"]] as const;
export const DOC_CATEGORIES: readonly (readonly [AttachmentCategory, string])[] = [
  ["MEDICAL_CERTIFICATE", "Medical certificate"], ["FIT_TO_WORK", "Fit-to-work note"], ["PARENTAL_EVIDENCE", "Parental evidence"],
  ["BEREAVEMENT_EVIDENCE", "Bereavement evidence"], ["MARRIAGE_EVIDENCE", "Marriage evidence"], ["OFFICIAL_SUMMONS", "Official summons"],
  ["STUDY_EVIDENCE", "Study evidence"], ["TRAVEL_DOCUMENT", "Travel document"], ["SUPPORTING_DOCUMENT", "Supporting document"],
];
const EVENTS: readonly (readonly [EventType, string])[] = [
  ["EXPECTED_DELIVERY", "Expected delivery"], ["BIRTH", "Birth"], ["ADOPTION_HANDOVER", "Adoption"], ["SURROGACY_HANDOVER", "Surrogacy"],
  ["PREGNANCY_LOSS", "Pregnancy loss"], ["REPRODUCTIVE_PROCEDURE", "Reproductive procedure"], ["DEATH", "Death"], ["MARRIAGE", "Marriage"],
  ["PILGRIMAGE", "Pilgrimage"], ["SABBATICAL_ELIGIBILITY", "Sabbatical eligibility"], ["LONG_ILLNESS", "Long illness"], ["OTHER", "Other"],
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const chips = <T extends string>(opts: readonly (readonly [T, string])[]) => opts.map(([value, label]) => ({ value, label }));

/* ------------------------------------------------------------------ one type rule */

/**
 * The editor of one type rule (03-leave/01 §5.4–§8): accordion sections with a plain-language summary; inline
 * errors come from the client checks and the server (`issues` with paths relative to the rule).
 */
export function TypeRuleEditor({ rule, type, types, branches, issues, readOnly, onChange }: {
  rule: LeaveTypeRule;
  type?: LeaveTypeV2;
  types: LeaveTypeV2[];
  branches: Option[];
  issues: PlanIssue[];
  readOnly: boolean;
  onChange: (path: string, value: unknown) => void;
}) {
  const unit = type?.unit ?? "DAY";
  const u = unit === "HOUR" ? "hours" : "days";
  const count = (path: string) => issuesUnder(issues, path).length;
  const ent = rule.entitlement;
  const setMethod = (method: string) => {
    onChange("entitlement", {
      ...ent,
      method,
      frequency: method === "PERIODIC" ? ent.frequency ?? "MONTHLY" : null,
      post_at: method === "PERIODIC" ? ent.post_at ?? "END" : null,
      per_days_worked: method === "PER_DAYS_WORKED" ? ent.per_days_worked ?? 20 : null,
      tenure_slabs: method === "TENURE_SLABS" ? ent.tenure_slabs ?? [{ from_months: 0, amount: ent.amount || "0" }] : null,
    });
  };
  const setShort = (action: string) => {
    onChange("insufficient_balance_action", action);
    if (action === "ALLOW_NEGATIVE" && Number(rule.negative_allowance) <= 0) onChange("negative_allowance", "1");
    if (action !== "ALLOW_NEGATIVE") onChange("negative_allowance", "0");
  };
  const otherTypes = types.filter((t) => t.code !== rule.leave_type_code).map((t) => ({ value: t.code, label: t.name }));

  return (
    <DocProvider value={{ doc: rule, set: onChange, issues, readOnly, testPrefix: `rule-${rule.leave_type_code}` }}>
      <div className="space-y-3" data-testid={`rule-editor-${rule.leave_type_code}`}>
        {rule.frozen && (
          <p className="rounded-xl border border-border bg-surface-muted/60 px-3 py-2 text-xs text-muted-foreground">
            Frozen by the system: kept only so year end can settle the balance of an inactive type. You may delete this rule, not edit its flag.
          </p>
        )}
        {issueAt(issues, "leave_type_code") && <p role="alert" className="text-sm font-medium text-danger">{issueAt(issues, "leave_type_code")}</p>}

        <Section title="Leave year and balance" summary={`${rule.cycle ? CYCLE_KINDS.find(([k]) => k === rule.cycle?.kind)?.[1] : "Plan default year"} · ${SCOPES.find(([k]) => k === rule.balance_scope.kind)?.[1]}`}
          issueCount={count("cycle") + count("balance_scope")} testId="section-basics">
          <OptionalBlock path="cycle" label="Own leave year" hint="Off: the plan's default leave year applies." make={() => ({ kind: "CALENDAR_YEAR", custom_start: null })}>
            <Grid>
              <SelectField path="cycle.kind" label="Leave year" options={CYCLE_KINDS} />
              {rule.cycle?.kind === "CUSTOM" && <DecField path="cycle.custom_start" label="First day (MM-DD)" placeholder="04-01" />}
            </Grid>
          </OptionalBlock>
          <Grid>
            <SelectField path="balance_scope.kind" label="Balance kept as" options={SCOPES}
              hint={type?.kind === "COMP_OFF" ? "Comp-off keeps expiring credits." : type?.kind === "EVENT" ? "Event leave is counted per event." : undefined} />
          </Grid>
          <BoolField path="keep_on_plan_exit" label="Keep the balance after moving to a plan without this type" hint="The remaining units stay bookable." />
        </Section>

        <Section title="Eligibility" summary={eligibilitySummary(rule)} issueCount={count("eligibility") + count("during_probation") + count("during_notice")} testId="section-eligibility">
          <ChipsField path="eligibility.genders" label="Only these genders (none = everyone)" options={chips(GENDERS)} />
          {!!rule.eligibility.genders?.length && <SelectField path="eligibility.unknown_gender" label="When gender is not recorded" options={UNKNOWN_GENDER} />}
          <ChipsField path="eligibility.worker_classes" label="Only these worker classes (none = everyone)" options={chips(WORKER_CLASSES)} />
          <Grid>
            <CodesField path="eligibility.employment_types" label="Only these employment types" hint="Codes, comma-separated; blank = all." />
            <CodesField path="eligibility.countries" label="Only branches in these countries" hint="ISO codes such as IN, AE; blank = all." upper />
          </Grid>
          {branches.length > 0 && (
            <ChipsField path="eligibility.branch_ids" label="Only these branches (none = every branch)" options={branches.map((b) => ({ value: b.id, label: b.label }))} />
          )}
          <Grid>
            <DecField path="eligibility.min_fte" label="Least full-time equivalent" nullable placeholder="Any" hint="e.g. 0.5 for half-time and above." />
          </Grid>
          <OptionalBlock path="eligibility.min_tenure" label="Waiting period" hint="Service needed before the leave can be used (or earned)."
            make={() => ({ value: 6, unit: "MONTHS", basis: "SERVICE_START", mode: "BLOCK_USE" })}>
            <Grid>
              <IntField path="eligibility.min_tenure.value" label="Length" />
              <SelectField path="eligibility.min_tenure.unit" label="Unit" options={TENURE_UNITS} />
              <SelectField path="eligibility.min_tenure.basis" label="Counted from" options={TENURE_BASIS} />
              <SelectField path="eligibility.min_tenure.mode" label="Until then" options={TENURE_MODE} />
            </Grid>
          </OptionalBlock>
          <Grid>
            <SelectField path="during_probation" label="During probation" options={PROBATION} />
            <SelectField path="during_notice" label="During the notice period" options={NOTICE} hint="Never blocks statutory, protected or event leave." />
          </Grid>
        </Section>

        <Section title="Entitlement and accrual" summary={entitlementSummary(rule, unit)} issueCount={count("entitlement") + count("accrual_cap") + count("max_balance")} defaultOpen testId="section-entitlement">
          <Grid>
            <SelectField path="entitlement.method" label="How it is credited" options={METHODS} onPick={setMethod} />
            {ent.method !== "NONE" && ent.method !== "EVENT_GRANT" && ent.method !== "TENURE_SLABS" && (
              <DecField path="entitlement.amount" label={`Yearly amount (${u})`} hint={ent.method === "PER_DAYS_WORKED" ? "Upper limit per year." : undefined} />
            )}
            {ent.method === "PERIODIC" && (
              <>
                <SelectField path="entitlement.frequency" label="Credited" options={FREQUENCIES} />
                <SelectField path="entitlement.post_at" label="Credited at" options={POST_AT} />
              </>
            )}
            {ent.method === "PER_DAYS_WORKED" && <IntField path="entitlement.per_days_worked" label="One unit per … days worked" />}
          </Grid>
          {ent.method === "TENURE_SLABS" && (
            <RowsField path="entitlement.tenure_slabs" label="Tenure slabs" hint="Yearly amount by months of service; the first slab starts at 0." addLabel="Add slab"
              make={() => {
                const slabs = ent.tenure_slabs ?? [];
                return { from_months: slabs.length ? slabs[slabs.length - 1].from_months + 12 : 0, amount: "0" };
              }}>
              {(p) => (
                <>
                  <IntField path={`${p}.from_months`} label="From month" className="w-32" />
                  <DecField path={`${p}.amount`} label={`Yearly ${u}`} className="w-32" />
                </>
              )}
            </RowsField>
          )}
          <Grid cols={3}>
            <IntField path="entitlement.credit_expiry_months" label="Credits expire after (months)" nullable placeholder="Never" />
            <DecField path="accrual_cap" label={`Stop accruing at (${u})`} nullable />
            <DecField path="max_balance" label={`Balance ceiling (${u})`} nullable />
          </Grid>
          <Grid cols={3}>
            <SelectField path="proration.joiner" label="Joiners get" options={PRORATE} />
            <SelectField path="proration.leaver" label="Leavers keep" options={PRORATE} />
            <SelectField path="rounding.mode" label="Rounding of credits" options={ROUNDING} />
          </Grid>
        </Section>

        <Section title="Counting and sandwich" summary={`${BASES.find(([k]) => k === rule.counting_basis.basis)?.[1]} · sandwich ${rule.sandwich.mode === "OFF" ? "off" : rule.sandwich.mode.toLowerCase().replace("_", " ")}`}
          issueCount={count("counting_basis") + count("sandwich")} testId="section-counting">
          <Grid>
            <SelectField path="counting_basis.basis" label="Charged dates" options={BASES}
              onPick={(basis) => onChange("counting_basis", { basis, weekdays: basis === "FIXED_WEEKDAYS" ? rule.counting_basis.weekdays ?? [0, 1, 2, 3, 4] : null })} />
          </Grid>
          {rule.counting_basis.basis === "FIXED_WEEKDAYS" && (
            <ChipsField path="counting_basis.weekdays" label="Charged weekdays" options={WEEKDAYS.map((label, value) => ({ value, label }))} nullWhenEmpty={false} />
          )}
          <Grid>
            <SelectField path="sandwich.mode" label="Count days between two leave days as leave" options={SANDWICH} />
            <SelectField path="sandwich.half_day_edges" label="Half days next to the gap" options={EDGES} />
          </Grid>
        </Section>

        <Section title="When the balance is short" summary={SHORT.find(([k]) => k === rule.insufficient_balance_action)?.[1]}
          issueCount={count("balance_check") + count("insufficient_balance_action") + count("negative_allowance") + count("negative_at_cycle_end")} testId="section-balance">
          <Grid>
            <SelectField path="balance_check" label="Compare the request with" options={BALANCE_CHECK} />
            <SelectField path="insufficient_balance_action" label="If the balance is short" options={SHORT} onPick={setShort} />
            {rule.insufficient_balance_action === "ALLOW_NEGATIVE" && <DecField path="negative_allowance" label={`How far below zero (${u})`} />}
            <SelectField path="negative_at_cycle_end" label="A negative balance at year end" options={NEG_END} />
          </Grid>
          {issueAt(issues, "negative_allowance") && rule.insufficient_balance_action !== "ALLOW_NEGATIVE" && (
            <p className="text-xs font-medium text-danger" role="alert">{issueAt(issues, "negative_allowance")}</p>
          )}
        </Section>

        <Section title="Year end and encashment" summary={yearEndSummary(rule)} issueCount={count("carry_forward") + count("encashment")} testId="section-year-end">
          <Grid>
            <div className="space-y-2">
              <DecField path="carry_forward.cap" label={`Carry forward at most (${u})`} nullable placeholder="Everything" hint="0 = nothing carries; blank = everything." />
            </div>
            <IntField path="carry_forward.expiry_months" label="Carried units expire after (months)" nullable placeholder="Never" />
          </Grid>
          <BoolField path="encashment.eligible" label="Unused units can be paid out" hint="The amount comes from the leave pay policy in Payroll." />
          {rule.encashment.eligible && (
            <>
              <ChipsField path="encashment.triggers" label="When" options={chips(TRIGGERS)} nullWhenEmpty={false} />
              <Grid cols={3}>
                <DecField path="encashment.max_units_per_cycle" label={`Most per year (${u})`} nullable />
                <DecField path="encashment.min_balance_after" label={`Keep at least (${u})`} nullable placeholder="Nothing" hint="On-request encashment." />
                <DecField path="encashment.step" label="In steps of" hint="e.g. 0.5" />
              </Grid>
            </>
          )}
        </Section>

        <Section title="Request rules" summary={requestSummary(rule)} issueCount={count("request")} testId="section-request">
          <div className="grid gap-3 sm:grid-cols-2">
            <BoolField path="request.self_service" label="Employees apply themselves" />
            <BoolField path="request.on_behalf" label="Managers and HR may apply for them" />
          </div>
          <Grid cols={3}>
            <SelectField path="request.portions" label="Portions" options={PORTIONS} />
            <DecField path="request.min_units" label={`Smallest request (${u})`} nullable placeholder="Any" />
            <DecField path="request.max_units" label={`Largest request (${u})`} nullable />
            <DecField path="request.max_consecutive_units" label={`Most in a row (${u})`} nullable hint="Including adjoining requests." />
            <IntField path="request.backdate_limit_days" label="Back-dating allowed (days)" hint="0 = no back-dated requests." />
            <IntField path="request.future_limit_days" label="Book up to (days ahead)" />
          </Grid>
          <RowsField path="request.caps" label="Most units per period" addLabel="Add limit" make={() => ({ period: "MONTH", max_units: "3" })}>
            {(p) => (
              <>
                <SelectField path={`${p}.period`} label="Period" options={CAP_PERIODS} className="w-44" />
                <DecField path={`${p}.max_units`} label={`At most (${u})`} className="w-32" />
              </>
            )}
          </RowsField>
          <RowsField path="request.max_instances" label="Most requests per period" addLabel="Add limit" make={() => ({ period: "CYCLE", max_requests: 4 })}>
            {(p) => (
              <>
                <SelectField path={`${p}.period`} label="Period" options={INSTANCE_PERIODS} className="w-44" />
                <IntField path={`${p}.max_requests`} label="Requests" className="w-28" />
              </>
            )}
          </RowsField>
          <OptionalBlock path="request.min_notice" label="Advance notice" hint="Requests must start this long after they are made."
            make={() => ({ value: 1, unit: "CALENDAR_DAYS", scale: [] })}>
            <Grid>
              <IntField path="request.min_notice.value" label="Notice" />
              <SelectField path="request.min_notice.unit" label="Counted in" options={NOTICE_UNITS} />
            </Grid>
            <RowsField path="request.min_notice.scale" label="Longer requests need longer notice" addLabel="Add step"
              make={() => ({ min_units: "5", value: 14 })}>
              {(p) => (
                <>
                  <DecField path={`${p}.min_units`} label={`From (${u})`} className="w-28" />
                  <IntField path={`${p}.value`} label="Notice" className="w-28" />
                </>
              )}
            </RowsField>
          </OptionalBlock>
          <OptionalBlock path="request.emergency_exception" label="Emergency exception" hint="Short notice is allowed when the employee marks the request as an emergency."
            make={() => ({ enabled: true, max_units: "1", reason_required: true })}>
            <Grid>
              <DecField path="request.emergency_exception.max_units" label={`Largest emergency request (${u})`} />
            </Grid>
            <div className="grid gap-3 sm:grid-cols-2">
              <BoolField path="request.emergency_exception.enabled" label="Emergency requests allowed" />
              <BoolField path="request.emergency_exception.reason_required" label="Reason required" />
            </div>
          </OptionalBlock>
          <ChipsField path="request.clubbing.not_with" label="May not be joined to" options={otherTypes} nullWhenEmpty={false} />
          <Grid cols={3}>
            <IntField path="request.clubbing.gap_days" label="Working days needed between them" />
            <SelectField path="request.adjacent_non_working" label="Next to a weekly off or holiday" options={ADJACENT} />
            <SelectField path="request.reason" label="Reason field" options={REASON} />
            <SelectField path="request.blackouts" label="Blackout periods" options={APPLY} />
            <SelectField path="request.coverage" label="Minimum staffing rules" options={APPLY} />
          </Grid>
        </Section>

        <Section title="Documents" summary={rule.documents.required.length ? `${rule.documents.required.length} requirement(s)` : rule.documents.allowed ? "Optional uploads" : "No uploads"}
          issueCount={count("documents")} testId="section-documents">
          <BoolField path="documents.allowed" label="Employees may attach documents" />
          <RowsField path="documents.required" label="Required when" addLabel="Add requirement"
            make={() => ({ when: "MIN_UNITS", min_units: "3", category: "SUPPORTING_DOCUMENT" })}>
            {(p, i) => (
              <>
                <SelectField path={`${p}.when`} label="When" options={DOC_WHEN} className="w-56"
                  onPick={(when) => onChange(`documents.required[${i}]`, {
                    ...rule.documents.required[i], when,
                    min_units: when === "MIN_UNITS" || when === "MIN_CALENDAR_DAYS" ? rule.documents.required[i]?.min_units ?? "3" : null,
                  })} />
                {(rule.documents.required[i]?.when === "MIN_UNITS" || rule.documents.required[i]?.when === "MIN_CALENDAR_DAYS") && (
                  <DecField path={`${p}.min_units`} label="From" className="w-24" />
                )}
                <SelectField path={`${p}.category`} label="Document" options={DOC_CATEGORIES} className="w-52" />
              </>
            )}
          </RowsField>
          <Grid cols={3}>
            <SelectField path="documents.due" label="Due" options={DOC_DUE}
              onPick={(due) => onChange("documents", { ...rule.documents, due, due_days: due.startsWith("WITHIN_DAYS") ? rule.documents.due_days ?? 3 : null })} />
            {rule.documents.due.startsWith("WITHIN_DAYS") && <IntField path="documents.due_days" label="Days allowed" />}
            <SelectField path="documents.verification" label="Verification" options={VERIFY} />
          </Grid>
        </Section>

        <Section title="Approval and changes" summary={`${rule.approval.auto_approve_eligible ? "Auto-approved when clean" : "Approver decides"} · recall ${rule.change.recall_allowed ? "allowed" : "not allowed"}`}
          issueCount={count("approval") + count("change")} testId="section-approval">
          <BoolField path="approval.auto_approve_eligible" label="Approve automatically" hint="Requests without warnings skip the approval chain." />
          <Grid>
            <SelectField path="change.cancellation_requires_approval" label="Cancelling approved leave" options={CANCEL} />
          </Grid>
          <BoolField path="change.recall_allowed" label="A manager may recall the employee from approved leave" />
        </Section>

        {(rule.balance_scope.kind === "EVENT" || rule.event || type?.kind === "EVENT") && (
          <Section title="Event" summary={rule.event ? `${rule.event.entitlement_units} ${rule.event.duration_unit.toLowerCase().replace("_", " ")} per event` : "Not described"}
            issueCount={count("event")} defaultOpen={!rule.event} testId="section-event">
            <OptionalBlock path="event" label="Event rules" hint="Which events give this leave and how much each gives."
              make={() => ({ event_types: ["OTHER"], entitlement_units: "1", duration_unit: "CALENDAR_DAYS", earliest_start_offset_days: 0, take_within_days: null, max_occurrences: null })}>
              <ChipsField path="event.event_types" label="Events" options={chips(EVENTS)} nullWhenEmpty={false} />
              <Grid cols={3}>
                <DecField path="event.entitlement_units" label="Units per event" />
                <SelectField path="event.duration_unit" label="Counted in" options={DURATION} />
                <IntField path="event.earliest_start_offset_days" label="Earliest start (days before)" hint="0 or negative, e.g. -56." />
                <IntField path="event.take_within_days" label="Must end within (days after)" nullable placeholder="No limit" />
                <IntField path="event.max_occurrences" label="Events per employment" nullable placeholder="No limit" />
              </Grid>
            </OptionalBlock>
          </Section>
        )}
      </div>
    </DocProvider>
  );
}

function eligibilitySummary(rule: LeaveTypeRule): string {
  const e = rule.eligibility;
  const parts: string[] = [];
  if (e.genders?.length) parts.push(e.genders.map((g) => g.toLowerCase()).join("/"));
  if (e.worker_classes?.length) parts.push(e.worker_classes.map((g) => g.toLowerCase()).join("/"));
  if (e.employment_types?.length) parts.push(`${e.employment_types.length} employment type(s)`);
  if (e.countries?.length) parts.push(e.countries.join(", "));
  if (e.min_tenure) parts.push(`after ${e.min_tenure.value} ${e.min_tenure.unit.toLowerCase()}`);
  if (rule.during_probation !== "ALLOW") parts.push(rule.during_probation === "BLOCK" ? "not in probation" : "accrues in probation");
  return parts.length ? parts.join(" · ") : "Everyone in the plan";
}

/* ------------------------------------------------------------------ plan-level settings */

/** Plan defaults (the leave year) and the comp-off claim rules (needed when a comp-off type is in the plan). */
export function PlanSettingsEditor({ plan, issues, readOnly, onChange, hasCompOff }: {
  plan: unknown;
  issues: PlanIssue[];
  readOnly: boolean;
  onChange: (path: string, value: unknown) => void;
  hasCompOff: boolean;
}) {
  const cycleKind = String(getIn(plan, "defaults.cycle.kind") ?? "CALENDAR_YEAR");
  const compOff = getIn(plan, "comp_off");
  return (
    <DocProvider value={{ doc: plan, set: onChange, issues, readOnly, testPrefix: "plan" }}>
      <div className="space-y-4" data-testid="plan-settings">
        <Section title="Default leave year" summary={CYCLE_KINDS.find(([k]) => k === cycleKind)?.[1]} issueCount={issuesUnder(issues, "defaults").length} defaultOpen>
          <Grid>
            <SelectField path="defaults.cycle.kind" label="Leave year of every type without its own" options={CYCLE_KINDS}
              onPick={(kind) => onChange("defaults.cycle", { kind, custom_start: kind === "CUSTOM" ? "04-01" : null })} />
            {cycleKind === "CUSTOM" && <DecField path="defaults.cycle.custom_start" label="First day (MM-DD)" placeholder="04-01" hint="Never 02-29." />}
          </Grid>
        </Section>
        <Section title="Comp-off claims" summary={compOff ? "Claim rules set" : hasCompOff ? "Required: a comp-off type is in this plan" : "Not used"}
          issueCount={issuesUnder(issues, "comp_off").length} defaultOpen={hasCompOff}>
          {hasCompOff && !compOff && <Badge tone="warning">A comp-off type needs these rules</Badge>}
          <OptionalBlock path="comp_off" label="Comp-off claim rules" hint="Work on holidays or weekly offs can be claimed as compensatory leave." make={defaultCompOff}>
            <ChipsField path="comp_off.earn_on" label="Work on these days can be claimed" options={chips(EARN_ON)} nullWhenEmpty={false} />
            <Grid cols={3}>
              <IntField path="comp_off.claim_window_days" label="Claim within (days)" />
              <IntField path="comp_off.validity_days" label="Usable for (days)" />
              <IntField path="comp_off.min_usable_days" label="Usable at least (days)" />
              <DecField path="comp_off.max_units_per_month" label="Most credited per month" nullable />
            </Grid>
            <RowsField path="comp_off.credit_slabs" label="Worked minutes to credited units" addLabel="Add slab" make={() => ({ min_worked_minutes: 600, units: "1" })}>
              {(p) => (
                <>
                  <IntField path={`${p}.min_worked_minutes`} label="From minutes worked" className="w-40" />
                  <DecField path={`${p}.units`} label="Units" className="w-28" />
                </>
              )}
            </RowsField>
          </OptionalBlock>
        </Section>
      </div>
    </DocProvider>
  );
}
