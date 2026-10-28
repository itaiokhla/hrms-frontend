"use client";

import { Suspense } from "react";

import { RequireAccess } from "@/components/access/Can";
import { CalendarsPage } from "@/components/holiday/CalendarsPage";
import { canAny } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** Holidays › Calendars (LH 09-ui-ux/02 §18): list readable with `holiday:read`; modal key `holiday-calendar`. */
export default function CalendarsRoute() {
  return (
    <RequireAccess check={(me) => canAny(me, [P.HOLIDAY_MANAGE, P.HOLIDAY_READ])}>
      <Suspense>
        <CalendarsPage />
      </Suspense>
    </RequireAccess>
  );
}
