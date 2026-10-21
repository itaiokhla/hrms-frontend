"use client";

import { BulkImport } from "@/components/payroll/compensation/BulkImport";
import { BackLink, CompensationWorkspace } from "@/components/payroll/compensation/shared";
import { PageHeader } from "@/components/ui/layout";
import { Card } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** Full page of the "Bulk assign (CSV)" modal (page/modal parity, D-12). */
export default function CompensationImportPage() {
  return (
    <CompensationWorkspace check={(me) => can(me, P.PAYROLL_COMPENSATION_EDIT)}>
      <div className="max-w-4xl">
        <BackLink href="/payroll/compensation">Assign salary</BackLink>
        <PageHeader title="Bulk assign salaries (CSV)" description="Template → upload and check → commit. Every row becomes a salary change waiting for approval." />
        <Card className="p-5">
          <BulkImport />
        </Card>
      </div>
    </CompensationWorkspace>
  );
}
