'use client';

import FaceAttendanceCard from '@/components/employee/FaceAttendanceCard';
import BackButton from "@/components/BackButton";

export default function EmployeeAttendancePage() {
  return (
    <div className="p-6">
      <BackButton />

        <div>
          <h1 className="text-3xl font-bold">
            Dashboard
          </h1>
          <p className="text-gray-500">
            Welcome back
          </p>
        </div>
      <h1 className="text-3xl font-bold mb-6">
        Employee Attendance
      </h1>

      <FaceAttendanceCard />
    </div>
  );
}