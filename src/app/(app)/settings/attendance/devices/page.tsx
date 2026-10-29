"use client";

import { RequireAccess } from "@/components/access/Can";
import { DevicesWorkspace } from "@/components/attendance/Devices";
import { canManageDevices } from "@/lib/attendance-routes";

/** Settings › Attendance › Devices & biometrics (G-17): the same console as Attendance › Devices. */
export default function DeviceSettingsPage() {
  return (
    <RequireAccess check={canManageDevices}>
      <DevicesWorkspace eyebrow="Settings · Attendance" />
    </RequireAccess>
  );
}
