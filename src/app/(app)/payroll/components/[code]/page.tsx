"use client";

import { useParams } from "next/navigation";

import { ComponentEditor } from "@/components/payroll/compensation/ComponentEditor";
import { CompensationWorkspace } from "@/components/payroll/compensation/shared";
import { can } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** Payroll › Components › {code}: the full-page component editor with the formula tester (3.8 §5.9). */
export default function ComponentPage() {
  const params = useParams<{ code: string }>();
  const code = decodeURIComponent(String(params?.code ?? ""));
  return (
    <CompensationWorkspace check={(me) => can(me, P.PAYROLL_SALARY_STRUCTURE_READ)}>
      <ComponentEditor key={code} code={code} />
    </CompensationWorkspace>
  );
}
