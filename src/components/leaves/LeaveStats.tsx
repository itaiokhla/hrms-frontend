interface Props {
  stats: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
  };
}

export default function LeaveStats({ stats }: Props) {
  const cards = [
    {
      title: "Total Leaves",
      value: stats.total,
      color: "bg-blue-500",
      icon: "📄",
    },
    {
      title: "Pending",
      value: stats.pending,
      color: "bg-yellow-500",
      icon: "⏳",
    },
    {
      title: "Approved",
      value: stats.approved,
      color: "bg-green-500",
      icon: "✅",
    },
    {
      title: "Rejected",
      value: stats.rejected,
      color: "bg-red-500",
      icon: "❌",
    },
  ];

  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.title}
          className="rounded-2xl bg-white p-6 shadow"
        >
          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm text-gray-500">
                {card.title}
              </p>

              <h2 className="text-4xl font-bold mt-2">
                {card.value}
              </h2>
            </div>

            <div
              className={`w-14 h-14 rounded-xl ${card.color} flex items-center justify-center text-2xl`}
            >
              {card.icon}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}