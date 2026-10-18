interface Props {
  leaves: any[];
}

export default function UpcomingLeaves({
  leaves,
}: Props) {
  return (
    <div className="rounded-3xl bg-white p-6 shadow-lg dark:bg-slate-900">

      <h2 className="mb-6 text-2xl font-bold dark:text-white">
        📅 Upcoming Leaves
      </h2>

      {leaves.length === 0 ? (

        <div className="text-gray-500">
          No upcoming leaves
        </div>

      ) : (

        <div className="space-y-4">

          {leaves.map((leave, index) => (

            <div
              key={index}
              className="rounded-xl border p-4"
            >

              <h3 className="font-semibold dark:text-white">
                {leave.employee_name}
              </h3>

              <p className="text-sm text-gray-500">
                {leave.leave_type}
              </p>

              <p className="text-xs text-blue-600 mt-1">
                {new Date(
                  leave.start_date
                ).toLocaleDateString()}
              </p>

            </div>

          ))}

        </div>

      )}

    </div>
  );
}