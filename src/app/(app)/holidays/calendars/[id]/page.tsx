"use client";

import { useParams } from "next/navigation";
import { Suspense } from "react";

import { RequireAccess } from "@/components/access/Can";
import { CalendarDetailPage } from "@/components/holiday/CalendarDetail";
import { canAny } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** Calendar detail (04-holiday/01 §3–4): `?tab=holidays|includes|exclusions|assignments`, modal `calendar-assignment`. */
export default function CalendarDetailRoute() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  return (
    <RequireAccess check={(me) => canAny(me, [P.HOLIDAY_MANAGE, P.HOLIDAY_READ])}>
      <Suspense>{Number.isInteger(id) && id > 0 ? <CalendarDetailPage id={id} /> : null}</Suspense>
    </RequireAccess>
  );
}
