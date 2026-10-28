"use client";

import { useRouter } from "next/navigation";
import { Suspense } from "react";

import { RequireAccess } from "@/components/access/Can";
import { CalendarForm } from "@/components/holiday/CalendarsPage";
import { PageHeader } from "@/components/ui/layout";
import { Card } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** Full-page twin of the `holiday-calendar` create modal (09-ui-ux/01 twin rule; same form component). */
function NewCalendar() {
  const router = useRouter();
  return (
    <div>
      <PageHeader eyebrow="Holidays › Calendars" title="New calendar" description="Own holidays, includes and exclusions come next." />
      <Card className="p-4 sm:p-6">
        <CalendarForm onCancel={() => router.push("/holidays/calendars")} onSaved={(c) => router.push(`/holidays/calendars/${c.id}?tab=includes`)} />
      </Card>
    </div>
  );
}

export default function NewCalendarRoute() {
  return (
    <RequireAccess check={(me) => can(me, P.HOLIDAY_MANAGE)}>
      <Suspense>
        <NewCalendar />
      </Suspense>
    </RequireAccess>
  );
}
