"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { RequireAccess } from "@/components/access/Can";
import { PublishYearPanel } from "@/components/holiday/PublishYearPanel";
import { ErrorState, PageHeader } from "@/components/ui/layout";
import { Card, Skeleton } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { useApi } from "@/lib/hooks";
import { yearsApi } from "@/lib/holiday/api";
import { P } from "@/lib/permissions.generated";

/** Full-page twin of the `publish-year` modal (01 §9.4, 09-ui-ux/02 §18); `?mode=approve-amendment` reviews a change. */
function PublishPage({ calendarId, year }: { calendarId: number; year: number }) {
  const router = useRouter();
  const search = useSearchParams();
  const view = useApi(() => yearsApi.year(calendarId, year), [calendarId, year]);
  const back = `/holidays/calendars/${calendarId}?tab=holidays`;
  const mode = search?.get("mode") === "approve-amendment" ? "approve-amendment" : "publish";
  if (view.error) return <ErrorState message="This calendar year doesn't exist or you can't see it." />;
  if (!view.data) return <Skeleton className="h-96 w-full" />;
  return (
    <div>
      <PageHeader
        eyebrow={`Holidays › Calendars › ${view.data.calendar_code}`}
        title={mode === "publish" ? `Publish ${year}` : `Review the change to ${year}`}
        description={`${view.data.calendar_name} · ${view.data.status === "PUBLISHED" ? `published v${view.data.version}` : "draft"}`}
      />
      <Card className="p-4 sm:p-6">
        <PublishYearPanel calendarId={calendarId} year={view.data} mode={mode} onCancel={() => router.push(back)} onDone={() => router.push(back)} />
      </Card>
    </div>
  );
}

export default function PublishRoute() {
  const params = useParams<{ id: string; year: string }>();
  const calendarId = Number(params?.id);
  const year = Number(params?.year);
  const valid = Number.isInteger(calendarId) && calendarId > 0 && Number.isInteger(year) && year >= 2000 && year <= 2100;
  return (
    <RequireAccess check={(me) => can(me, P.HOLIDAY_PUBLISH)}>
      <Suspense>{valid ? <PublishPage calendarId={calendarId} year={year} /> : null}</Suspense>
    </RequireAccess>
  );
}
