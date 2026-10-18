"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

interface Props {
  data: {
    date: string;
    present: number;
    absent: number;
  }[];
}

export default function AttendanceTrendChart({ data }: Props) {
  return (
    <div className="rounded-3xl bg-white p-6 shadow-lg dark:bg-slate-900">
      <h2 className="mb-6 text-2xl font-bold dark:text-white">
        Attendance Trend (Last 7 Days)
      </h2>

      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />

          <XAxis dataKey="date" />

          <YAxis allowDecimals={false} />

          <Tooltip />

          <Legend />

          <Bar
            dataKey="present"
            fill="#22c55e"
            radius={[6, 6, 0, 0]}
            name="Present"
          />

          <Bar
            dataKey="absent"
            fill="#ef4444"
            radius={[6, 6, 0, 0]}
            name="Absent"
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}