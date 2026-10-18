'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import dashboardService from "@/services/dashboard";
import AttendanceTrendChart from "@/components/dashboard/AttendanceTrendChart";
import StatsCards from "@/components/dashboard/StatsCards";
import WelcomeBanner from "@/components/dashboard/WelcomeBanner";
import QuickActions from "@/components/dashboard/QuickActions";
import RecentActivity from "@/components/dashboard/RecentActivity";
import PerformanceCard from "@/components/dashboard/PerformanceCard";
import EmployeeStatusChart from "@/components/dashboard/EmployeeStatusChart";
import Notifications from "@/components/dashboard/Notifications";
import UpcomingLeaves from "@/components/dashboard/UpcomingLeaves";
import { RefreshCw } from "lucide-react";
import SkeletonCard from "@/components/common/SkeletonCard";
import type { AttendanceTrend } from "@/types/dashboard";

interface DashboardStats {
  total_employees?: number;
  present_today?: number;
  absent_today?: number;
  on_leave?: number;
  working_now?: number;
  completed_today?: number;
  attendance_percentage?: number;
}

export default function DashboardPage() {
const { user } = useAuthStore();
const [recentActivity, setRecentActivity] = useState<any[]>([]);
const [upcomingLeaves, setUpcomingLeaves] = useState<any[]>([]);

const [stats, setStats] = useState<DashboardStats>({});
const [loading, setLoading] = useState(true);
const [notifications, setNotifications] = useState<any[]>([]);
const [trendData, setTrendData] = useState<AttendanceTrend[]>([]);
const [initialLoading, setInitialLoading] = useState(true);
const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
const [faceStats, setFaceStats] = useState({
  registered: 0,
});
const [statusSummary, setStatusSummary] = useState({
  present: 0,
  absent: 0,
  leave: 0,
  working: 0,
});

const fetchDashboardData = async () => {

    try {
      if (initialLoading){

      setLoading(true);
      }

      const [
        dashboard,
        notifications,
        upcoming,
        summary,
        activity,
        trend,
        face,
      ] = await Promise.all([
        dashboardService.getDashboard(),
        dashboardService.getNotifications(),
        dashboardService.getUpcomingLeaves(),
        dashboardService.getStatusSummary(),
        dashboardService.getRecentActivity(),
        dashboardService.getAttendanceTrend(),
        dashboardService.getFaceRegisteredCount(),
      ]);

        setStats(dashboard);
        setNotifications(notifications);
        setStatusSummary(summary);
        setRecentActivity(activity);
        setTrendData(trend);
        setFaceStats(face);
        setUpcomingLeaves(upcoming);
    } catch (error) {

      console.error(error);

    } finally {
      setLastUpdated(new Date());

      if (initialLoading) {
    setLoading(false);
    setInitialLoading(false);
  }

    }

  };


useEffect(() => {

  

  fetchDashboardData();

  const interval = setInterval(fetchDashboardData, 30000);

  return () => clearInterval(interval);

}, []);



return (
  <div className="min-h-screen bg-slate-50 p-6">
    <div className="flex justify-end mb-4">
      <button
        onClick={fetchDashboardData}
        disabled={loading}
        className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        <RefreshCw
          size={18}
          className={loading ? "animate-spin" : ""}
        />
        Refresh
      </button>
      {lastUpdated && (
        <p className="text-right text-sm text-gray-500 mb-4">
          Last Updated: {lastUpdated.toLocaleTimeString()}
        </p>
      )}
    </div>

    <WelcomeBanner username={user?.username} />

    {loading ? (
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    ) : (
      <StatsCards
        stats={stats}
        faceStats={faceStats}
        loading={loading}
      />
    )}

    {/* Quick Actions + Performance */}
    <div className="mt-8 grid gap-8 xl:grid-cols-3">

      <QuickActions />

      <PerformanceCard
        loading={loading}
        attendancePercentage={stats.attendance_percentage}
      />

    </div>

    {/* Charts */}
    <div className="mt-8 grid gap-8 xl:grid-cols-2">

      <AttendanceTrendChart
        data={trendData}
      />

      <EmployeeStatusChart
        summary={statusSummary}
      />

    </div>

    {/* Recent Activity + Notifications */}
    <div className="mt-8 grid gap-8 xl:grid-cols-2">

      <RecentActivity
        activities={recentActivity}
      />

      <Notifications
        notifications={notifications}
      />

    <UpcomingLeaves
        leaves={upcomingLeaves}
    />

</div>

  </div>
);
}