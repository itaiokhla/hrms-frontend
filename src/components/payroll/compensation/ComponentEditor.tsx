"use client";

import { Archive, ArchiveRestore, Lock, Save, Tag, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import toast from "react-hot-toast";

import { useCan } from "@/components/access/Can";
import { DiffView, type DiffRow } from "@/components/payroll/DiffView";
import { Timeline, type TimelineItem } from "@/components/payroll/Timeline";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/layout";
import { useConfirm } from "@/components/ui/overlay";
import { Card, CardHeader } from "@/components/ui/primitives";
import { fmtDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { isConflict } from "@/lib/payroll/api";
import { P } from "@/lib/permissions.generated";

import { compensationApi } from "./api";
import { draftFrom, emptyDraft, formulaOf, payloadOf, saveErrorsOf, validateDraft, type ComponentDraft, type SaveErrors } from "./componentForm";
import { FormulaEditor } from "./FormulaEditor";
import { FormulaTester } from "./FormulaTester";
import { KIND_LABEL, METHOD_LABEL, TAG_HINTS, humanize, kindLabel, methodLabel } from "./format";
import { BackLink, ConflictBanner, ErrorSummary, LoadError, PageSkeleton, ToneChip } from "./shared";
import {
  CALC_METHODS,
  CATEGORIES_BY_KIND,
  COMPONENT_KINDS,
  FREQUENCIES,
  PRORATION_BASES,
  PRORATIONS,
  ROUNDING_MODES,
  VISIBILITIES,
  type ComponentKind,
  type ComponentVersion,
  type FormulaCheck,
  type PayComponent,
} from "./types";

const SECTIONS = [
  ["basics", "Basics"],
  ["calculation", "Calculation"],
  ["proration", "Proration & frequency"],
  ["tags", "Tags"],
  ["tax", "Tax & statutory"],
  ["payslip", "Payslip display"],
  ["accounting", "Accounting"],
  ["versions", "Versions"],
] as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function Section({ id, title, description, children }: { id: string; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Card id={`section-${id}`} className="scroll-mt-24">
      <CardHeader title={title} description={description} />
      <div className="space-y-4 p-5">{children}</div>
    </Card>
  );
}

/** Codes picker as toggle chips (components the percentage or the balancing line uses). */
function CodeChips({ label, value, onChange, options, disabled, error }: { label: string; value: string[]; onChange: (v: string[]) => void; options: { code: string; name: string }[]; disabled?: boolean; error?: string }) {
  return (
    <fieldset className="space-y-1.5" disabled={disabled}>
      <legend className="text-[13px] font-medium text-foreground/90">{label}</legend>
      <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
        {options.map((o) => {
          const on = value.includes(o.code);
          return (
            <button
              key={o.code}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((c) => c !== o.code) : [...value, o.code])}
              className={`min-h-[44px] rounded-xl border px-3 font-mono text-xs sm:min-h-[34px] ${on ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
              title={o.name}
            >
              {o.code}
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}

function versionChanges(prev: ComponentVersion | undefined, next: ComponentVersion): DiffRow[] {
  if (!prev) return [];
  const fields: [string, (v: ComponentVersion) => string][] = [
    ["Name", (v) => v.name],
    ["Method", (v) => methodLabel(v.calc_method)],
    ["Formula", (v) => v.formula ?? "—"],
    ["Parameters", (v) => JSON.stringify(v.params ?? {})],
    ["Tags", (v) => (v.tags ?? []).join(", ") || "—"],
    ["Proration", (v) => humanize(v.proration)],
    ["Proration basis", (v) => (v.proration_basis ? humanize(v.proration_basis) : "Payroll setting")],
    ["Frequency", (v) => humanize(v.frequency?.type)],
    ["Visibility", (v) => humanize(v.visibility)],
  ];
  return fields
    .map(([label, get]) => ({ key: label, label, before: get(prev), after: get(next) }))
    .filter((r) => r.before !== r.after);
}

/**
 * Full-page component editor (3.8 §5.9). Editing an existing component creates a new version from
 * an effective date ("Edit" never rewrites history); pack-owned components are read-only (EC-CMP-18).
 */
export function ComponentEditor({ code }: { code: string | null }) {
  const isNew = code === null;
  const router = useRouter();
  const confirm = useConfirm();
  const { can } = useCan();
  const canEdit = can(P.PAYROLL_SALARY_STRUCTURE_EDIT);
  const detail = useApi(() => (code ? compensationApi.getComponent(code) : Promise.resolve(null)), [code]);
  const catalogue = useApi(() => compensationApi.listComponents(), []);
  const component = detail.data ?? null;
  const [draft, setDraft] = useState<ComponentDraft | null>(isNew ? emptyDraft() : null);
  const [check, setCheck] = useState<FormulaCheck | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [server, setServer] = useState<SaveErrors | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [seeded, setSeeded] = useState<PayComponent | null>(null);
  // Seed the form whenever a (re)loaded component arrives.
  if (!isNew && component && component !== seeded) {
    setSeeded(component);
    setDraft(draftFrom(component));
  }

  const readOnly = !canEdit || !!component?.read_only || component?.status === "ARCHIVED";
  const options = useMemo(() => (catalogue.data ?? []).map((c) => ({ code: c.code, name: c.name })), [catalogue.data]);
  const others = options.filter((o) => o.code !== draft?.code);

  if (!isNew && detail.error) return <LoadError error={detail.error} onRetry={detail.reload} what="Component" backHref="/payroll/components" backLabel="Back to components" />;
  if (!draft) return <PageSkeleton />;
  const set = <K extends keyof ComponentDraft>(key: K, value: ComponentDraft[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));
  const err = (k: string) => errors[k] ?? server?.fields[k];

  const reload = async () => {
    setConflict(null);
    await detail.reload();
  };

  const save = async () => {
    const found = validateDraft(draft, isNew);
    setErrors(found);
    setServer(null);
    if (Object.keys(found).length || (check && !check.valid && draft.calc_method === "FORMULA")) return;
    setSaving(true);
    try {
      const body = payloadOf(draft, isNew);
      const saved: PayComponent = isNew ? await compensationApi.createComponent(body) : await compensationApi.createComponentVersion(draft.code, body);
      toast.success(isNew ? `Component ${saved.code} created.` : `New version saved for ${saved.code}.`);
      for (const w of saved.warnings ?? []) toast(w.message, { icon: "⚠️" });
      if (isNew) router.replace(`/payroll/components/${encodeURIComponent(saved.code)}`);
      else detail.setData(saved);
    } catch (e) {
      if (isConflict(e)) setConflict(e instanceof Error ? e.message : null);
      else setServer(saveErrorsOf(e));
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (status: "ACTIVE" | "ARCHIVED") => {
    if (!component) return;
    if (status === "ARCHIVED" && !(await confirm({ title: `Archive ${component.code}?`, message: "Archived components can't be added to structures or changed. Existing structures and salaries keep using their version.", confirmLabel: "Archive", tone: "danger" }))) return;
    try {
      const saved = await compensationApi.patchComponent(component.code, { status });
      detail.setData(saved);
      toast.success(status === "ARCHIVED" ? "Component archived." : "Component restored.");
    } catch (e) {
      if (isConflict(e)) setConflict(e instanceof Error ? e.message : null);
      else toast.error(e instanceof Error ? e.message : "Could not change the status.");
    }
  };

  const summary = [...Object.values(errors), ...(server?.message ? [server.message] : [])];
  const versions = component?.versions ?? [];
  const timeline: TimelineItem[] = [...versions].reverse().map((v) => {
    const prev = versions.find((p) => p.version === v.version - 1);
    const rows = versionChanges(prev, v);
    return {
      id: v.id,
      at: v.created_at,
      tone: v.status === "ACTIVE" ? "success" : "neutral",
      title: (
        <span className="inline-flex flex-wrap items-center gap-2">
          Version {v.version}
          <ToneChip label={v.status === "ACTIVE" ? "Active" : "Superseded"} tone={v.status === "ACTIVE" ? "success" : "neutral"} />
        </span>
      ),
      actor: `Effective ${fmtDate(v.effective_from)}${v.effective_to ? ` – ${fmtDate(v.effective_to)}` : " onwards"}`,
      body: rows.length ? <DiffView rows={rows} caption={`Changes in version ${v.version}`} /> : prev ? "No visible changes." : "First version.",
    };
  });

  const methods = isNew ? CALC_METHODS.filter((m) => m !== "SYSTEM") : CALC_METHODS;
  const title = isNew ? "New component" : component ? `${component.name}` : "Component";

  return (
    <div>
      <BackLink href="/payroll/components">Components</BackLink>
      <PageHeader
        eyebrow={isNew ? "Components" : <bdi dir="ltr">{component?.code}</bdi>}
        title={title}
        description={isNew ? "Define how an earning, deduction or contribution is calculated. Structures use it once it is saved." : "Changes are saved as a new version from the effective date; earlier pay runs keep the version they used."}
        actions={
          !isNew && component && canEdit && !component.read_only ? (
            component.status === "ARCHIVED" ? (
              <Button variant="secondary" onClick={() => setStatus("ACTIVE")} className="min-h-[44px]">
                <ArchiveRestore className="h-4 w-4" aria-hidden /> Restore
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => setStatus("ARCHIVED")} className="min-h-[44px]">
                <Archive className="h-4 w-4" aria-hidden /> Archive
              </Button>
            )
          ) : null
        }
      />
      {component?.read_only && (
        <p className="mb-4 flex items-center gap-2 rounded-2xl border border-border bg-surface-muted px-4 py-3 text-sm">
          <Lock className="h-4 w-4" aria-hidden /> This component belongs to the {component.owner} country pack and can't be edited here.
        </p>
      )}
      {!canEdit && !isNew && <p className="mb-4 text-sm text-muted-foreground">You can view this component. Editing needs salary structure edit access.</p>}
      {conflict && <ConflictBanner message={conflict} onReload={reload} className="mb-4" />}
      <ErrorSummary errors={summary} className="mb-4" />

      <div className="grid gap-6 xl:grid-cols-[180px_minmax(0,1fr)_380px]">
        <nav aria-label="Sections" className="hidden xl:block">
          <ul className="sticky top-24 space-y-1 text-sm">
            {SECTIONS.filter(([id]) => !(isNew && id === "versions")).map(([id, label]) => (
              <li key={id}>
                <a href={`#section-${id}`} className="block rounded-lg px-3 py-2 text-muted-foreground hover:bg-surface-muted hover:text-foreground">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <form
          className="min-w-0 space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          aria-label="Component"
        >
          <fieldset disabled={readOnly} className="space-y-6">
            <Section id="basics" title="Basics">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Code" required error={err("code")} hint={!isNew && component?.in_use ? "In use by a structure or salary: the code can't change." : "UPPER_SNAKE, unique in your company."}>
                  <Input dir="ltr" value={draft.code} disabled={!isNew} onChange={(e) => set("code", e.target.value.toUpperCase())} />
                </Field>
                <Field label="Name" required error={err("name")}>
                  <Input value={draft.name} onChange={(e) => set("name", e.target.value)} />
                </Field>
                <Field label="Kind" required>
                  <Select
                    value={draft.kind}
                    disabled={!isNew}
                    onChange={(e) => {
                      const kind = e.target.value as ComponentKind;
                      setDraft((d) => (d ? { ...d, kind, category: CATEGORIES_BY_KIND[kind][0] } : d));
                    }}
                  >
                    {COMPONENT_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Category" required>
                  <Select value={draft.category} disabled={!isNew} onChange={(e) => set("category", e.target.value)}>
                    {(CATEGORIES_BY_KIND[draft.kind as ComponentKind] ?? [draft.category]).map((c) => (
                      <option key={c} value={c}>
                        {humanize(c)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Description">
                <Textarea rows={2} value={draft.description} onChange={(e) => set("description", e.target.value)} />
              </Field>
            </Section>

            <Section id="calculation" title="Calculation" description="How the monthly amount is worked out. The engine orders components by what they depend on.">
              <Field label="Method">
                <Select value={draft.calc_method} onChange={(e) => set("calc_method", e.target.value)} disabled={draft.calc_method === "SYSTEM"}>
                  {methods.map((m) => (
                    <option key={m} value={m}>
                      {METHOD_LABEL[m]}
                    </option>
                  ))}
                </Select>
              </Field>
              {draft.calc_method === "FIXED" && (
                <Field label="The amount entered on the salary is" hint="The amount itself comes from the salary assignment or structure line.">
                  <Select value={draft.basis} onChange={(e) => set("basis", e.target.value as "MONTHLY" | "ANNUAL")}>
                    <option value="MONTHLY">Monthly</option>
                    <option value="ANNUAL">Annual</option>
                  </Select>
                </Field>
              )}
              {draft.calc_method === "FORMULA" && (
                <FormulaEditor
                  label="Formula"
                  value={draft.formula}
                  onChange={(v) => set("formula", v)}
                  components={options}
                  componentCode={draft.code || undefined}
                  kind={draft.kind}
                  disabled={readOnly}
                  onCheck={setCheck}
                  externalErrors={server?.formula}
                  hint='Example: ctc.monthly * 0.5, or MIN(BASIC * 0.4, 25000). Strings use double quotes: SUM_TAG("PART_OF_CTC").'
                />
              )}
              {draft.calc_method === "PERCENT_OF" && (
                <>
                  <Field label="Percentage" required error={err("percent")} hint="Of the sum of the chosen components (or the tag).">
                    <Input dir="ltr" inputMode="decimal" value={draft.percent} onChange={(e) => set("percent", e.target.value)} />
                  </Field>
                  <CodeChips label="Of components" value={draft.bases} onChange={(v) => set("bases", v)} options={others} error={err("bases")} />
                  <Field label="Or of a tag" hint="All components carrying this tag.">
                    <Input dir="ltr" value={draft.tag} onChange={(e) => set("tag", e.target.value.toUpperCase())} />
                  </Field>
                </>
              )}
              {draft.calc_method === "RATE_X_UNITS" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Rate (formula)" error={err("rate")}>
                    <Input dir="ltr" value={draft.rate} onChange={(e) => set("rate", e.target.value)} placeholder="ot.hourly_rate * 1.5" />
                  </Field>
                  <Field label="Units (formula)">
                    <Input dir="ltr" value={draft.units} onChange={(e) => set("units", e.target.value)} placeholder="ot.hours_workday" />
                  </Field>
                </div>
              )}
              {draft.calc_method === "SLAB" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Table code" error={err("table")} hint="A payroll table of type SLAB (Settings › Payroll › Tables).">
                    <Input dir="ltr" value={draft.table} onChange={(e) => set("table", e.target.value.toUpperCase())} />
                  </Field>
                  <Field label="Base (formula)">
                    <Input dir="ltr" value={draft.slab_base} onChange={(e) => set("slab_base", e.target.value)} />
                  </Field>
                  <div className="flex items-center gap-3">
                    <Switch checked={draft.progressive} onChange={(v) => set("progressive", v)} label="Progressive" />
                    <span className="text-sm">Progressive (each band taxes only its slice)</span>
                  </div>
                </div>
              )}
              {draft.calc_method === "INPUT" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Wage input code" hint="Defaults to this component's code.">
                    <Input dir="ltr" value={draft.input_code} onChange={(e) => set("input_code", e.target.value.toUpperCase())} />
                  </Field>
                  <div className="flex items-center gap-3">
                    <Switch checked={draft.allow_negative_input} onChange={(v) => set("allow_negative_input", v)} label="Allow negative inputs" />
                    <span className="text-sm">Allow negative inputs (corrections)</span>
                  </div>
                </div>
              )}
              {draft.calc_method === "BALANCING" && (
                <>
                  <p className="text-sm text-muted-foreground">Pays what is left of the pay basis after the other components. If it would be negative, the salary is rejected with the minimum pay basis.</p>
                  <CodeChips label="Other components (empty = every PART_OF_CTC line of the structure)" value={draft.others} onChange={(v) => set("others", v)} options={others} />
                  <Field label="Total (formula)" hint="Defaults to ctc.monthly.">
                    <Input dir="ltr" value={draft.total} onChange={(e) => set("total", e.target.value)} placeholder="ctc.monthly" />
                  </Field>
                </>
              )}
              {draft.calc_method === "SYSTEM" && <p className="text-sm text-muted-foreground">Calculated by the country pack. It can't be changed here.</p>}
              <Field label="Eligibility (optional condition)" hint="A TRUE/FALSE formula; the component is skipped when it is FALSE, e.g. emp.years_of_service >= 1.">
                <Input dir="ltr" value={draft.eligibility} onChange={(e) => set("eligibility", e.target.value)} />
              </Field>
            </Section>

            <Section id="proration" title="Proration & frequency">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Proration" hint="How joiners, leavers and unpaid days reduce the amount.">
                  <Select value={draft.proration} onChange={(e) => set("proration", e.target.value)}>
                    {PRORATIONS.map((p) => (
                      <option key={p} value={p}>
                        {humanize(p)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Proration basis" hint="Leave on the payroll setting unless this component needs its own (EC-CMP: override).">
                  <Select value={draft.proration_basis} onChange={(e) => set("proration_basis", e.target.value)}>
                    <option value="">Use the payroll setting</option>
                    {PRORATION_BASES.map((p) => (
                      <option key={p} value={p}>
                        {humanize(p)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Frequency">
                  <Select value={draft.frequency} onChange={(e) => set("frequency", e.target.value)}>
                    {FREQUENCIES.map((p) => (
                      <option key={p} value={p}>
                        {humanize(p)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Rounding" hint="Empty: the currency's rounding.">
                  <Select value={draft.rounding} onChange={(e) => set("rounding", e.target.value)}>
                    <option value="">Currency default</option>
                    {ROUNDING_MODES.map((p) => (
                      <option key={p} value={p}>
                        {humanize(p)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {draft.frequency === "SPECIFIC_MONTHS" && (
                <fieldset>
                  <legend className="text-[13px] font-medium">Paid in</legend>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {MONTHS.map((m, i) => {
                      const on = draft.months.includes(i + 1);
                      return (
                        <button key={m} type="button" aria-pressed={on} onClick={() => set("months", on ? draft.months.filter((x) => x !== i + 1) : [...draft.months, i + 1].sort((a, b) => a - b))} className={`min-h-[44px] min-w-[52px] rounded-xl border px-2 text-sm sm:min-h-[36px] ${on ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground"}`}>
                          {m}
                        </button>
                      );
                    })}
                  </div>
                  {err("months") && <p role="alert" className="mt-1 text-xs font-medium text-danger">{err("months")}</p>}
                </fieldset>
              )}
            </Section>

            <Section id="tags" title="Tags" description="Tags group components for formulas (SUM_TAG) and for country-pack wage bases.">
              <TagEditor tags={draft.tags} onChange={(t) => set("tags", t)} error={err("tags")} />
            </Section>
          </fieldset>

          <Section id="tax" title="Tax & statutory" description="Read-only: set by the country pack and the totals rules.">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Owner</dt>
                <dd>{component?.owner === "COMPANY" || isNew ? "Your company" : `${component?.owner} pack`}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Calculation stage</dt>
                <dd>{component?.stage ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Taxability</dt>
                <dd>
                  {component?.current_version?.taxability && Object.keys(component.current_version.taxability).length
                    ? Object.entries(component.current_version.taxability).map(([k, v]) => `${k}: ${humanize(v)}`).join(" · ")
                    : "Decided by the country pack"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Counted in</dt>
                <dd>
                  {component?.current_version?.totals_flags
                    ? Object.entries(component.current_version.totals_flags).filter(([, on]) => on).map(([k]) => humanize(k.replace(/^in_/, ""))).join(", ") || "No totals"
                    : `Defaults for ${kindLabel(draft.kind).toLowerCase()}s`}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Reporting codes</dt>
                <dd>{Object.entries(component?.current_version?.reporting_codes ?? {}).map(([k, v]) => `${k}: ${v}`).join(" · ") || "None"}</dd>
              </div>
            </dl>
          </Section>

          <fieldset disabled={readOnly} className="space-y-6">
            <Section id="payslip" title="Payslip display">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Visible to">
                  <Select value={draft.visibility} onChange={(e) => set("visibility", e.target.value)}>
                    {VISIBILITIES.map((v) => (
                      <option key={v} value={v}>
                        {v === "HR_ONLY" ? "HR only (hidden from the employee)" : "Employee and HR"}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Payslip label" hint="Empty: the component name.">
                  <Input value={draft.label_override} onChange={(e) => set("label_override", e.target.value)} />
                </Field>
                <Field label="Group">
                  <Input value={draft.payslip_group} onChange={(e) => set("payslip_group", e.target.value)} />
                </Field>
                <Field label="Order" error={err("payslip_order")}>
                  <Input dir="ltr" inputMode="numeric" value={draft.payslip_order} onChange={(e) => set("payslip_order", e.target.value)} />
                </Field>
              </div>
              <div className="flex flex-wrap gap-6 text-sm">
                <label className="inline-flex min-h-[44px] items-center gap-3">
                  <Switch checked={draft.show_if_zero} onChange={(v) => set("show_if_zero", v)} label="Show when zero" /> Show when zero
                </label>
                <label className="inline-flex min-h-[44px] items-center gap-3">
                  <Switch checked={draft.show_rate_column} onChange={(v) => set("show_rate_column", v)} label="Show the full rate column" /> Show the full rate column
                </label>
              </div>
            </Section>

            <Section id="accounting" title="Accounting">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Debit account">
                  <Input dir="ltr" value={draft.debit_account} onChange={(e) => set("debit_account", e.target.value)} />
                </Field>
                <Field label="Credit account">
                  <Input dir="ltr" value={draft.credit_account} onChange={(e) => set("credit_account", e.target.value)} />
                </Field>
              </div>
              <label className="inline-flex min-h-[44px] items-center gap-3 text-sm">
                <Switch checked={draft.allocate_by_cost_center} onChange={(v) => set("allocate_by_cost_center", v)} label="Allocate by cost center" /> Allocate by cost center
              </label>
            </Section>

            {!readOnly && (
              <Card className="sticky bottom-3 z-10 flex flex-col gap-3 p-4 shadow-lift sm:flex-row sm:items-end">
                <Field label={isNew ? "Effective from" : "New version effective from"} hint={isNew ? "Empty: today." : "Empty: today. Earlier pay runs keep their version."} className="sm:w-56">
                  <Input type="date" value={draft.effective_from} onChange={(e) => set("effective_from", e.target.value)} />
                </Field>
                {!isNew && (
                  <Field label="Reason" error={err("reason")} className="flex-1">
                    <Input value={draft.reason} onChange={(e) => set("reason", e.target.value)} placeholder="Why it changes (needed for a past date)" />
                  </Field>
                )}
                <Button type="submit" loading={saving} className="min-h-[44px] sm:ms-auto">
                  <Save className="h-4 w-4" aria-hidden /> {isNew ? "Create component" : "Save new version"}
                </Button>
              </Card>
            )}
          </fieldset>

          {!isNew && (
            <Section id="versions" title="Versions" description='"Save new version" adds a version; nothing is overwritten.'>
              <Timeline items={timeline} label="Component versions" />
            </Section>
          )}
        </form>

        <aside className="min-w-0 xl:sticky xl:top-24 xl:self-start">
          {draft.calc_method === "FORMULA" ? (
            <FormulaTester code={isNew ? null : draft.code} formula={formulaOf(draft) || null} check={check} />
          ) : (
            <FormulaTester code={isNew ? null : draft.code} formula={null} check={null} />
          )}
        </aside>
      </div>
    </div>
  );
}

function TagEditor({ tags, onChange, error }: { tags: string[]; onChange: (t: string[]) => void; error?: string }) {
  const [text, setText] = useState("");
  const add = () => {
    const t = text.trim().toUpperCase();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setText("");
  };
  const suggested = Object.keys(TAG_HINTS).filter((t) => !tags.includes(t));
  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-2" aria-label="Tags">
        {tags.map((t) => (
          <li key={t} className="inline-flex items-center gap-1 rounded-xl border border-border bg-surface-muted ps-3 text-sm">
            <Tag className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <bdi dir="ltr" className="font-mono text-xs">
              {t}
            </bdi>
            {TAG_HINTS[t] && <span className="hidden text-xs text-muted-foreground sm:inline">· {TAG_HINTS[t]}</span>}
            <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))} className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-muted sm:h-8 sm:w-8">
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </li>
        ))}
        {!tags.length && <li className="text-sm text-muted-foreground">No tags.</li>}
      </ul>
      <div className="flex gap-2">
        <Input
          dir="ltr"
          aria-label="New tag"
          value={text}
          onChange={(e) => setText(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="PART_OF_CTC"
        />
        <Button variant="secondary" onClick={add} className="min-h-[44px]">
          Add
        </Button>
      </div>
      {error && <p role="alert" className="text-xs font-medium text-danger">{error}</p>}
      {suggested.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground">Common tags</p>
          <ul className="mt-1 space-y-1">
            {suggested.map((t) => (
              <li key={t} className="flex flex-wrap items-center gap-2 text-xs">
                <button type="button" onClick={() => onChange([...tags, t])} className="min-h-[44px] rounded-lg border border-dashed border-border px-2 font-mono sm:min-h-[30px]">
                  + {t}
                </button>
                <span className="text-muted-foreground">{TAG_HINTS[t]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
