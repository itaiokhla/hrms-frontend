'use client';

// @ts-nocheck

import { useState, useEffect } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import api from '@/services/api';
import BackButton from "@/components/BackButton";
import SearchBar from "@/components/reports/SearchBar";

const ReportsPage = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [dashboardStats, setDashboardStats] = useState<any>(null);
const [attendanceData, setAttendanceData] = useState<any>(null);
const [payrollData, setPayrollData] = useState<any>(null);
const [search, setSearch] = useState("");
const [leaveData, setLeaveData] = useState<any>(null);
const [departmentData, setDepartmentData] = useState<any>(null);
const [employees, setEmployees] = useState<any[]>([]);
const [departments, setDepartments] = useState<any[]>([]);

  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    year: new Date().getFullYear(),
    month: '',
    employeeId: '',
    departmentId: '',
  });

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  // Fetch dashboard statistics
  const fetchDashboardStats = async () => {
    setLoading(true);
    try {
      const response = await api.get('/reports/dashboard');
      setDashboardStats(response.data);
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch attendance report
  const fetchAttendanceReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('start_date', `${filters.year}-01-01`);
      params.append('end_date', `${filters.year}-12-31`);
      if (filters.employeeId) params.append('employee_id', filters.employeeId);
      if (filters.departmentId) params.append('department_id', filters.departmentId);

      const response = await api.get(`/reports/attendance?${params}`);
      setAttendanceData(response.data);
    } catch (error) {
      console.error('Error fetching attendance report:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch payroll report
  const fetchPayrollReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('year', filters.year.toString());
      if (filters.month) params.append('month', filters.month);
      if (filters.departmentId) params.append('department_id', filters.departmentId);

      const response = await api.get(`/reports/payroll?${params}`);
      setPayrollData(response.data);
    } catch (error) {
      console.error('Error fetching payroll report:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch leave report
  const fetchLeaveReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('year', filters.year.toString());
      if (filters.employeeId) params.append('employee_id', filters.employeeId);

      const response = await api.get(`/reports/leaves?${params}`);
      setLeaveData(response.data);
    } catch (error) {
      console.error('Error fetching leave report:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch department analytics
  const fetchDepartmentAnalytics = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('year', filters.year.toString());
      if (filters.month) params.append('month', filters.month);

      const response = await api.get(`/reports/department-analytics?${params}`);
      setDepartmentData(response.data);
    } catch (error) {
      console.error('Error fetching department analytics:', error);
    } finally {
      setLoading(false);
    }
  };
  const loadEmployees = async () => {
  try {
    const res = await api.get("/employees");
    setEmployees(res.data);
  } catch (err) {
    console.error(err);
  }
};

const loadDepartments = async () => {
  try {
    const res = await api.get("/departments");
    setDepartments(res.data);
  } catch (err) {
    console.error(err);
  }
};

  const buildQueryParams = () => {
  const params = new URLSearchParams();

  if (activeTab === 'attendance') {
    let startDate: string;
    let endDate: string;

    if (filters.month !== '') {
      const month = Number(filters.month);

      startDate = `${filters.year}-${String(month).padStart(2, '0')}-01`;

      const lastDay = new Date(filters.year, month, 0).getDate();

      endDate = `${filters.year}-${String(month).padStart(2, '0')}-${lastDay}`;
    } else {
      startDate = `${filters.year}-01-01`;
      endDate = `${filters.year}-12-31`;
    }

    params.append("start_date", startDate);
    params.append("end_date", endDate);
  } else {
    params.append("year", filters.year.toString());

    if (filters.month !== "")
      params.append("month", filters.month.toString());
  }

  if (filters.employeeId)
    params.append("employee_id", filters.employeeId.toString());

  if (filters.departmentId)
    params.append("department_id", filters.departmentId.toString());

  return params;
};

  // Export to Excel
  const exportToExcel = async (reportType: string) => {
    try {
      const response = await api.get(
        `/reports/${reportType}/export/excel?${buildQueryParams()}`,
        { responseType: 'blob' }
      );

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${reportType}_report.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.parentElement?.removeChild(link);
    } catch (error) {
      console.error('Error exporting report:', error);
    }
  };

  const exportToPDF = async (reportType: string) => {
    try {
      const response = await api.get(
        `/reports/${reportType}/export/pdf?${buildQueryParams()}`,
        { responseType: 'blob' }
      );

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${reportType}_report.pdf`);
      document.body.appendChild(link);
      link.click();
      link.parentElement?.removeChild(link);
    } catch (error) {
      console.error('Error exporting report:', error);
    }
  };

  useEffect(() => {
  loadEmployees();
  loadDepartments();

  if (activeTab === "dashboard") {
    fetchDashboardStats();
  }
}, []);

useEffect(() => {
  if (activeTab === "attendance") {
    fetchAttendanceReport();
  }

  if (activeTab === "payroll") {
    fetchPayrollReport();
  }

  if (activeTab === "leaves") {
    fetchLeaveReport();
  }

  if (activeTab === "departments") {
    fetchDepartmentAnalytics();
  }
}, [activeTab, filters]);


  return (
  <div className="min-h-screen bg-gray-50 p-6">
    <div className="max-w-7xl mx-auto">

      <BackButton />

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-gray-900">
          Reports & Analytics
        </h1>

        <p className="text-gray-600 mt-2">
          Monitor attendance, payroll, leave, and department metrics
        </p>
      </div>

        {/* Filter Section */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Filters</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Year</label>
              <input
                type="number"
                min="2020"
                max="2099"
                value={filters.year}
                onChange={(e) => setFilters({ ...filters, year: parseInt(e.target.value) })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Month</label>
              <select
                value={filters.month}
                onChange={(e) => setFilters({
                  ...filters,
                 month: e.target.value,
                })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Months</option>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {new Date(0, i).toLocaleString('default', { month: 'long' })}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Employee Dropdown</label>
              <select
                value={filters.employeeId}
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    employeeId: e.target.value,
                  })
                }
                className="w-full px-4 py-2 border rounded-lg"
              >
                <option value="">All Employees</option>

                {employees.map((emp: any) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.employee_id} - {emp.first_name} {emp.last_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Department Dropdown</label>
              <select
  value={filters.departmentId}
  onChange={(e) =>
    setFilters({
      ...filters,
      departmentId: e.target.value,
    })
  }
  className="w-full px-4 py-2 border rounded-lg"
>
  <option value="">All Departments</option>

  {departments.map((dept: any) => (
    <option key={dept.id} value={dept.id}>
      {dept.name}
    </option>
  ))}
</select>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-5 mb-8">

<div className="bg-blue-600 text-white rounded-2xl p-6">
<h3>Total Employees</h3>
<p className="text-3xl font-bold">
{dashboardStats?.total_employees ?? 0}
</p>
</div>

<div className="bg-green-600 text-white rounded-2xl p-6">
<h3>Attendance</h3>
<p className="text-3xl font-bold">
{dashboardStats?.today_attendance?.present ?? 0}
</p>
</div>

<div className="bg-yellow-500 text-white rounded-2xl p-6">
<h3>Draft Payroll</h3>
<p className="text-3xl font-bold">
{dashboardStats?.payroll_status?.draft ?? 0}
</p>
</div>

<div className="bg-purple-600 text-white rounded-2xl p-6">
<h3>Departments</h3>
<p className="text-3xl font-bold">
{Object.keys(dashboardStats?.department_count || {}).length}
</p>
</div>

</div>

        {/* Tab Navigation */}
        <div className="bg-white rounded-lg shadow mb-6 border-b">
          <div className="flex flex-wrap gap-2 p-4">
            {['dashboard', 'attendance', 'payroll', 'leaves', 'departments'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 font-medium rounded-lg transition-colors ${
                  activeTab === tab
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <div className="inline-block">
              <div className="w-8 h-8 border-4 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
            </div>
            <p className="text-gray-600 mt-4">Loading report data...</p>
          </div>
        )}

        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && !loading && dashboardStats && (
          <div className="space-y-6">
            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg shadow p-6 text-white">
                <p className="text-sm font-medium opacity-90">Total Employees</p>
                <p className="text-3xl font-bold mt-2">{dashboardStats.total_employees}</p>
              </div>

              <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-lg shadow p-6 text-white">
                <p className="text-sm font-medium opacity-90">Present Today</p>
                <p className="text-3xl font-bold mt-2">{dashboardStats.today_attendance.present}</p>
              </div>

              <div className="bg-gradient-to-br from-red-500 to-red-600 rounded-lg shadow p-6 text-white">
                <p className="text-sm font-medium opacity-90">Absent Today</p>
                <p className="text-3xl font-bold mt-2">{dashboardStats.today_attendance.absent}</p>
              </div>

              <div className="bg-gradient-to-br from-amber-500 to-amber-600 rounded-lg shadow p-6 text-white">
                <p className="text-sm font-medium opacity-90">Pending</p>
                <p className="text-3xl font-bold mt-2">{dashboardStats.today_attendance.pending}</p>
              </div>
            </div>

            {/* Payroll Status */}
            <div className="bg-white rounded-lg shadow p-6">
            
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Object.entries(dashboardStats.payroll_status).map(([status, count]) => (
                  <div key={status} className="text-center p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-600 capitalize">{status}</p>
                    <p className="text-2xl font-bold text-gray-900 mt-2">{String(count)}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Department Distribution */}
            <div className="bg-white rounded-lg shadow p-6">
             
              
            </div>
             <div className="space-y-6">
            
            

            {/* Department Distribution */}
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-6">Employees by Department</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  {Object.entries(dashboardStats.department_count).map(
  ([dept, count]: [string, any]) => (
                    <div key={dept} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                      <span className="text-gray-700 font-medium">{dept}</span>
                      <span className="bg-blue-500 text-white px-3 py-1 rounded-full text-sm font-semibold">
                        {count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
                  <div className="mt-8 h-96">
  <ResponsiveContainer width="100%" height="100%">
    <PieChart>
      <Pie
        data={Object.entries(dashboardStats?.department_count || {}).map(
  ([name, value]) => ({
    name,
    value,
  })
)}
        dataKey="value"
        nameKey="name"
        outerRadius={120}
        label
      >
        {Object.entries(dashboardStats?.department_count || {}).map((_, index) => (
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
<div className="bg-white rounded-xl shadow p-6">
  <h2 className="text-xl font-semibold mb-5">
    Attendance Distribution
  </h2>

  <ResponsiveContainer width="100%" height={320}>
    <PieChart>
      <Pie
        data={[
          {
            name: "Present",
            value: dashboardStats?.today_attendance?.present ?? 0,
          },
          {
            name: "Absent",
            value: dashboardStats?.today_attendance?.absent ?? 0,
          },
          {
            name: "Pending",
            value: dashboardStats?.today_attendance?.pending ?? 0,
          },
        ]}
        outerRadius={110}
        dataKey="value"
        label
      >
        <Cell fill="#22c55e" />
        <Cell fill="#ef4444" />
        <Cell fill="#f59e0b" />
      </Pie>

      <Tooltip />
    </PieChart>
  </ResponsiveContainer>
</div>

<div className="bg-white rounded-xl shadow p-6">
  <h2 className="text-xl font-semibold mb-5">
    Payroll Status
  </h2>

  <ResponsiveContainer width="100%" height={320}>
    <PieChart>
      <Pie
        data={Object.entries(
          dashboardStats?.payroll_status || {}
        ).map(([name, value]) => ({
          name,
          value,
        }))}
        outerRadius={110}
        dataKey="value"
        label
      >
        {COLORS.map((c, i) => (
          <Cell key={i} fill={c} />
        ))}
      </Pie>

      <Tooltip />
    </PieChart>
  </ResponsiveContainer>
</div>
        
          </div>
          
        )}


        {/* Attendance Tab */}
        {activeTab === 'attendance' && !loading && (
          <div className="space-y-6">
            

            {attendanceData && (
              <>
                <div className="bg-white rounded-lg shadow p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Attendance Summary: {attendanceData.period}</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center p-4 bg-green-50 rounded-lg">
                      <p className="text-sm text-gray-600">Present</p>
                      <p className="text-2xl font-bold text-green-600 mt-2">{attendanceData.summary.total_present}</p>
                    </div>
                    <div className="text-center p-4 bg-red-50 rounded-lg">
                      <p className="text-sm text-gray-600">Absent</p>
                      <p className="text-2xl font-bold text-red-600 mt-2">{attendanceData.summary.total_absent}</p>
                    </div>
                    <div className="text-center p-4 bg-yellow-50 rounded-lg">
                      <p className="text-sm text-gray-600">Late</p>
                      <p className="text-2xl font-bold text-yellow-600 mt-2">{attendanceData.summary.total_late}</p>
                    </div>
                    <div className="text-center p-4 bg-blue-50 rounded-lg">
                      <p className="text-sm text-gray-600">Half Day</p>
                      <p className="text-2xl font-bold text-blue-600 mt-2">{attendanceData.summary.total_half_day}</p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 items-center mb-4">
                  <button
  onClick={() => exportToExcel('attendance')}
  className="rounded-xl bg-green-600 px-5 py-3 font-semibold text-white hover:bg-green-700"
>
  📥 Export Excel
</button>
                  <button
  onClick={() => exportToPDF('attendance')}
  className="rounded-xl bg-red-600 px-5 py-3 font-semibold text-white hover:bg-red-700"
>
  📄 Export PDF
</button>

                  <button
  onClick={() => window.print()}
  className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700"
>
  🖨 Print
</button>
                </div>

                

                <SearchBar
                  value={search}
                  onChange={setSearch}
                  placeholder="Search Employee..."
                />
                
                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-100 border-b">
                        <tr>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Employee</th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Date</th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Check-In</th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Check Out</th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(attendanceData?.records ?? [])
.filter((record: any) =>
  record.employee_name
    ?.toLowerCase()
    .includes(search.toLowerCase())
)
.slice(0, 10)
.map((record: any, idx: number) => (
                          <tr key={idx} className="border-b hover:bg-gray-50">
                            <td className="px-6 py-3 text-sm text-gray-900">{record.employee_name}</td>
                            <td className="px-6 py-3 text-sm text-gray-600">{new Date(record.date).toLocaleDateString("en-GB", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                              })}</td>
                            <td className="px-6 py-3 text-sm text-gray-600"> 
                              {record.check_in_time
                                ? new Date(record.check_in_time).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "N/A"}
                              </td>

                            <td className="px-6 py-3 text-sm text-gray-600">
                              {record.check_out_time
                                ? new Date(record.check_out_time).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "--"}
                            </td>

                            <td className="px-6 py-3 text-sm">
                              <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                                record.status === 'present' ? 'bg-green-100 text-green-800' :
                                record.status === 'absent' ? 'bg-red-100 text-red-800' :
                                record.status === 'late' ? 'bg-yellow-100 text-yellow-800' :
                                'bg-blue-100 text-blue-800'
                              }`}>
                                {record.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Payroll Tab */}
        {activeTab === 'payroll' && !loading && (
          <div className="space-y-6">
            

            {payrollData && (
              <>
                <div className="bg-white rounded-lg shadow p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Payroll Summary: {payrollData.period}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="text-center p-4 bg-blue-50 rounded-lg">
                      <p className="text-sm text-gray-600">Total Gross</p>
                      <p className="text-2xl font-bold text-blue-600 mt-2">₹{payrollData.summary.total_gross.toLocaleString()}</p>
                    </div>
                    <div className="text-center p-4 bg-red-50 rounded-lg">
                      <p className="text-sm text-gray-600">Total Deductions</p>
                      <p className="text-2xl font-bold text-red-600 mt-2">₹{payrollData.summary.total_deductions.toLocaleString()}</p>
                    </div>
                    <div className="text-center p-4 bg-green-50 rounded-lg">
                      <p className="text-sm text-gray-600">Total Net</p>
                      <p className="text-2xl font-bold text-green-600 mt-2">₹{payrollData.summary.total_net.toLocaleString()}</p>
                    </div>
                    <div className="text-center p-4 bg-purple-50 rounded-lg">
                      <p className="text-sm text-gray-600">Average Salary</p>
                      <p className="text-2xl font-bold text-purple-600 mt-2">₹{payrollData.summary.average_salary.toLocaleString()}</p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 items-center mb-4">
                  <button
  onClick={() => exportToExcel('payroll')}
  className="rounded-xl bg-green-600 px-5 py-3 font-semibold text-white hover:bg-green-700"
>
  📥 Export Excel
</button>
                  <button
  onClick={() => exportToPDF('payroll')}
  className="rounded-xl bg-red-600 px-5 py-3 font-semibold text-white hover:bg-red-700"
>
  📄 Export PDF
</button>

                  <button
  onClick={() => window.print()}
  className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700"
>
  🖨 Print
</button>

                </div>

                <SearchBar
    value={search}
    onChange={setSearch}
    placeholder="Search Employee..."
/>
                
                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-100 border-b">
                        <tr>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Employee</th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Gross</th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Deductions</th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Net</th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Status</th>
                        </tr>
                      </thead>
                      <tbody>
  {(payrollData?.records ?? [])
    .filter((record: any) =>
      record.employee_name
        ?.toLowerCase()
        .includes(search.toLowerCase())
    )
    .slice(0, 10)
    .map((record: any, idx: number) => (
      <tr key={idx} className="border-b hover:bg-gray-50">
        <td className="px-6 py-3 text-sm text-gray-900">
          {record.employee_name}
        </td>

        <td className="px-6 py-3 text-sm text-gray-600">
          ₹{record.gross_salary.toLocaleString()}
        </td>

        <td className="px-6 py-3 text-sm text-gray-600">
          ₹{record.total_deductions.toLocaleString()}
        </td>

        <td className="px-6 py-3 text-sm font-semibold text-green-600">
          ₹{record.net_salary.toLocaleString()}
        </td>

        <td className="px-6 py-3 text-sm">
          <span
            className={`px-3 py-1 rounded-full text-xs font-medium ${
              record.status === "paid"
                ? "bg-green-100 text-green-800"
                : record.status === "processed"
                ? "bg-blue-100 text-blue-800"
                : record.status === "approved"
                ? "bg-yellow-100 text-yellow-800"
                : "bg-gray-100 text-gray-800"
            }`}
          >
            {record.status}
          </span>
        </td>
      </tr>
    ))}
</tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Leaves Tab */}
        {activeTab === 'leaves' && !loading && (
          <div className="space-y-6">
           

            {leaveData && (
              <>
                <div className="bg-white rounded-lg shadow p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Leave Summary: {leaveData.period}</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {Object.entries(leaveData.summary).map(
  ([leaveType, stats]: [string, any]) => (
                      <div key={leaveType} className="p-4 bg-gray-50 rounded-lg">
                        <p className="text-sm text-gray-600 capitalize">{leaveType.replace(/_/g, ' ')}</p>
                        <div className="mt-2 space-y-1">
                          <p className="text-sm"><span className="font-medium">Applied:</span> {stats.applied}</p>
                          <p className="text-sm"><span className="font-medium">Approved:</span> {stats.approved}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 items-center mb-4">
                  <button
  onClick={() => exportToExcel('leaves')}
  className="rounded-xl bg-green-600 px-5 py-3 font-semibold text-white hover:bg-green-700"
>
  📥 Export Excel
</button>
                  <button
  onClick={() => exportToPDF('leaves')}
  className="rounded-xl bg-red-600 px-5 py-3 font-semibold text-white hover:bg-red-700"
>
  📄 Export PDF
</button>

                  <button
  onClick={() => window.print()}
  className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700"
>
  🖨 Print
</button>



                </div>
                <SearchBar
    value={search}
    onChange={setSearch}
    placeholder="Search Employee..."
/>

                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-100 border-b">
                        <tr>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Employee</th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Type</th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">From - To</th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Days</th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Status</th>
                        </tr>
                      </thead>
                      <tbody>
  {(leaveData?.records ?? [])
    .filter((record: any) =>
      record.employee_name
        ?.toLowerCase()
        .includes(search.toLowerCase())
    )
    .slice(0, 10)
    .map((record: any, idx: number) => (
      <tr key={idx} className="border-b hover:bg-gray-50">
        <td className="px-6 py-3 text-sm text-gray-900">
          {record.employee_name}
        </td>

        <td className="px-6 py-3 text-sm text-gray-600">
          {record.leave_type}
        </td>

        <td className="px-6 py-3 text-sm text-gray-600">
          {new Date(record.start_date).toLocaleDateString()} to{" "}
          {new Date(record.end_date).toLocaleDateString()}
        </td>

        <td className="px-6 py-3 text-sm font-semibold text-gray-900">
          {record.days}
        </td>

        <td className="px-6 py-3 text-sm">
          <span
            className={`px-3 py-1 rounded-full text-xs font-medium ${
              record.status === "approved"
                ? "bg-green-100 text-green-800"
                : record.status === "rejected"
                ? "bg-red-100 text-red-800"
                : "bg-yellow-100 text-yellow-800"
            }`}
          >
            {record.status}
          </span>
        </td>
      </tr>
    ))}
</tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Departments Tab */}
{activeTab === 'departments' && !loading && (
  <div className="space-y-6">
    

    {departmentData && (
      <>
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-6">
            Department Analytics: {departmentData.period}
          </h3>

          {/* Pie Chart */}
          <ResponsiveContainer width="100%" height={350}>
            <PieChart>
              <Pie
                data={departmentData.analytics.map((dept: any) => ({
                  name: dept.department_name,
                  value: dept.total_employees,
                }))}
                dataKey="value"
                nameKey="name"
                outerRadius={120}
                label
              >
                {departmentData.analytics.map((_: any, index: number) => (
                  <Cell
                    key={index}
                    fill={COLORS[index % COLORS.length]}
                  />
                ))}
              </Pie>

              <Tooltip />
            </PieChart>
          </ResponsiveContainer>

          {/* Department Cards */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5 mt-8">
            {departmentData.analytics.map((dept: any) => (
              <div
                key={dept.department_id}
                className="rounded-xl border p-5 shadow-sm"
              >
                <h3 className="font-bold text-lg">
                  {dept.department_name}
                </h3>

                <div className="mt-4 space-y-2">
                  <p>
                    Employees :
                    <span className="font-bold">
                      {" "}
                      {dept.total_employees}
                    </span>
                  </p>

                  <p>
                    Present :
                    <span className="text-green-600 font-semibold">
                      {" "}
                      {dept.attendance.present}
                    </span>
                  </p>

                  <p>
                    Average Salary :
                    <span className="text-blue-600 font-semibold">
                      ₹{(dept.payroll?.average_salary ?? 0).toLocaleString()}
                    </span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </>
    )}
  </div>
)}  
        
      </div>
    </div>
  );
};

export default ReportsPage;