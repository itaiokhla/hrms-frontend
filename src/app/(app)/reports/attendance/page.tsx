"use client";

import { RequireAccess } from "@/components/access/Can";
import { RegistersHub } from "@/components/attendance/registers/RegistersHub";
import { canExportAttendance } from "@/lib/attendance-routes";

/** Reports › Attendance registers (10-analytics §6; G-20): Form 25 muster roll and Form D attendance register. */
export default function AttendanceRegistersPage() {
  return (
    <RequireAccess check={canExportAttendance}>
      <RegistersHub />
    </RequireAccess>
  );
}
