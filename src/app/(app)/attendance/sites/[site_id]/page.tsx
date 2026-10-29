"use client";

import { useParams } from "next/navigation";

import { RequireAccess } from "@/components/access/Can";
import { SiteDetailView } from "@/components/attendance/Sites";
import { PayrollPage } from "@/components/payroll/inputs/shared";
import { ATTENDANCE_ROUTE_GUARDS } from "@/lib/attendance-routes";

/** One site (AS 09-ui-ux/01: `/attendance/sites/{site_id}`): details, drawing, network test, QR poster, archive. */
export default function SitePage() {
  const params = useParams<{ site_id: string }>();
  return (
    <RequireAccess check={ATTENDANCE_ROUTE_GUARDS["/attendance/sites/[site_id]"]}>
      <PayrollPage>
        <SiteDetailView id={String(params?.site_id ?? "")} />
      </PayrollPage>
    </RequireAccess>
  );
}
