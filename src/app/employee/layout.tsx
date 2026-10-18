'use client';

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import PageLoader from "@/components/PageLoader";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Clock3,
  Wallet,
  CalendarDays,
  User,
  LogOut,
} from "lucide-react";

export default function EmployeeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const { user, logout, isAuthenticated } = useAuthStore();
  const [mounted, setMounted] = useState(false);

  const menu = [
    {
      title: "Dashboard",
      href: "/employee/dashboard",
      icon: LayoutDashboard,
    },
    {
      title: "Attendance",
      href: "/employee/attendance",
      icon: Clock3,
    },
    {
      title: "Salary",
      href: "/employee/salary",
      icon: Wallet,
    },
    {
      title: "My Leaves",
      href: "/employee/leaves",
      icon: CalendarDays,
    },
    {
      title: "Profile",
      href: "/employee/profile",
      icon: User,
    },
  ];

  useEffect(() => {
  setMounted(true);
}, []);


  useEffect(() => {
  if (!mounted) return;

  if (!isAuthenticated) {
    router.replace("/auth/login");
    return;
  }

  if (user?.role !== "employee") {
    router.replace("/dashboard");
  }
}, [mounted, user, isAuthenticated, router]);

   if (!mounted || !isAuthenticated || !user) {
  return (
    
      <PageLoader />
    
  );
}
  return (
    <div className="flex min-h-screen bg-gray-100">

      {/* Sidebar */}

      <aside className="w-64 bg-slate-900 text-white flex flex-col">

        <div className="p-6 border-b border-slate-800">

          <h1 className="text-2xl font-bold">
            Employee Panel
          </h1>

          <p className="text-sm text-slate-400 mt-1">
            Salary Management
          </p>

        </div>

        <nav className="flex-1 p-4 space-y-2">

          {menu.map((item) => {

            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 transition ${
                  pathname === item.href
                    ? "bg-blue-600 text-white"
                    : "hover:bg-slate-800"
                }`}
              >
                <Icon size={20} />
                {item.title}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-800 p-4">

          <div className="mb-4">

            <p className="font-semibold">
              {user?.username}
            </p>

            <p className="text-xs text-slate-400">
              {user?.email}
            </p>

          </div>

          <button
            onClick={() => {
              logout();
              router.push("/auth/login");
            }}
            className="flex w-full items-center gap-3 rounded-xl bg-red-500 px-4 py-3 hover:bg-red-600 transition"
          >
            <LogOut size={20} />
            Logout
          </button>

        </div>

      </aside>

      {/* Main */}

      <main className="flex-1 p-8">
        {children}
      </main>

    </div>
  );
}