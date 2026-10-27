"use client";

import { Suspense } from "react";

import { RequireAccess } from "@/components/access/Can";
import { WorkWeeksPage } from "@/components/holiday/WorkWeeksPage";
import { can } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** Holidays › Work weeks (LH 09-ui-ux/02 §19): `holiday:manage` in some scope; modal key `work-week`. */
export default function WorkWeeksRoute() {
  return (
    <RequireAccess check={(me) => can(me, P.HOLIDAY_MANAGE)}>
      <Suspense>
        <WorkWeeksPage />
      </Suspense>
    </RequireAccess>
  );
}
