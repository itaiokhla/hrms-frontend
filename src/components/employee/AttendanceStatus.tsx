'use client';

interface AttendanceStatusProps {
  status: string;
  checkIn: string | null;
  checkOut: string | null;
  workingHours: string;
}

export default function AttendanceStatus({
  status,
  checkIn,
  checkOut,
  workingHours,
}: AttendanceStatusProps) {
  const badgeColor =
    status === 'Present'
      ? 'bg-green-100 text-green-700'
      : status === 'Absent'
      ? 'bg-red-100 text-red-700'
      : 'bg-yellow-100 text-yellow-700';

  return (
    <div className="rounded-xl border bg-white dark:bg-gray-900 p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Today's Attendance</h2>

        <span className={`px-3 py-1 rounded-full text-sm font-medium ${badgeColor}`}>
          {status}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-4 mt-6">
        <div>
          <p className="text-sm text-gray-500">Check In</p>
          <p className="font-semibold">
            {checkIn ?? '--'}
          </p>
        </div>

        <div>
          <p className="text-sm text-gray-500">Check Out</p>
          <p className="font-semibold">
            {checkOut ?? '--'}
          </p>
        </div>

        <div>
          <p className="text-sm text-gray-500">Working Hours</p>
          <p className="font-semibold">
            {workingHours}
          </p>
        </div>
      </div>
    </div>
  );
}