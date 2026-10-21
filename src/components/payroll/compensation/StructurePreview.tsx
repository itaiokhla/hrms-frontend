"use client";

import { useEffect, useState } from "react";

import { Segmented } from "@/components/branding/fields";
import { Field, Input } from "@/components/ui/field";
import { Card, CardHeader, Skeleton } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/api";

import { compensationApi } from "./api";
import { BreakdownTable, type Period } from "./BreakdownTable";
import { moneyFromInput, payBasisLabel } from "./format";
import type { Breakdown } from "./types";

/**
 * Live preview of a structure version for a sample pay basis (3.8 §5.8): the real engine on a
 * one-period snapshot via POST /salary-structures/{id}/preview; statutory lines are estimates
 * labelled "Compliance not verified" (and "FIXTURE — not law" when the pack is a fixture).
 */
export function StructurePreview({ structureId, version, currency, type, names, stale }: { structureId: number; version: number | null; currency: string; type: string; names: Record<string, string>; stale?: boolean }) {
  const [amount, setAmount] = useState(type === "CTC_BASED" ? "1200000" : "50000");
  const [period, setPeriod] = useState<Period>(type === "CTC_BASED" ? "annual" : "monthly");
  const [result, setResult] = useState<Breakdown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const parsed = moneyFromInput(amount, currency);

  useEffect(() => {
    if (!parsed.money || version === null) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      compensationApi
        .previewStructure(structureId, { pay_basis_amount: parsed.money!, version }, controller.signal)
        .then((r) => {
          setResult(r);
          setError(null);
        })
        .catch((e) => !controller.signal.aborted && setError(errorMessage(e)))
        .finally(() => !controller.signal.aborted && setLoading(false));
    }, 400);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureId, version, parsed.money?.amount, currency]);

  return (
    <Card>
      <CardHeader title="Preview" description="The payroll engine on one full month, without loss of pay." />
      <div className="space-y-4 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label={`${payBasisLabel(type)} (${currency})`} error={amount.trim() ? parsed.error ?? undefined : "Enter an amount."} className="flex-1">
            <Input dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Segmented<Period>
            label="Show"
            value={period}
            onChange={setPeriod}
            options={[
              { value: "monthly", label: "Monthly" },
              { value: "annual", label: "Annual" },
            ]}
          />
        </div>
        {stale && <p className="rounded-xl bg-info-soft px-3 py-2 text-xs text-info">The preview shows the saved draft. Save your changes to preview them.</p>}
        {version === null ? (
          <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>
        ) : error ? (
          <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : loading && !result ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : result ? (
          <div aria-busy={loading || undefined}>
            <BreakdownTable breakdown={result} period={period} names={names} caption="Structure preview" />
          </div>
        ) : null}
      </div>
    </Card>
  );
}
