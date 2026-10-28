"use client";

import { useParams, useRouter } from "next/navigation";
import { Suspense } from "react";

import { RequireAccess } from "@/components/access/Can";
import { RuleEditor } from "@/components/holiday/RuleEditor";
import { ErrorState, PageHeader } from "@/components/ui/layout";
import { Card, Skeleton } from "@/components/ui/primitives";
import { can } from "@/lib/access";
import { useApi } from "@/lib/hooks";
import { calendarsApi, yearsApi } from "@/lib/holiday/api";
import { P } from "@/lib/permissions.generated";

/** Full-page twin of the `holiday-rule` modal (09-ui-ux/02 §18, D-LH-21); `ruleId` = "new" creates one. */
function RulePage({ calendarId, ruleId }: { calendarId: number; ruleId: number | null }) {
  const router = useRouter();
  const calendar = useApi(() => calendarsApi.get(calendarId), [calendarId]);
  const rule = useApi(() => (ruleId ? yearsApi.rule(ruleId) : Promise.resolve(null)), [ruleId]);
  const back = `/holidays/calendars/${calendarId}?tab=rules`;
  if (calendar.error || rule.error) return <ErrorState message="This calendar or rule doesn't exist or you can't see it." />;
  if (!calendar.data || (ruleId && !rule.data)) return <Skeleton className="h-96 w-full" />;
  return (
    <div>
      <PageHeader
        eyebrow={`Holidays › Calendars › ${calendar.data.code} › Rules`}
        title={rule.data ? `Edit ${rule.data.name}` : "New repeating holiday"}
        description="How the holiday repeats. Draft years follow; published years are reviewed separately."
      />
      <Card className="p-4 sm:p-6">
        <RuleEditor
          calendar={calendar.data}
          today={calendar.data.local_today ?? new Date().toISOString().slice(0, 10)}
          rule={rule.data ?? undefined}
          onCancel={() => router.push(back)}
          onSaved={() => router.push(back)}
        />
      </Card>
    </div>
  );
}

export default function RuleRoute() {
  const params = useParams<{ id: string; ruleId: string }>();
  const calendarId = Number(params?.id);
  const ruleId = params?.ruleId === "new" ? null : Number(params?.ruleId);
  const valid = Number.isInteger(calendarId) && calendarId > 0 && (ruleId === null || (Number.isInteger(ruleId) && ruleId > 0));
  return (
    <RequireAccess check={(me) => can(me, P.HOLIDAY_MANAGE)}>
      <Suspense>{valid ? <RulePage calendarId={calendarId} ruleId={ruleId} /> : null}</Suspense>
    </RequireAccess>
  );
}
