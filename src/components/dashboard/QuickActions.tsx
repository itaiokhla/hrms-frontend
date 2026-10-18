const actions = [
  {
    title: "Employees",
    desc: "Manage workforce",
    icon: "👥",
    href: "/employees",
  },
  {
    title: "Attendance",
    desc: "Face recognition check-in",
    icon: "📸",
    href: "/attendance",
  },
  {
    title: "Payroll",
    desc: "Salary processing",
    icon: "💰",
    href: "/payroll",
  },
  {
    title: "Reports",
    desc: "Analytics & exports",
    icon: "📈",
    href: "/reports",
  },
  {
    title: "Leave Requests",
    desc: "Approve leaves",
    icon: "🏖️",
    href: "/leaves",
  },
  {
    title: "Settings",
    desc: "System configuration",
    icon: "⚙️",
    href: "/settings",
  },
];

export default function QuickActions() {
  return (
    <div className="rounded-3xl bg-white p-6 shadow-lg dark:bg-slate-900">
      <h2 className="mb-6 text-2xl font-bold text-slate-900 dark:text-white">
        Quick Actions
      </h2>

      <div className="grid gap-4 md:grid-cols-3">
        {actions.map((action) => (
          <a
            key={action.title}
            href={action.href}
            className="rounded-2xl border p-5 transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            <div className="text-4xl">{action.icon}</div>

            <h3 className="mt-3 font-semibold">{action.title}</h3>

            <p className="text-sm text-slate-500">{action.desc}</p>
          </a>
        ))}
      </div>
    </div>
  );
}