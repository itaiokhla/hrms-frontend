'use client';

import { useEffect, useMemo, useState } from "react";
import LiveWorkingTimer from "@/components/dashboard/LiveWorkingTimer";
import attendanceService, {
  DashboardEmployee,
  DashboardResponse,
} from "@/services/attendance";
import DashboardCard from "@/components/dashboard/DashboardCard";
import LiveClock from "@/components/dashboard/LiveClock";
import AttendanceChart from "@/components/dashboard/AttendanceChart";
import DepartmentChart from "@/components/dashboard/DepartmentChart";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";


import {
  Users,
  UserCheck,
  UserX,
  Timer,
  CheckCircle,
} from "lucide-react";

export default function AttendanceDashboard() {

  const router = useRouter();

  const [dashboard, setDashboard] =
    useState<DashboardResponse | null>(null);

  const [loading, setLoading] = useState(true);

  const [search] = useState("");

  const loadDashboard = async () => {

    try {

      const data = await attendanceService.getDashboard();

      setDashboard(data);

    } catch (err) {

      console.log(err);

    } finally {

      setLoading(false);

    }

  };

  useEffect(() => {

    loadDashboard();

    const timer = setInterval(() => {

      loadDashboard();

    }, 10000);

    return () => clearInterval(timer);

  }, []);

  const employees = useMemo(() => {

    if (!dashboard) return [];

    return dashboard.employees.filter((emp) =>

      emp.employee_name
        .toLowerCase()
        .includes(search.toLowerCase())

    );

  }, [dashboard, search]);

  if (loading) {

    return (

      <div className="flex h-screen items-center justify-center text-2xl font-bold">

        Loading Attendance Dashboard...

      </div>

    );

  }

  if (!dashboard) {

    return (

      <div className="flex h-screen items-center justify-center text-red-600 text-xl">

        Failed to load dashboard.

      </div>

    );

  }

  return (

<div className="min-h-screen bg-slate-100 p-8">
  <button
  onClick={() => router.back()}
  className="mb-6 flex items-center gap-2 rounded-xl bg-white px-4 py-2 shadow-md hover:bg-gray-100 transition"
>
  <ArrowLeft size={18} />
  Back
</button>

<div className="mb-10 flex items-center justify-between">

  <div>

    <h1 className="text-4xl font-bold">
      Attendance Dashboard
    </h1>

    <p className="mt-2 text-gray-500">
      Live Attendance Monitoring
    </p>

  </div>

  <LiveClock />

</div>

<div className="grid gap-6 md:grid-cols-5">

  <DashboardCard
    title="Employees"
    value={dashboard.total_employees}
    color="bg-white"
    icon={Users}
  />

  <DashboardCard
    title="Present"
    value={dashboard.present_today}
    color="bg-green-100"
    icon={UserCheck}
  />

  <DashboardCard
    title="Absent"
    value={dashboard.absent_today}
    color="bg-red-100"
    icon={UserX}
  />

  <DashboardCard
    title="Working"
    value={dashboard.working_now}
    color="bg-yellow-100"
    icon={Timer}
  />

  <DashboardCard
    title="Completed"
    value={dashboard.completed_today}
    color="bg-blue-100"
    icon={CheckCircle}
  />

</div>

<div className="mt-10 rounded-2xl bg-white shadow-xl">

  <div className="flex items-center justify-between border-b p-6">

    <h2 className="text-2xl font-bold">

      Today's Attendance

    </h2>

    <div className="text-sm text-gray-500">

      Auto Refresh : 10 Seconds

    </div>

  </div>

  <div className="overflow-x-auto">

    <table className="min-w-full">

      <thead className="sticky top-0 bg-slate-200">

        <tr>

          <th className="px-6 py-4 text-left">Employee</th>

          <th className="px-6 py-4 text-left">Department</th>

          <th className="px-6 py-4 text-left">Check In</th>

          <th className="px-6 py-4 text-left">Check Out</th>

          <th className="px-6 py-4 text-left">Working Hours</th>

          <th className="px-6 py-4 text-left">Status</th>

        </tr>

      </thead>

      <tbody>

        {employees.length === 0 ? (

          <tr>

            <td
              colSpan={6}
              className="py-10 text-center text-gray-500"
            >

              No Employees Found

            </td>

          </tr>

        ) : (

          employees.map((emp: DashboardEmployee) => (

            <tr
              key={emp.employee_id}
              className="border-b transition-all duration-300 hover:bg-blue-50 hover:shadow-sm"
            >

              <td className="px-6 py-4 font-semibold">

                {emp.employee_name}

              </td>

              <td className="px-6 py-4">

                {emp.department}

              </td>

              <td className="px-6 py-4">

                {emp.check_in || "--"}

              </td>

              <td className="px-6 py-4">

                {emp.check_out || "--"}

              </td>

              <td className="px-6 py-4">
  {emp.status === "Working" && emp.check_in ? (
    <LiveWorkingTimer checkIn={emp.check_in} />
  ) : (
    <span className="font-medium text-gray-700">
      {emp.working_hours || "--"}
    </span>

  )}
</td>
              <td className="px-6 py-4">

               

  {emp.status === "Working" ? (

    <span className="inline-flex items-center rounded-full bg-green-100 px-4 py-2 text-sm font-semibold text-green-700">

      🟢 Working

    </span>

  ) : (

    <span className="inline-flex items-center rounded-full bg-blue-100 px-4 py-2 text-sm font-semibold text-blue-700">

      ✅ Completed

    </span>

  )}

</td>

              

            </tr>

          ))

        )}

      </tbody>

    </table>

  </div>

</div>

<div className="mt-10 grid gap-6 lg:grid-cols-2">

  <AttendanceChart />

  <DepartmentChart />

</div>

</div>

);

}