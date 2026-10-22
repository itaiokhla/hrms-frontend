"use client";

import { RequireAccess } from "@/components/access/Can";
import { ReportsCatalogue } from "@/components/payroll/documents/Reports";
import { DocsPage } from "@/components/payroll/documents/shared";
import { canBeyondSelf } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** Payroll › Reports (3.8 §5.13): the catalogue grouped by purpose; exports go to the download center. */
export default function ReportsPage() {
  return (
    <RequireAccess check={(me) => canBeyondSelf(me, P.PAYROLL_REPORTS_READ)}>
      <DocsPage>
        <ReportsCatalogue />
      </DocsPage>
    </RequireAccess>
  );
}
