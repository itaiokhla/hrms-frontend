"use client";

import { Suspense } from "react";

import { RequireAccess } from "@/components/access/Can";
import { RolloverPage } from "@/components/holiday/RolloverPage";
import { can } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** Holidays › Next year (09-ui-ux/02 §20): rollover review, emergency closures and imports; `holiday:manage`. */
export default function HolidaysRolloverRoute() {
  return (
    <RequireAccess check={(me) => can(me, P.HOLIDAY_MANAGE) || can(me, P.HOLIDAY_PUBLISH)}>
      <Suspense>
        <RolloverPage />
      </Suspense>
    </RequireAccess>
  );
}
