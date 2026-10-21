"use client";

import { SlidersHorizontal } from "lucide-react";

import { ChecklistEmptyState, type ChecklistStep } from "@/components/payroll/ChecklistEmptyState";
import { ErrorState } from "@/components/ui/layout";
import { Card, Skeleton } from "@/components/ui/primitives";
import { useApi } from "@/lib/hooks";

import { checklistItems, definitionOf, formatValue, type ChecklistItem } from "./model";
import { settingsApi } from "./settingsApi";

export function checklistSteps(items: ChecklistItem[]): ChecklistStep[] {
  return items.map((item) => ({
    id: item.key,
    label: item.state === "decided" ? `${item.label}: ${formatValue(definitionOf(item.key), item.value)}` : item.label,
    description: (
      <>
        {item.question}
        <span className="mt-0.5 block text-xs">Settings › Payroll › {item.sectionTitle}</span>
      </>
    ),
    href: `/settings/payroll/${item.sectionSlug}#setting-${item.key.replace(/[^a-z0-9]+/gi, "-")}`,
    done: item.state === "decided",
  }));
}

/**
 * The payroll setup checklist (3.8 §5.1, ChecklistEmptyState): the STARTER_V1 settings that need a
 * company decision, read from the company-level values. An item counts as decided once an
 * administrator saved it; the starter value alone is not a decision. No amounts, no invented numbers.
 */
export function SetupChecklist() {
  const { data, error, reload } = useApi(() => settingsApi.values({ scope_type: "TENANT", scope_id: null }), []);
  return (
    <Card aria-live="polite">
      {error ? (
        <ErrorState message={error.message} onRetry={reload} />
      ) : !data ? (
        <div className="space-y-2 p-5" aria-busy>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      ) : (
        <ChecklistEmptyState
          className="max-w-none px-4 py-6 sm:px-6"
          icon={<SlidersHorizontal />}
          title="Decisions for your payroll setup"
          description="New workspaces start with safe defaults. These features need your company's decision before they pay anyone; each one opens the right settings page."
          steps={checklistSteps(checklistItems(data))}
        />
      )}
    </Card>
  );
}
