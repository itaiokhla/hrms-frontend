"use client";

import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

const data = [
  { name: "IT", value: 40 },
  { name: "HR", value: 20 },
  { name: "Sales", value: 25 },
  { name: "Finance", value: 15 },
];

const COLORS = [
  "#3B82F6",
  "#22C55E",
  "#F59E0B",
  "#EF4444",
];

export default function DepartmentChart() {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-xl">
      <h2 className="mb-6 text-xl font-bold">
        Department Distribution
      </h2>

      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            outerRadius={100}
            label
          >
            {data.map((_, index) => (
              <Cell
                key={index}
                fill={COLORS[index % COLORS.length]}
              />
            ))}
          </Pie>

          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}