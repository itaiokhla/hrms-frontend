"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { RequireAccess } from "@/components/access/Can";
import { WorkingDayForm } from "@/components/holiday/WorkingDayForm";
import { ErrorState, PageHeader } from "@/components/ui/layout";
import { Card, Skeleton } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { useApi } from "@/lib/hooks";
import { calendarsApi } from "@/lib/holiday/api";
import { P } from "@/lib/permissions.generated";

/** Full-page twin of the `working-day` modal (01 §5.5, D-LH-21). */
function WorkingDayPage({ calendarId }: { calendarId: number }) {
  const router = useRouter();
  const search = useSearchParams();
  const calendar = useApi(() => calendarsApi.get(calendarId), [calendarId]);
  if (calendar.error) return <ErrorState message="This calendar doesn't exist or you can't see it." />;
  if (!calendar.data) return <Skeleton className="h-64 w-full" />;
  const back = `/holidays/calendars/${calendarId}?tab=working-days`;
  return (
    <div>
      <PageHeader
        eyebrow={`Holidays › Calendars › ${calendar.data.code} › Working days`}
        title="Declare a working day"
        description="Turns a weekly off into a working day for everyone on this calendar and on calendars that include it."
      />
      <Card className="max-w-2xl p-4 sm:p-6">
        <WorkingDayForm calendarId={calendarId} defaultDate={search?.get("date") ?? ""} onSaved={() => router.push(back)} onCancel={() => router.push(back)} />
      </Card>
    </div>
  );
}

export default function WorkingDayRoute() {
  const params = useParams<{ id: string }>();
  const calendarId = Number(params?.id);
  return (
    <RequireAccess check={(me) => can(me, P.HOLIDAY_MANAGE)}>
      <Suspense>{Number.isInteger(calendarId) && calendarId > 0 ? <WorkingDayPage calendarId={calendarId} /> : null}</Suspense>
    </RequireAccess>
  );
}
