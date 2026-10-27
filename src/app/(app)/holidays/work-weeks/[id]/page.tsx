"use client";

import { useParams } from "next/navigation";
import { Suspense } from "react";

import { RequireAccess } from "@/components/access/Can";
import { WorkWeekDetailPage } from "@/components/holiday/WorkWeekDetail";
import { canAny } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** Pattern detail (04-holiday/03 §5.10): readable with `holiday:read` by link, actions need `holiday:manage`. */
export default function WorkWeekDetailRoute() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  return (
    <RequireAccess check={(me) => canAny(me, [P.HOLIDAY_MANAGE, P.HOLIDAY_READ])}>
      <Suspense>{Number.isInteger(id) && id > 0 ? <WorkWeekDetailPage id={id} /> : null}</Suspense>
    </RequireAccess>
  );
}
