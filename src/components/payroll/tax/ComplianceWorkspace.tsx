"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useCan } from "@/components/access/Can";
import { CompliancePage } from "@/components/payroll/documents/Compliance";
import { WorkspaceHeader } from "@/components/payroll/documents/shared";
import { Tabs } from "@/components/ui/layout";
import { canBeyondSelf } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

import { TaxReviewTab } from "./TaxReviewTab";

/** The compliance page reads with statutory review, statutory submit or report access (compliance.READ_PERMISSIONS). */
export const STATUTORY_CODES = [P.PAYROLL_STATUTORY_REVIEW, P.PAYROLL_STATUTORY_SUBMIT, P.PAYROLL_REPORTS_READ];

/**
 * Payroll › Compliance with its tabs: "Statutory" (the existing page: capability, filings, liabilities) and "Tax
 * declarations" (HR review of employees' tax declarations, payroll:tax_profile:review). A person sees the tabs they
 * may use; with only one, no tab bar is shown. The tab lives in the URL (`?tab=tax`), so a notification can link to it.
 */
export function ComplianceWorkspace() {
  const { me } = useCan();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const statutory = STATUTORY_CODES.some((code) => canBeyondSelf(me, code));
  const tax = canBeyondSelf(me, P.PAYROLL_TAX_PROFILE_REVIEW);
  const wanted = search?.get("tab") === "tax" ? "tax" : "statutory";
  const active = wanted === "tax" ? (tax ? "tax" : "statutory") : statutory ? "statutory" : "tax";

  if (statutory && !tax) return <CompliancePage />;
  if (!statutory && tax) {
    return (
      <div className="space-y-5">
        <WorkspaceHeader title="Tax declarations" description="Review the tax declarations and proofs employees send for their country's payroll rules." showHideAmounts={false} />
        <TaxReviewTab />
      </div>
    );
  }

  const choose = (value: string) => {
    const next = new URLSearchParams(search?.toString() ?? "");
    next.delete("modal");
    if (value === "tax") next.set("tab", "tax");
    else next.delete("tab");
    const query = next.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`);
  };

  return (
    <div className="space-y-2">
      <Tabs
        tabs={[
          { value: "statutory", label: "Statutory" },
          { value: "tax", label: "Tax declarations" },
        ]}
        value={active}
        onValueChange={choose}
      >
        <span />
      </Tabs>
      {active === "tax" ? (
        <div className="space-y-5">
          <WorkspaceHeader title="Tax declarations" description="Review the tax declarations and proofs employees send for their country's payroll rules." showHideAmounts={false} />
          <TaxReviewTab />
        </div>
      ) : (
        <CompliancePage />
      )}
    </div>
  );
}
