"use client";

import { RequireAccess } from "@/components/access/Can";
import { DocsPage } from "@/components/payroll/documents/shared";
import { LegalHoldsPage } from "@/components/payroll/holds/LegalHolds";
import { HOLD_READ_CODES } from "@/components/payroll/holds/Nav";
import { canBeyondSelf } from "@/lib/access";

/**
 * Payroll › Compliance › Legal holds & retention (EC-SEC-16). Managers of holds act here; auditors
 * (payroll:audit:read) may look. The page is reached from the Compliance tabs only.
 */
export default function LegalHoldsRoute() {
  return (
    <RequireAccess check={(me) => HOLD_READ_CODES.some((code) => canBeyondSelf(me, code))}>
      <DocsPage>
        <LegalHoldsPage />
      </DocsPage>
    </RequireAccess>
  );
}
