"use client";

import { RequireAccess } from "@/components/access/Can";
import { DevicesWorkspace } from "@/components/attendance/Devices";
import { canManageDevices } from "@/lib/attendance-routes";

/** Attendance › Devices (04-attendance/01 §13.4): kiosks, biometric terminals and agents, mappings, CSV imports. */
export default function DevicesPage() {
  return (
    <RequireAccess check={canManageDevices}>
      <DevicesWorkspace />
    </RequireAccess>
  );
}
