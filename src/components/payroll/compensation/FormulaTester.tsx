"use client";

import { FlaskConical, Play } from "lucide-react";
import { useEffect, useState } from "react";

import { ExplainPanel } from "@/components/payroll/ExplainPanel";
import { MoneyText } from "@/components/payroll/MoneyText";
import { EmployeePicker, type PickedEmployee } from "@/components/shared/EmployeePicker";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Card, CardHeader } from "@/components/ui/primitives";
import { Segmented } from "@/components/branding/fields";
import { errorMessage } from "@/lib/api";
import { isDecimalString } from "@/lib/money";

import { compensationApi } from "./api";
import type { FormulaCheck, TesterResult } from "./types";

type Mode = "sample" | "employee";

/**
 * Formula tester (3.8 §5.9): runs POST /payroll/components/{code}/test with sample values, or for an
 * employee in the viewer's compensation scope and a period, and shows the value, every reference and
 * the step-by-step trace. Nothing is saved.
 */
export function FormulaTester({ code, formula, currency, check }: { code: string | null; formula: string | null; currency?: string; check: FormulaCheck | null }) {
  const [mode, setMode] = useState<Mode>("sample");
  const [values, setValues] = useState<Record<string, string>>({});
  const [employee, setEmployee] = useState<PickedEmployee | null>(null);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [result, setResult] = useState<TesterResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Offer an input for every component and variable the formula references.
  const names = [...(check?.components ?? []), ...(check?.variables ?? [])];
  useEffect(() => {
    setValues((current) => Object.fromEntries(names.map((n) => [n, current[n] ?? ""])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names.join("|")]);

  const invalid = Object.entries(values).filter(([, v]) => v.trim() && !isDecimalString(v.trim()) && !/^\d{4}-\d{2}-\d{2}$/.test(v.trim()) && !/^(true|false)$/i.test(v.trim()));

  const run = async () => {
    if (!code) return;
    setBusy(true);
    setError(null);
    try {
      const components: Record<string, string> = {};
      const variables: Record<string, string | boolean> = {};
      for (const [name, raw] of Object.entries(values)) {
        const text = raw.trim();
        if (!text) continue;
        if (check?.components.includes(name)) components[name] = text;
        else variables[name] = /^(true|false)$/i.test(text) ? text.toLowerCase() === "true" : text;
      }
      const body =
        mode === "employee"
          ? { formula: formula || undefined, currency, employee_id: employee?.id, period_start: periodStart || undefined, period_end: periodEnd || undefined, sample: { components, variables } }
          : { formula: formula || undefined, currency, sample: { components, variables } };
      setResult(await compensationApi.testComponent(code, body));
    } catch (e) {
      setResult(null);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const blocked = !code ? "Save the component first; the tester runs saved components." : !formula && !check ? "Add a formula to test." : null;
  const value = result?.value;

  return (
    <Card>
      <CardHeader title={<span className="inline-flex items-center gap-2"><FlaskConical className="h-4 w-4 text-primary" aria-hidden /> Tester</span>} description="Run this formula without saving anything." />
      <div className="space-y-4 p-5">
        <Segmented<Mode>
          label="Values from"
          value={mode}
          onChange={setMode}
          options={[
            { value: "sample", label: "Sample values" },
            { value: "employee", label: "An employee" },
          ]}
        />
        {mode === "employee" && (
          <div className="space-y-3">
            <Field label="Employee" hint="Only people inside your compensation scope can be chosen.">
              <EmployeePicker value={employee} onChange={setEmployee} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Period start">
                <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
              </Field>
              <Field label="Period end">
                <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
              </Field>
            </div>
          </div>
        )}
        {names.length > 0 && (
          <div className="space-y-2">
            <p className="text-[13px] font-medium">{mode === "employee" ? "Override values (optional)" : "Values"}</p>
            {names.map((name) => (
              <Field key={name} label={name} error={invalid.some(([n]) => n === name) ? "A number, a date (YYYY-MM-DD) or true/false." : undefined}>
                <Input dir="ltr" inputMode="decimal" value={values[name] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))} placeholder={check?.components.includes(name) ? "Amount, e.g. 50000.00" : "Value"} />
              </Field>
            ))}
          </div>
        )}
        {blocked ? (
          <p className="text-sm text-muted-foreground">{blocked}</p>
        ) : (
          <Button onClick={run} loading={busy} disabled={!!invalid.length || (mode === "employee" && !employee)} className="min-h-[44px] w-full sm:w-auto">
            <Play className="h-4 w-4" aria-hidden /> Run test
          </Button>
        )}
        {error && (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        )}
        {result && (
          <div className="space-y-3" aria-live="polite">
            <div className="rounded-2xl border border-border bg-surface-muted/50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Result</p>
              {result.ok ? (
                <p className="mt-1 text-xl font-semibold">
                  {value && typeof value === "object" ? <MoneyText money={value} emphasis /> : <bdi dir="ltr">{String(value)}</bdi>}
                </p>
              ) : (
                <p role="alert" className="mt-1 text-sm font-medium text-danger">
                  {result.error?.message ?? result.errors?.[0]?.message ?? "The formula could not be evaluated."}
                </p>
              )}
              {result.source.type === "EMPLOYEE" && result.source.assumptions?.map((a) => (
                <p key={a} className="mt-1 text-xs text-muted-foreground">
                  {a}
                </p>
              ))}
            </div>
            <ExplainPanel
              explanation={result.ok ? "Each step below is how the value was worked out." : "The formula stopped at the error above."}
              formula={result.formula}
              inputs={Object.entries(result.references).map(([name, v]) => ({ label: <bdi dir="ltr">{name}</bdi>, value: <bdi dir="ltr">{v}</bdi> }))}
              defaultExpanded
            />
            {result.steps.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Trace</p>
                <ol className="mt-1 space-y-1 font-mono text-[12px]" dir="ltr">
                  {result.steps.map((s, i) => (
                    <li key={i} className="rounded-lg bg-surface-muted px-2 py-1">
                      {s}
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {result.warnings.map((w, i) => (
              <p key={i} className="text-xs text-warning">
                {w.message}
              </p>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
