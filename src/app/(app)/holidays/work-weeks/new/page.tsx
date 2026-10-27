"use client";

import { useRouter } from "next/navigation";
import { Suspense } from "react";

import { RequireAccess } from "@/components/access/Can";
import { WorkWeekEditor } from "@/components/holiday/WorkWeekEditor";
import { useEditorData } from "@/components/holiday/WorkWeeksPage";
import { PageHeader } from "@/components/ui/layout";
import { Card, Skeleton } from "@/components/ui/primitives";
import { useApi } from "@/lib/hooks";
import { workWeeksApi } from "@/lib/holiday/api";
import { can } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

/** Full-page twin of the `work-week` create modal (09-ui-ux/01 twin rule; same form component). */
function NewWorkWeek() {
  const router = useRouter();
  const editorData = useEditorData();
  const today = useApi(() => workWeeksApi.list({ limit: 1 }).then((p) => p.local_today ?? new Date().toISOString().slice(0, 10)), []);
  return (
    <div>
      <PageHeader eyebrow="Holidays › Work weeks" title="New work week" description="Start from a template or set the days yourself." />
      <Card className="p-4 sm:p-6">
        {editorData.ready && today.data ? (
          <WorkWeekEditor
            mode="create"
            templates={editorData.templates}
            entities={editorData.entities}
            today={today.data}
            onCancel={() => router.push("/holidays/work-weeks")}
            onSaved={(created) => router.push(`/holidays/work-weeks/${created.id}`)}
          />
        ) : (
          <Skeleton className="h-96 w-full" />
        )}
      </Card>
    </div>
  );
}

export default function NewWorkWeekRoute() {
  return (
    <RequireAccess check={(me) => can(me, P.HOLIDAY_MANAGE)}>
      <Suspense>
        <NewWorkWeek />
      </Suspense>
    </RequireAccess>
  );
}
