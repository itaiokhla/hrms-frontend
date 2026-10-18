'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  User,
  Mail,
  Lock,
  EyeOff,
  Eye,
  Loader2,
  ScanFace,
  Users,
  Wallet,
  BarChart3,
  ShieldCheck,
} from 'lucide-react';

const signupSchema = z
  .object({
    username: z
      .string()
      .min(3, 'Username must be at least 3 characters')
      .max(50, 'Username must not exceed 50 characters')
      .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
    email: z.string().email('Please enter a valid email address'),
    role: z.enum(['employee', 'admin', 'manager']),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(8, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

type SignupFormData = z.infer<typeof signupSchema>;

export default function SignupPage() {
  const router = useRouter();
  const { setUser, setTokens } = useAuthStore();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      role: 'employee',
    },
  });

  const onSubmit = async (data: SignupFormData) => {
    setApiError(null);
    setIsLoading(true);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
      const response = await fetch(`${apiUrl}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: data.username,
          email: data.email,
          password: data.password,
          role: data.role,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.detail || 'Registration failed. Please try again.');
      }

      // Automatically store tokens and user state
      if (result.user && result.access_token) {
        setUser(result.user);
        setTokens(result.access_token, result.refresh_token);
        toast.success('Account created successfully!');

        // Route to the appropriate dashboard
        if (result.user.role === 'admin') {
          router.push('/dashboard');
        } else {
          router.push('/employee/dashboard');
        }
      } else {
        toast.success('Account created! Please sign in.');
        router.push('/auth/login');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Registration failed';
      setApiError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
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
              Create Your
              <br />
              Account
            </h1>

            <p className="uppercase tracking-[6px] text-blue-100 mt-5 text-sm">
              HRMS & Facial Attendance
            </p>

            <p className="mt-8 text-lg leading-8 text-blue-100 max-w-md">
              Join the salary and employee management system with zero setup. Track attendance, apply for leaves, and view payroll.
            </p>
          </div>

          {/* Features */}
          <div className="relative z-10 grid grid-cols-2 gap-5 mt-12">
            <div className="bg-white/15 backdrop-blur-md rounded-2xl p-5 hover:bg-white/20 transition-all duration-300 hover:-translate-y-1 cursor-default">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-white/20">
                <Users size={24} />
              </div>
              <p className="font-semibold">Quick Setup</p>
              <p className="text-sm text-blue-100">Zero database hassle</p>
            </div>

            <div className="bg-white/15 hover:bg-white/20 transition-all duration-300 hover:-translate-y-1 cursor-default backdrop-blur-md rounded-2xl p-5">
              <ScanFace className="mb-3" />
              <p className="font-semibold">Face Recognition</p>
              <p className="text-sm text-blue-100">Automated Attendance</p>
            </div>

            <div className="bg-white/15 hover:bg-white/20 transition-all duration-300 hover:-translate-y-1 cursor-default backdrop-blur-md rounded-2xl p-5">
              <Wallet className="mb-3" />
              <p className="font-semibold">Payroll</p>
              <p className="text-sm text-blue-100">Live Salary Slips</p>
            </div>

            <div className="bg-white/15 hover:bg-white/20 transition-all duration-300 hover:-translate-y-1 cursor-default backdrop-blur-md rounded-2xl p-5">
              <BarChart3 className="mb-3" />
              <p className="font-semibold">Analytics</p>
              <p className="text-sm text-blue-100">Real-time Insights</p>
            </div>
          </div>
        </div>

        {/* ================= RIGHT PANEL ================= */}
        <div className="flex items-center justify-center px-6 py-10 lg:p-14">
          <div className="w-full max-w-lg rounded-3xl border border-gray-200 shadow-xl bg-white p-6 sm:p-8">
            <div className="mb-6 flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 shadow-lg">
                <ScanFace size={30} className="text-white" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900">Salary Management</h3>
                <p className="text-xs text-gray-500">Sign up for a new account</p>
              </div>
            </div>

            <h2 className="text-3xl font-bold text-gray-900">Get Started</h2>
            <p className="text-gray-500 mt-2 mb-6 text-sm">
              Create your account to start managing attendance and payroll.
            </p>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {apiError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                  <p className="text-sm text-red-600">{apiError}</p>
                </div>
              )}

              {/* Username */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Username</label>
                <div className="relative">
                  <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    {...register('username')}
                    placeholder="Enter username"
                    className="w-full rounded-xl border border-gray-300 bg-gray-50 hover:bg-white py-2.5 pl-11 pr-4 text-sm outline-none transition-all duration-300 hover:border-blue-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-100"
                  />
                </div>
                {errors.username && <p className="mt-1 text-xs text-red-500">{errors.username.message}</p>}
              </div>

              {/* Email */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Email Address</label>
                <div className="relative">
                  <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    {...register('email')}
                    type="email"
                    placeholder="user@example.com"
                    className="w-full rounded-xl border border-gray-300 bg-gray-50 hover:bg-white py-2.5 pl-11 pr-4 text-sm outline-none transition-all duration-300 hover:border-blue-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-100"
                  />
                </div>
                {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email.message}</p>}
              </div>

              {/* Role Selection */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Account Role</label>
                <div className="relative">
                  <ShieldCheck size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                  <select
                    {...register('role')}
                    className="w-full rounded-xl border border-gray-300 bg-gray-50 hover:bg-white py-2.5 pl-11 pr-4 text-sm outline-none transition-all duration-300 hover:border-blue-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-100"
                  >
                    <option value="employee">Employee</option>
                    <option value="admin">Administrator</option>
                    <option value="manager">Manager</option>
                  </select>
                </div>
                {errors.role && <p className="mt-1 text-xs text-red-500">{errors.role.message}</p>}
              </div>

              {/* Password */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Password</label>
                <div className="relative">
                  <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    {...register('password')}
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Minimum 8 characters"
                    className="w-full rounded-xl border border-gray-300 bg-gray-50 hover:bg-white py-2.5 pl-11 pr-11 text-sm outline-none transition-all duration-300 hover:border-blue-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-500"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {errors.password && <p className="mt-1 text-xs text-red-500">{errors.password.message}</p>}
              </div>

              {/* Confirm Password */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Confirm Password</label>
                <div className="relative">
                  <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    {...register('confirmPassword')}
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="Re-enter your password"
                    className="w-full rounded-xl border border-gray-300 bg-gray-50 hover:bg-white py-2.5 pl-11 pr-11 text-sm outline-none transition-all duration-300 hover:border-blue-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-500"
                  >
                    {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {errors.confirmPassword && (
                  <p className="mt-1 text-xs text-red-500">{errors.confirmPassword.message}</p>
                )}
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isLoading}
                className="group flex h-12 w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#2563EB] to-[#4338CA] text-white font-semibold shadow-lg transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl active:scale-95 disabled:opacity-70 mt-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 animate-spin" size={18} />
                    Creating Account...
                  </>
                ) : (
                  'Sign Up'
                )}
              </button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-sm text-gray-600">
                Already have an account?{' '}
                <Link href="/auth/login" className="font-semibold text-blue-600 hover:text-blue-700">
                  Log in
                </Link>
              </p>
            </div>

            <div className="mt-6 border-t pt-4 text-center">
              <p className="text-xs text-gray-400">© 2026 Salary Management System • Secure & Fast</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
