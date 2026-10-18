'use client';

import FaceAttendanceCard from '@/components/employee/FaceAttendanceCard';

export default function EmployeeAttendancePage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Employee Attendance</h1>
        <p className="text-gray-500 mt-2">
          Check-In and Check-Out using Face Recognition
        </p>
      </div>

      <FaceAttendanceCard />
    </div>
  );
}