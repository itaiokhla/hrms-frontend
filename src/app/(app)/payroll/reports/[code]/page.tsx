"use client";

import { useParams } from "next/navigation";

import { RequireAccess } from "@/components/access/Can";
import { ReportPage } from "@/components/payroll/documents/Reports";
import { DocsPage } from "@/components/payroll/documents/shared";
import { canBeyondSelf } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** One report: filters, preview of the first rows and export (full page of `?modal=report&code=`). */
export default function ReportDetailPage() {
  const params = useParams<{ code: string }>();
  return (
    <RequireAccess check={(me) => canBeyondSelf(me, P.PAYROLL_REPORTS_READ)}>
      <DocsPage>
        <ReportPage code={decodeURIComponent(String(params?.code ?? ""))} />
      </DocsPage>
    </RequireAccess>
  );
}
