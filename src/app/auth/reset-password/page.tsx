'use client';

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import api from "@/services/api";
import {
  ArrowLeft,
  Lock,
  Loader2,
  ShieldCheck,
  Eye,
  EyeOff,
} from "lucide-react";

export default function ResetPasswordPage() {

  const router = useRouter();
  const searchParams = useSearchParams();

  const email = searchParams.get("email") || "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  const resetPassword = async () => {

    setError("");
    setSuccess("");

    if (!newPassword || !confirmPassword) {
      setError("Please fill all fields.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    try {

      setLoading(true);

      const res = await api.post(
        "/auth/reset-password",
        {
          email,
          new_password: newPassword,
        }
      );

      setSuccess(res.data.message);

      setTimeout(() => {
        router.push("/auth/login");
      }, 1500);

    } catch (err: any) {

      setError(
        err.response?.data?.detail ||
        "Something went wrong."
      );

    } finally {

      setLoading(false);

    }

  };

  return (

    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-blue-100 to-indigo-100 flex items-center justify-center p-6">

      <div className="w-full max-w-md rounded-3xl bg-white p-10 shadow-2xl">

        <Link
          href="/auth/login"
          className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700"
        >
          <ArrowLeft size={18}/>
          Back to Login
        </Link>

        <div className="mt-8 flex justify-center">

          <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-blue-600 to-indigo-700 shadow-xl">

            <ShieldCheck
              size={42}
              className="text-white"
            />

          </div>

        </div>

        <h1 className="mt-8 text-center text-3xl font-bold text-gray-900">
          Reset Password
        </h1>

        <p className="mt-3 text-center text-gray-500">
          Create a new password for
        </p>

        <p className="text-center font-semibold text-gray-700 mb-8">
          {email}
        </p>

        {success && (

          <div className="mb-6 rounded-xl border border-green-200 bg-green-50 p-4">

            <p className="text-sm text-green-700">
              {success}
            </p>

          </div>

        )}

        {error && (

          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4">

            <p className="text-sm text-red-700">
              {error}
            </p>

          </div>

        )}

        {/* New Password */}

        <div className="mb-5">

          <label className="mb-2 block text-sm font-medium">
            New Password
          </label>

          <div className="relative">

            <Lock
              size={20}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
            />

            <input
              type={showNewPassword ? "text" : "password"}
              value={newPassword}
              onChange={(e)=>setNewPassword(e.target.value)}
              placeholder="Enter new password"
              className="w-full rounded-xl border py-3 pl-12 pr-12"
            />

            <button
              type="button"
              onClick={() => setShowNewPassword(!showNewPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2"
            >
              {showNewPassword ? <EyeOff size={20}/> : <Eye size={20}/>}
            </button>

          </div>

        </div>

        {/* Confirm */}

        <div>

          <label className="mb-2 block text-sm font-medium">
            Confirm Password
          </label>

          <div className="relative">

            <Lock
              size={20}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
            />

            <input
              type={showConfirmPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e)=>setConfirmPassword(e.target.value)}
              placeholder="Confirm password"
              className="w-full rounded-xl border py-3 pl-12 pr-12"
            />

            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2"
            >
              {showConfirmPassword ? <EyeOff size={20}/> : <Eye size={20}/>}
            </button>

          </div>

        </div>

        <button
          onClick={resetPassword}
          disabled={loading}
          className="mt-8 flex h-14 w-full items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-indigo-700 text-white font-semibold shadow-lg hover:shadow-2xl"
        >

          {loading ? (
            <>
              <Loader2
                className="mr-2 animate-spin"
                size={20}
              />
              Updating...
            </>
          ) : (
            "Reset Password"
          )}

        </button>

      </div>

    </div>

  );

}