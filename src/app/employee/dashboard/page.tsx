'use client';

import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/authStore";
import employeeService from "@/services/employeeService";
import {
  Clock3,
  Wallet,
  CalendarDays,
  CheckCircle,
} from "lucide-react";

export default function EmployeeDashboard() {
  const { user } = useAuthStore();

  const [attendance, setAttendance] = useState({
  status: "Absent",
  check_in: null as string | null,
  check_out: null as string | null,
  working_hours: "00:00:00",
});

const [loading, setLoading] = useState(true);

useEffect(() => {

  employeeService
    .getTodayAttendance()
    .then((data) => {
      setAttendance(data);
    })
    .catch(console.error)
    .finally(() => setLoading(false));

}, []);

  const cards = [
  {
    title: "Today's Attendance",
    value: loading ? "..." : attendance.status,
    icon: CheckCircle,
    color: "bg-green-100",
  },
  {
    title: "Working Hours",
    value: loading ? "..." : attendance.working_hours,
    icon: Clock3,
    color: "bg-blue-100",
  },
  {
    title: "Leave Balance",
    value: "0",
    icon: CalendarDays,
    color: "bg-yellow-100",
  },
  {
    title: "Current Salary",
    value: "₹0",
    icon: Wallet,
    color: "bg-purple-100",
  },
];

  return (
    <div>

      <div className="mb-8">

        <h1 className="text-4xl font-bold">
          Welcome, {user?.username}
        </h1>

        <p className="mt-2 text-gray-500">
          Employee Self Service Dashboard
        </p>

      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">

        {cards.map((card) => {

          const Icon = card.icon;

          return (
            <div
              key={card.title}
              className={`${card.color} rounded-2xl p-6 shadow`}
            >
              <div className="flex items-center justify-between">

                <div>

                  <p className="text-sm text-gray-600">
                    {card.title}
                  </p>

                  <h2 className="mt-2 text-3xl font-bold">
                    {card.value}
                  </h2>

                </div>

                <Icon size={34} />

              </div>
            </div>
          );
        })}

      </div>

    </div>
  );
}