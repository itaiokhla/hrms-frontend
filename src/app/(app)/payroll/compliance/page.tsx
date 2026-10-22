"use client";

import { RequireAccess } from "@/components/access/Can";
import { CompliancePage } from "@/components/payroll/documents/Compliance";
import { DocsPage } from "@/components/payroll/documents/shared";
import { canBeyondSelf } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** The compliance page reads with statutory review, statutory submit or report access (compliance.READ_PERMISSIONS). */
const COMPLIANCE_CODES = [P.PAYROLL_STATUTORY_REVIEW, P.PAYROLL_STATUTORY_SUBMIT, P.PAYROLL_REPORTS_READ];

/** Payroll › Compliance (3.8 §5.15). */
export default function ComplianceRoute() {
  return (
    <RequireAccess check={(me) => COMPLIANCE_CODES.some((code) => canBeyondSelf(me, code))}>
      <DocsPage>
        <CompliancePage />
      </DocsPage>
    </RequireAccess>
  );
}
