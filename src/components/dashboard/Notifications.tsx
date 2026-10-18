interface Props {
  notifications: any[];
}

const getIcon = (type: string) => {
  switch (type) {
    case "checkin":
      return "🟢";

    case "checkout":
      return "🔵";

    default:
      return "📢";
  }
};

export default function Notifications({
  notifications,
}: Props) {

  return (

    <div className="rounded-3xl bg-white p-6 shadow-lg dark:bg-slate-900">

      <h2 className="mb-6 text-2xl font-bold dark:text-white">
        Notifications
      </h2>

      {notifications.length === 0 ? (

        <p className="text-gray-500">
          No notifications
        </p>

      ) : (

        <div className="space-y-4">

          {notifications.map((item, index) => (

            <div
              key={index}
              className="flex items-start gap-3 rounded-xl border p-4 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >

              <div className="text-2xl">
                {getIcon(item.type)}
              </div>

              <div>

                <p className="font-medium dark:text-white">
                  {item.message}
                </p>

                <p className="text-xs text-slate-500">
                  {new Date(item.time).toLocaleTimeString()}
                </p>

              </div>

            </div>

          ))}

        </div>

      )}

    </div>

  );

}