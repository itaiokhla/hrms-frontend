'use client';

import { useState } from "react";
import Link from "next/link";
import api from "@/services/api";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Mail,
  Loader2,
  ShieldCheck,
} from "lucide-react";

export default function ForgotPasswordPage() {

  const [email, setEmail] = useState("");

  const router = useRouter();

  const [loading, setLoading] = useState(false);

  const [success, setSuccess] = useState("");

  const [error, setError] = useState("");

 const sendOTP = async () => {

    setError("");
    setSuccess("");

    if (!email) {
      setError("Please enter your email.");
      return;
    }

    try {

      setLoading(true);

      const res = await api.post(
        "/auth/forgot-password",
        {
          email,
        }
      );

      setSuccess(res.data.message);

      setTimeout(() => {
        router.push(
          `/auth/verify-otp?email=${encodeURIComponent(email)}`
        );
      }, 1000);

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
  <div className="relative overflow-hidden min-h-screen bg-gradient-to-br from-slate-100 via-blue-100 to-indigo-100 flex items-center justify-center p-6">

    {/* Background Blur */}

    <div className="absolute left-[-120px] top-[-120px] h-96 w-96 rounded-full bg-blue-400/20 blur-3xl"></div>

    <div className="absolute right-[-120px] bottom-[-120px] h-96 w-96 rounded-full bg-indigo-400/20 blur-3xl"></div>

    {/* Card */}

    <div className="relative w-full max-w-md rounded-3xl bg-white shadow-[0_25px_70px_rgba(0,0,0,0.18)] p-10">

      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700"
      >
        <ArrowLeft size={18} />
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
        Forgot Password
      </h1>

      <p className="mt-3 text-center text-gray-500">

        Enter your registered email address.
        We'll send you a One-Time Password (OTP).

      </p>

      {/* Success */}

      {success && (

        <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-4">

          <p className="text-sm text-green-700">
            {success}
          </p>

        </div>

      )}

      {/* Error */}

      {error && (

        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4">

          <p className="text-sm text-red-700">
            {error}
          </p>

        </div>

      )}

      {/* Email */}

      <div className="mt-8">

        <label className="mb-2 block text-sm font-medium text-gray-700">
          Email Address
        </label>

        <div className="relative">

          <Mail
            size={20}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
          />

          <input
            type="email"
            placeholder="Enter your registered email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-gray-300 py-3 pl-12 pr-4 outline-none transition-all duration-300 hover:border-blue-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-100"
          />

        </div>

      </div>

      {/* Button */}

      <button
        onClick={sendOTP}
        disabled={loading}
        className="mt-8 flex h-14 w-full items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-indigo-700 text-white font-semibold shadow-lg transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl disabled:opacity-70"
      >

        {loading ? (
          <>
            <Loader2
              className="mr-2 animate-spin"
              size={20}
            />
            Sending OTP...
          </>
        ) : (
          "Send OTP"
        )}

      </button>

    </div>

  </div>
);
}