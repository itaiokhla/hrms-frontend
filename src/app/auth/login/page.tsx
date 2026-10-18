'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from "next/link";
import {
  User,
  Lock,
  EyeOff,
  Loader2,
  Eye,
  ScanFace,
  Users,
  Wallet,
  BarChart3,
} from 'lucide-react';


const loginSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const { login, error: authError, isLoading } = useAuthStore();
  const [showPassword, setShowPassword] = useState(false);
const [rememberMe, setRememberMe] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    setApiError(null);
    try {
      await login(data.username, data.password);

const { user } = useAuthStore.getState();

switch (user?.role) {
  case "admin":
    router.push("/dashboard");
    break;

  case "employee":
    router.push("/employee/dashboard");
    break;

  default:
    router.push("/dashboard");
}
    } catch (error) {
      setApiError(
        error instanceof Error ? error.message : 'Login failed. Please try again.'
      );
    }
  };

  return (
  <div className="relative overflow-hidden min-h-screen bg-gradient-to-br from-slate-100 via-blue-100 to-indigo-100 flex items-center justify-center p-6">
    

    <div className="w-full max-w-7xl bg-white rounded-[36px] overflow-hidden shadow-[0_30px_80px_rgba(0,0,0,0.18)] grid lg:grid-cols-2">

      {/* ================= LEFT PANEL ================= */}

      <div className="hidden lg:flex relative flex-col justify-between bg-gradient-to-br from-[#1E3A8A] via-[#2563EB] to-[#1D4ED8] text-white p-14">

        {/* Background Blur */}
        <div className="absolute -top-20 -left-20 w-72 h-72 rounded-full bg-white/10 blur-3xl"></div>
        <div className="absolute bottom-0 right-0 w-72 h-72 rounded-full bg-cyan-400/10 blur-3xl"></div>

        <div className="relative z-10">

          <div className="w-20 h-20 rounded-3xl bg-white flex items-center justify-center shadow-xl mb-8">
            <ScanFace className="text-blue-700" size={42} />
          </div>

          <h1 className="text-4xl xl:text-5xl font-extrabold leading-tight">
            Salary
            <br />
            Management
          </h1>

          <p className="uppercase tracking-[6px] text-blue-100 mt-5 text-sm">
            Facial Attendance System
          </p>

          <p className="mt-8 text-lg leading-8 text-blue-100 max-w-md">
            Manage attendance, payroll, leave and employee records from one secure platform.
          </p>

        </div>

        {/* Features */}

        <div className="relative z-10 grid grid-cols-2 gap-5 mt-12">

          <div className="bg-white/15 backdrop-blur-md rounded-2xl p-5 hover:bg-white/20 transition-all duration-300 hover:-translate-y-1 cursor-default">

            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-white/20">

              <Users size={24} />

            </div>

            <p className="font-semibold">
                Employee
            </p>

            <p className="text-sm text-blue-100">
                Management
            </p>

          </div>

          <div className="bg-white/15
            hover:bg-white/20
            transition-all
            duration-300
            hover:-translate-y-1
            cursor-default backdrop-blur-md rounded-2xl p-5">
            <ScanFace className="mb-3" />
            <p className="font-semibold">Face</p>
            <p className="text-sm text-blue-100">
              Attendance
            </p>
          </div>

          <div className="bg-white/15
            hover:bg-white/20
            transition-all
            duration-300
            hover:-translate-y-1
            cursor-default backdrop-blur-md rounded-2xl p-5">
            <Wallet className="mb-3" />
            <p className="font-semibold">Payroll</p>
            <p className="text-sm text-blue-100">
              Salary System
            </p>
          </div>

          <div className="bg-white/15
            hover:bg-white/20
            transition-all
            duration-300
            hover:-translate-y-1
            cursor-default backdrop-blur-md rounded-2xl p-5">
            <BarChart3 className="mb-3" /> 
            <p className="font-semibold">Reports</p>
            <p className="text-sm text-blue-100">
              Analytics
            </p>
          </div>

        </div>

      </div>

      

     

      {/* ================= RIGHT PANEL ================= */}

      <div className="flex items-center justify-center px-6 py-10 lg:p-16">

        <div className="w-full max-w-lg rounded-3xl border border-gray-200 shadow-xl bg-white p-2">

          <div className="mb-8 flex items-center gap-4">

  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 shadow-lg"> 

    <ScanFace 
      size={34}
      className="text-white"
    />

  </div>

  <div>

    <h3 className="text-2xl font-bold text-gray-900">
      Salary Management
    </h3>

    <p className="text-sm text-gray-500">
      Facial Attendance System
    </p>

  </div>

</div>

          <h2 className="text-4xl font-bold text-gray-900">
            Welcome Back!
          </h2>

          <p className="text-gray-500 mt-3 mb-8">
           Sign in to access your employee management dashboard.
          </p>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">

  {(apiError || authError) && (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
      <p className="text-sm text-red-600">
        {apiError || authError}
      </p>
    </div>
  )}

  {/* Username */}

  <div>

    <label className="mb-2 block text-sm font-medium text-gray-700">
      Username
    </label>

    <div className="relative">

      <User
        size={20}
        className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
      />

      <input
        {...register("username")}
        placeholder="Enter username"
        className="w-full rounded-xl border border-gray-300 bg-gray-50 hover:bg-white py-3 pl-12 pr-4 outline-none transition-all duration-300 hover:border-blue-400 hover:shadow-md focus:border-blue-600 focus:ring-4 focus:ring-blue-100 focus:shadow-lg"
      />

    </div>

    {errors.username && (
      <p className="mt-2 text-sm text-red-500">
        {errors.username.message}
      </p>
    )}

  </div>

  {/* Password */}

  <div>

    <label className="mb-2 block text-sm font-medium text-gray-700">
      Password
    </label>

    <div className="relative">

      <Lock
        size={20}
        className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
      />

      <input
        {...register("password")}
        type={showPassword ? "text" : "password"}
        placeholder="Enter password"
        className="w-full rounded-xl border border-gray-300 bg-gray-50 hover:bg-white py-3 pl-12 pr-12 outline-none transition-all duration-300 hover:shadow-md focus:border-blue-600 focus:ring-4 focus:ring-blue-100 focus:shadow-lg"
      />

      <button
        type="button"
        onClick={() => setShowPassword(!showPassword)}
        className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500"
      >
        {showPassword ? (
          <EyeOff size={20} />
        ) : (
          <Eye size={20} />
        )}
      </button>

    </div>

    {errors.password && (
      <p className="mt-2 text-sm text-red-500">
        {errors.password.message}
      </p>
    )}

  </div>

  {/* Remember */}

  <div className="flex items-center justify-between">

    <label className="flex items-center gap-2 text-sm text-gray-600">

      <input
        type="checkbox"
        checked={rememberMe}
        onChange={(e) => setRememberMe(e.target.checked)}
        className="h-4 w-4 rounded border-gray-300 text-blue-600"
      />

      Remember me

    </label>

    <Link
  href="/auth/forgot-password"
  className="text-sm font-medium text-blue-600 hover:text-blue-700"
>
  Forgot Password?
</Link>

  </div>

  {/* Login */}

  <button
    type="submit"
    disabled={isLoading}
    className="group flex h-14 w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#2563EB] to-[#4338CA] text-white font-semibold shadow-lg transition-all duration-300 hover:-translate-y-1 hover:scale-[1.02] hover:shadow-2xl active:scale-95"
  >

    {isLoading ? (
      <>
        <Loader2
          className="mr-2 animate-spin"
          size={20}
        />
        Logging in...
      </>
    ) : (
      "Login"
    )}

  </button>

</form>

<div className="mt-10 border-t pt-6 text-center">

  <p className="text-sm text-gray-500">
    © 2026 Salary Management System
  </p>

  <p className="mt-1 text-xs text-gray-400">
    Secure • Fast • Reliable
  </p>

</div>

        </div>

      </div>

    </div>

  </div>

  
);
}