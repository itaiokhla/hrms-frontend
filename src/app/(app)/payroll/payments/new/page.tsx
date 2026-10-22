"use client";

import { useSearchParams } from "next/navigation";

import { RequireAccess } from "@/components/access/Can";
import { CreateBatchPage } from "@/components/payroll/money/CreateBatch";
import { PayrollPage } from "@/components/payroll/money/shared";

import { canPrepare } from "../access";

function Inner() {
  const search = useSearchParams();
  return <CreateBatchPage runId={search?.get("run") ?? null} />;
}

/** Create payment batch as a full page (parity with `?modal=new-batch&run=`). */
export default function NewBatchPage() {
  return (
    <RequireAccess check={canPrepare}>
      <PayrollPage>
        <Inner />
      </PayrollPage>
    </RequireAccess>
  );
}
