'use client';

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Bell, Menu, User } from "lucide-react";
import { ClipboardList } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import PageLoader from "@/components/PageLoader";
import notificationService from "@/services/notification";

import {
  LayoutDashboard,
  Users,
  CalendarCheck,
  CalendarDays,
  FileBarChart,
  ScanFace,
  Settings,
  BadgeIndianRupee,

} from "lucide-react";


export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {

  const router = useRouter();
  const pathname = usePathname();

  const {
    user,
    isAuthenticated,
    logout,
  } = useAuthStore();

  // --------------------------
  // States
  // --------------------------

  const [mounted, setMounted] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [profileOpen, setProfileOpen] = useState(false);

  const [notificationOpen, setNotificationOpen] = useState(false);

  const [notifications, setNotifications] = useState<any[]>([]);

  const [notificationCount, setNotificationCount] = useState(0);

  const [loadingNotifications, setLoadingNotifications] =
    useState(false);

  // --------------------------
  // Refs
  // --------------------------

  const notificationRef = useRef<HTMLDivElement>(null);

  const profileRef = useRef<HTMLDivElement>(null);

  // --------------------------
  // Functions
  // --------------------------

  async function loadNotifications() {
    try {
      setLoadingNotifications(true);

      const data = await notificationService.getAll();

      setNotifications(data.notifications || []);

      setNotificationCount(data.count || 0);

    } catch (error) {
      console.error("Notification Error:", error);
    } finally {
      setLoadingNotifications(false);
    }
  }
  function formatTime(dateString: string) {

  const date = new Date(dateString);

  const now = new Date();

  const seconds = Math.floor(
    (now.getTime() - date.getTime()) / 1000
  );

  if (seconds < 60) return "Just now";

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60)
    return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);

  if (hours < 24)
    return `${hours} hour${hours > 1 ? "s" : ""} ago`;

  const days = Math.floor(hours / 24);

  if (days === 1)
    return "Yesterday";

  if (days < 7)
    return `${days} days ago`;

  return date.toLocaleDateString();

}

  async function handleMarkAllAsRead() {
    try {

      await notificationService.markAllRead();

      await loadNotifications();

    } catch (error) {

      console.error(error);

    }
  }

  function handleLogout() {

    logout();

    router.push("/auth/login");

  }

  // --------------------------
  // Effects
  // --------------------------

useEffect(() => {
  setMounted(true);
}, []);

useEffect(() => {
  if (!mounted) return;

  if (!isAuthenticated) {
    router.replace("/auth/login");
    return;
  }

  if (user?.role === "employee") {
    router.replace("/employee/dashboard");
    return;
  }

  loadNotifications();

  const interval = setInterval(loadNotifications, 20000);

  return () => clearInterval(interval);

}, [mounted, isAuthenticated, user]);

  useEffect(() => {

    const handleClickOutside = (event: MouseEvent) => {

      if (
        notificationRef.current &&
        !notificationRef.current.contains(event.target as Node)
      ) {
        setNotificationOpen(false);
      }

      if (
        profileRef.current &&
        !profileRef.current.contains(event.target as Node)
      ) {
        setProfileOpen(false);
      }

    };

    document.addEventListener(
      "mousedown",
      handleClickOutside
    );

    return () =>
      document.removeEventListener(
        "mousedown",
        handleClickOutside
      );

  }, []);

  // --------------------------
  // Loading
  // --------------------------

  if (!mounted || !isAuthenticated || !user) {

  return (
     <PageLoader />
    
  );

}

