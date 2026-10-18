"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

const data = [
  { day: "Mon", attendance: 120 },
  { day: "Tue", attendance: 135 },
  { day: "Wed", attendance: 128 },
  { day: "Thu", attendance: 145 },
  { day: "Fri", attendance: 142 },
  { day: "Sat", attendance: 118 },
];

export default function AttendanceChart() {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-xl">
      <h2 className="mb-6 text-xl font-bold">
        Attendance Trend
      </h2>

      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />

          <XAxis dataKey="day" />

          <YAxis />

          <Tooltip />

          <Line
            type="monotone"
            dataKey="attendance"
            stroke="#2563eb"
            strokeWidth={3}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}