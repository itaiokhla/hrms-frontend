interface Activity {
  employee_name: string;
  check_in: string | null;
  check_out: string | null;
  status: string;
}

interface Props {
  activities: Activity[];
}

const getStatusBadge = (status: string) => {
  switch (status.toLowerCase()) {
    case "working":
      return (
        <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
          Working
        </span>
      );

    case "checked out":
      return (
        <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
          Checked Out
        </span>
      );

    default:
      return (
        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
          {status}
        </span>
      );
  }
};

export default function RecentActivity({ activities }: Props) {
  return (
    <div className="rounded-3xl bg-white p-6 shadow-lg dark:bg-slate-900">
      <h2 className="mb-6 text-2xl font-bold dark:text-white">
        Recent Activity
      </h2>

      {activities.length === 0 ? (
        <div className="py-8 text-center text-gray-500">
          No recent activity found
        </div>
      ) : (
        <div className="space-y-4">
          {activities.map((activity, index) => (
            <div
              key={index}
              className="flex items-center justify-between rounded-xl border p-4 transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              <div>
                <p className="font-semibold dark:text-white">
                  {activity.employee_name}
                </p>

                <div className="mt-2">
                  {getStatusBadge(activity.status)}
                </div>
              </div>

              <div className="text-right">
                <p className="text-sm">
                  {activity.check_in
                    ? new Date(activity.check_in).toLocaleTimeString()
                    : "-"}
                </p>

                {activity.check_out && (
                  <p className="text-xs text-slate-500">
                    Out:{" "}
                    {new Date(activity.check_out).toLocaleTimeString()}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}