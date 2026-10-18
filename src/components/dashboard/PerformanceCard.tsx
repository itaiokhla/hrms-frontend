interface Props {
  loading: boolean;
  attendancePercentage?: number;
}

export default function PerformanceCard({
  loading,
  attendancePercentage,
}: Props) {
  return (
    <div className="rounded-3xl bg-white p-6 shadow-lg dark:bg-slate-900">
      <h2 className="text-xl font-bold dark:text-white">
        Today's Performance
      </h2>

      <div className="mt-8 flex items-center justify-center">
        <div className="relative flex h-44 w-44 items-center justify-center rounded-full border-[16px] border-green-500">
          <div className="text-center">
            <h3 className="text-4xl font-bold dark:text-white">
              {loading ? "..." : `${attendancePercentage ?? 0}%`}
            </h3>

            <p className="text-sm text-slate-500">
              Attendance
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}