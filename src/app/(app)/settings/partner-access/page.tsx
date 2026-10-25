"use client";

import { RequireAccess } from "@/components/access/Can";
import { PartnerAccessPage } from "@/components/settings/partner-access/PartnerAccessPage";
import { can } from "@/lib/access";
import { P } from "@/lib/permissions.generated";

export default function PartnerAccessRoute() {
  return (
    <RequireAccess check={(me) => can(me, P.SETTINGS_PARTNER_ACCESS_MANAGE)}>
      <PartnerAccessPage />
    </RequireAccess>
  );
}
