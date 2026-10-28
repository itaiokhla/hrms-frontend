"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { RequireAccess } from "@/components/access/Can";
import { HolidayImportWizard } from "@/components/holiday/HolidayImportWizard";
import { ErrorState, PageHeader } from "@/components/ui/layout";
import { Card, Skeleton } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { useApi } from "@/lib/hooks";
import { calendarsApi } from "@/lib/holiday/api";
import { P } from "@/lib/permissions.generated";

/** Full-page twin of the `import-holidays` modal (02 §9.1, D-LH-21): CSV / ICS check, review and commit. */
function ImportPage({ calendarId }: { calendarId: number }) {
  const router = useRouter();
  const search = useSearchParams();
  const calendar = useApi(() => calendarsApi.get(calendarId), [calendarId]);
  if (calendar.error) return <ErrorState message="This calendar doesn't exist or you can't see it." />;
  if (!calendar.data) return <Skeleton className="h-96 w-full" />;
  const localYear = Number((calendar.data.local_today ?? new Date().toISOString()).slice(0, 4));
  const back = `/holidays/calendars/${calendarId}`;
  return (
    <div>
      <PageHeader
        eyebrow={`Holidays › Calendars › ${calendar.data.code}`}
        title="Import holidays"
        description="Bring holidays in from a spreadsheet or a calendar file. You review every line before anything is saved."
      />
      <Card className="p-4 sm:p-6">
        <HolidayImportWizard
          calendarId={calendarId}
          calendarCode={calendar.data.code}
          defaultYear={Number(search?.get("year")) || localYear + 1}
          localYear={localYear}
          onDone={() => undefined}
          onCancel={() => router.push(back)}
        />
      </Card>
    </div>
  );
}

export default function ImportRoute() {
  const params = useParams<{ id: string }>();
  const calendarId = Number(params?.id);
  return (
    <RequireAccess check={(me) => can(me, P.HOLIDAY_MANAGE)}>
      <Suspense>{Number.isInteger(calendarId) && calendarId > 0 ? <ImportPage calendarId={calendarId} /> : null}</Suspense>
    </RequireAccess>
  );
}
