import CountUp from "react-countup";


interface DashboardStats {
  total_employees?: number;
  present_today?: number;
  absent_today?: number;
  on_leave?: number;
}

interface FaceStats {
  registered: number;
}

interface Props {
  stats: DashboardStats;
  faceStats: FaceStats;
  loading: boolean;
}

export default function StatsCards({
  stats,
  faceStats,
  loading,
}: Props) {
  const cards = [
    {
      title: "Total Employees",
      value: stats.total_employees || 0,
      icon: "👥",
      color: "from-blue-500 to-cyan-500",
    },
    {
      title: "Present Today",
      value: stats.present_today || 0,
      icon: "✅",
      color: "from-green-500 to-emerald-500",
    },
    {
      title: "Absent Today",
      value: stats.absent_today || 0,
      icon: "❌",
      color: "from-red-500 to-rose-500",
    },
    {
      title: "On Leave",
      value: stats.on_leave || 0,
      icon: "🏖️",
      color: "from-yellow-500 to-orange-500",
    },
    {
      title: "Face Registered",
      value: faceStats.registered,
      icon: "🤖",
      color: "from-purple-500 to-fuchsia-500",
    },
  ];

  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-5">
      {cards.map((card) => (
        <div
          key={card.title}
          className="overflow-hidden rounded-3xl bg-white shadow-lg transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl dark:bg-slate-900"
        >
          <div className={`h-2 bg-gradient-to-r ${card.color}`} />

          <div className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">{card.title}</p>

                <h2 className="mt-2 text-4xl font-bold text-slate-900 dark:text-white">
  {loading ? (
    "..."
  ) : (
    <CountUp
      end={Number(card.value)}
      duration={1.2}
      separator=","
    />
  )}
</h2>
              </div>

              <div className="text-5xl">{card.icon}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}