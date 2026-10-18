"use client";

import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";

interface Props {
  summary: {
    present: number;
    absent: number;
    leave: number;
    working: number;
  };
}

const COLORS = [
  "#22c55e",
  "#ef4444",
  "#f59e0b",
  "#3b82f6",
];

export default function EmployeeStatusChart({
  summary,
}: Props) {

  const data = [
    {
      name: "Present",
      value: summary.present,
    },
    {
      name: "Absent",
      value: summary.absent,
    },
    {
      name: "Leave",
      value: summary.leave,
    },
    {
      name: "Working",
      value: summary.working,
    },
  ];

  return (
    <div className="rounded-3xl bg-white p-6 shadow-lg dark:bg-slate-900">

      <h2 className="mb-6 text-2xl font-bold dark:text-white">
        Employee Status
      </h2>

      <ResponsiveContainer width="100%" height={320}>
        <PieChart>

          <Pie
            data={data}
            dataKey="value"
            outerRadius={110}
            label
          >
            {data.map((_, index) => (
              <Cell
                key={index}
                fill={COLORS[index]}
              />
            ))}
          </Pie>

          <Tooltip />

          <Legend />

        </PieChart>
      </ResponsiveContainer>

    </div>
  );
}