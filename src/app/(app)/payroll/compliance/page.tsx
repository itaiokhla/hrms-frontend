"use client";

import { RequireAccess } from "@/components/access/Can";
import { DocsPage } from "@/components/payroll/documents/shared";
import { ComplianceWorkspace, STATUTORY_CODES } from "@/components/payroll/tax/ComplianceWorkspace";
import { canBeyondSelf } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** Statutory review, statutory submit or report access opens the statutory tab; tax review opens the declarations tab. */
const COMPLIANCE_CODES = [...STATUTORY_CODES, P.PAYROLL_TAX_PROFILE_REVIEW];

/** Payroll › Compliance (3.8 §5.15) with the tax declarations review tab. */
export default function ComplianceRoute() {
  return (
    <RequireAccess check={(me) => COMPLIANCE_CODES.some((code) => canBeyondSelf(me, code))}>
      <DocsPage>
        <ComplianceWorkspace />
      </DocsPage>
    </RequireAccess>
  );
}
