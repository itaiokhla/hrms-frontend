"use client";

import { useParams } from "next/navigation";

import { NotFoundState, CompensationWorkspace } from "@/components/payroll/compensation/shared";
import { StructureBuilder } from "@/components/payroll/compensation/StructureBuilder";
import { can } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** Payroll › Salary Structures › {id}: the structure builder (3.8 §5.8). Deep links: ?modal=publish, ?modal=move. */
export default function StructurePage() {
  const params = useParams<{ id: string }>();
  const id = Number.parseInt(String(params?.id ?? ""), 10);
  return (
    <CompensationWorkspace check={(me) => can(me, P.PAYROLL_SALARY_STRUCTURE_READ)}>
      {Number.isInteger(id) && id > 0 ? <StructureBuilder key={id} id={id} /> : <NotFoundState what="Salary structure" backHref="/payroll/structures" backLabel="Back to structures" />}
    </CompensationWorkspace>
  );
}
