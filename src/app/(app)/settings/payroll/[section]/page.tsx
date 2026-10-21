"use client";

import { notFound, useParams } from "next/navigation";
import { Suspense } from "react";

import { RequireAccess } from "@/components/access/Can";
import { ChangeRequests } from "@/components/payroll/settings/ChangeRequests";
import { sectionBySlug } from "@/components/payroll/settings/model";
import { SettingsSection } from "@/components/payroll/settings/SettingsSection";
import { PageHeader } from "@/components/ui/layout";
import { can, canAny } from "@/lib/access";
import { P } from "@/lib/permissions.generated";
import { CHANGE_REQUESTS_SLUG, isPayrollSettingsSlug } from "@/lib/settings-nav";

/**
 * Settings › Payroll › {section}: one page per section of the generated settings registry
 * (settings.generated.ts), plus the settings change requests list. Unknown sections are a 404.
 */
export default function PayrollSettingsPage() {
  const params = useParams<{ section: string }>();
  const slug = String(params?.section ?? "");
  if (!isPayrollSettingsSlug(slug)) notFound();

  if (slug === CHANGE_REQUESTS_SLUG) {
    return (
      <RequireAccess check={(me) => canAny(me, [P.PAYROLL_CONFIGURATION_READ, P.SETTINGS_APPROVE_CHANGES])}>
        <PageHeader
          eyebrow="Settings › Security"
          title="Settings change requests"
          description="Changes to protected settings wait here for a second administrator when approval of settings changes is on."
        />
        <ChangeRequests />
      </RequireAccess>
    );
  }

  const section = sectionBySlug(slug)!;
  return (
    <RequireAccess check={(me) => can(me, P.PAYROLL_CONFIGURATION_READ)}>
      <Suspense>
        <SettingsSection key={section.slug} section={section} />
      </Suspense>
    </RequireAccess>
  );
}