// 🔒 Block employee from rendering admin layout
if (user.role === "employee") {

  return null;

}

  // --------------------------
  // Sidebar Menu
  // --------------------------

  const menuItems = [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Employees", href: "/employees", icon: Users },
    { label: "Attendance", href: "/attendance-dashboard", icon: CalendarCheck },
    { label: "Payroll", href: "/payroll", icon: BadgeIndianRupee },
    { label: "Leaves", href: "/leaves", icon: CalendarDays },
    { label: "Reports", href: "/reports", icon: FileBarChart },
    { label: "Face Recognition", href: "/face-recognition", icon: ScanFace },
    { label: "Settings", href: "/settings", icon: Settings },
    { label: "Salary Structure",href: "/salary-structure",icon: BadgeIndianRupee,},
    { label: "Audit Logs", href: "/dashboard/audit-logs", icon: ClipboardList, }
  ];
 

  

  return (
  <div className="flex h-screen bg-gray-100">

    {/* Sidebar */}

    <div
      className={`${
        sidebarOpen ? "w-64" : "w-20"
      } bg-gray-900 text-white transition-all duration-300 overflow-hidden`}
    >

      <div className="p-4 flex items-center justify-between">

        <h1
          className={`font-bold text-lg ${
            !sidebarOpen && "hidden"
          }`}
        >
          SMS
        </h1>

        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-1 hover:bg-gray-800 rounded"
        >
          <Menu size={20} />
        </button>

      </div>

      <nav className="mt-8 space-y-2 px-2">

        {menuItems.map((item) => (

          <Link
            key={item.href}
            href={item.href}
            className="flex items-center space-x-3 px-4 py-2 rounded hover:bg-gray-800 transition"
          >

            <span className="text-xl">
              <item.icon className="w-5 h-5" />
            </span>

            <span
              className={
                sidebarOpen ? "" : "hidden"
              }
            >
              {item.label}
            </span>

          </Link>

        ))}

      </nav>

    </div>

    {/* Main */}

    <div className="flex-1 flex flex-col">

      <header className="bg-white shadow-md px-8 py-4 flex items-center justify-between">

        <h2 className="text-2xl font-bold text-gray-900">

          Salary Management System

        </h2>

        <div className="flex items-center gap-6">

          {/* Notification */}

          <div
            className="relative"
            ref={notificationRef}
          >

            <button
              onClick={() =>
                setNotificationOpen(
                  !notificationOpen
                )
              }
              className="relative p-2 rounded-full hover:bg-gray-100"
            >

              <Bell size={24} />

              {notificationCount > 0 && (

                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full min-w-[20px] h-5 flex items-center justify-center px-1">

                  {notificationCount > 99
                    ? "99+"
                    : notificationCount}

                </span>

              )}

            </button>

            {notificationOpen && (

              <div className="absolute right-0 mt-3 w-96 bg-white rounded-xl shadow-2xl border z-50">

                <div className="p-4 border-b flex justify-between items-center">

                  <span className="font-semibold">
                    Notifications
                  </span>

                  <button
                    onClick={handleMarkAllAsRead}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    Mark all
                  </button>

                </div>

                <div className="max-h-96 overflow-y-auto">

                  {loadingNotifications ? (

                    

                      <PageLoader />

                    

                  ) : notifications.length === 0 ? (

                    <div className="p-6 text-center text-gray-500">

                      No notifications

                    </div>

                  ) : (

                    notifications.map((item: any) => (

                     <div
  key={item.id}
  onClick={async () => {
    try {
      if (!item.is_read) {
        await notificationService.markRead(item.id);
        await loadNotifications();
      }

      if (item.action_url) {
        router.push(item.action_url);
      }
    } catch (error) {
      console.error(error);
    }
  }}
  className={`border-b px-4 py-3 cursor-pointer hover:bg-gray-50 transition ${
    !item.is_read ? "bg-blue-50" : ""
  }`}
>

                        <p
                          className={
                            item.is_read
                              ? "font-medium"
                              : "font-bold"
                          }
                        >

                          {item.title}

                        </p>
                        <div className="mt-2">

                        <span
                        className={`inline-block rounded-full px-2 py-1 text-xs font-medium ${
                          item.notification_type === "attendance"
                          ? "bg-green-100 text-green-700"
                          : item.notification_type === "leave"
                          ? "bg-yellow-100 text-yellow-700"
                          : item.notification_type === "payroll"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-gray-100 text-gray-700"
                          }`}
                        >
                        {item.notification_type}
                        </span>

                        </div>

                        <p className="text-sm text-gray-500 mt-1">

                          {item.message}

                        </p>

                        <p className="text-xs text-gray-400 mt-2">

                          {formatTime(item.created_at)}

                        </p>

                      </div>

                    ))

                  )}

                </div>

              </div>

            )}

          </div>

          
            {/* User Profile */}
            <div
  className="relative pl-6 border-l border-gray-200"
  ref={profileRef}
>
  <button
    onClick={() => setProfileOpen(!profileOpen)}
    className="flex items-center gap-3 hover:bg-gray-100 rounded-xl px-3 py-2 transition"
  >
    <div className="text-right">
      <p className="font-semibold text-gray-900">
        {user?.username}
      </p>

      <p className="text-xs text-gray-500 capitalize">
        {user?.role}
      </p>
    </div>

    <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center">
      <User
        className="text-white"
        size={20}
      />
    </div>
  </button>

  {profileOpen && (
    <div className="absolute right-0 mt-3 w-64 bg-white rounded-xl shadow-xl border z-50 overflow-hidden">

      <div className="px-5 py-4 border-b">

        <p className="font-semibold">
          {user?.username}
        </p>

        <p className="text-sm text-gray-500">
          {user?.email}
        </p>

        <p className="text-xs text-blue-600 mt-1 capitalize">
          {user?.role}
        </p>

      </div>

      <button
        onClick={() => {
          setProfileOpen(false);
          router.push("/settings");
        }}
        className="w-full text-left px-5 py-3 hover:bg-gray-50"
      >
        ⚙️ Settings
      </button>

      <button
        onClick={() => {
          setProfileOpen(false);
          handleLogout();
        }}
        className="w-full text-left px-5 py-3 hover:bg-red-50 text-red-600"
      >
        🚪 Logout
      </button>

    </div>
  )}

</div>

</div>

</header>

<main className="flex-1 overflow-auto p-8">

  {pathname !== "/dashboard" && (

    <button
      onClick={() => router.back()}
      className="mb-6 flex items-center gap-2 rounded-xl bg-white px-4 py-2 shadow hover:bg-gray-100"
    >

      <ArrowLeft size={18} />

      Back

    </button>

  )}

  {children}

</main>

</div>

</div>
);
}