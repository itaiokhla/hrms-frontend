interface StatusCardsProps {
  cameraConnected: boolean;
  employeeSelected: boolean;
  faceCaptured: boolean;
  aiReady: boolean;
}

export default function StatusCards({
  cameraConnected,
  employeeSelected,
  faceCaptured,
  aiReady,
}: StatusCardsProps) {
  const cards = [
    {
      icon: "📷",
      title: "Camera",
      value: cameraConnected ? "Connected" : "Disconnected",
      color: cameraConnected
        ? "text-green-600"
        : "text-red-600",
    },
    {
      icon: "👤",
      title: "Employee",
      value: employeeSelected
        ? "Selected"
        : "Not Selected",
      color: employeeSelected
        ? "text-blue-600"
        : "text-gray-500",
    },
    {
      icon: "😊",
      title: "Face",
      value: faceCaptured
        ? "Captured"
        : "Waiting",
      color: faceCaptured
        ? "text-green-600"
        : "text-orange-500",
    },
    {
      icon: "🤖",
      title: "Recognition",
      value: aiReady ? "Ready" : "Offline",
      color: aiReady
        ? "text-green-600"
        : "text-red-600",
    },
  ];

  return (
    <div className="mb-8 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.title}
          className="rounded-3xl bg-white p-6 shadow-lg transition hover:shadow-xl"
        >
          <div className="text-5xl">{card.icon}</div>

          <h3 className="mt-4 text-lg font-bold">
            {card.title}
          </h3>

          <p className={`mt-2 font-semibold ${card.color}`}>
            {card.value}
          </p>
        </div>
      ))}
    </div>
  );
}