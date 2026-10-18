'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck, ArrowLeft } from 'lucide-react';

export default function VerifyOTPPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const email = searchParams.get("email") || "";

  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/auth/verify-otp`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email,
            otp,
          }),
        }
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Invalid OTP");
      }

      setSuccess("OTP verified successfully.");

      router.push(
        `/auth/reset-password?email=${encodeURIComponent(email)}`
      );

    } catch (err: any) {
      setError(err.message);
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-blue-100 to-indigo-100 flex items-center justify-center p-6">

      <div className="w-full max-w-md rounded-3xl bg-white p-10 shadow-2xl">

        <Link
          href="/auth/forgot-password"
          className="flex items-center gap-2 text-blue-600 mb-8"
        >
          <ArrowLeft size={18}/>
          Back
        </Link>

        <div className="flex justify-center mb-6">

          <div className="h-20 w-20 rounded-3xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center shadow-lg">

            <ShieldCheck
              size={40}
              className="text-white"
            />

          </div>

        </div>

        <h1 className="text-4xl font-bold text-center">
          Verify OTP
        </h1>

        <p className="text-center text-gray-500 mt-4 mb-8">
          Enter the OTP sent to
          <br />
          <span className="font-semibold text-gray-700">
            {email}
          </span>
        </p>

        {error && (

          <div className="mb-5 rounded-xl bg-red-50 border border-red-200 p-3 text-red-600">
            {error}
          </div>

        )}

        {success && (

          <div className="mb-5 rounded-xl bg-green-50 border border-green-200 p-3 text-green-700">
            {success}
          </div>

        )}

        <form
          onSubmit={handleVerify}
          className="space-y-6"
        >

          <input
            type="text"
            maxLength={6}
            value={otp}
            onChange={(e)=>setOtp(e.target.value)}
            placeholder="Enter 6 digit OTP"
            className="w-full rounded-xl border px-5 py-4 text-center text-2xl tracking-[10px]"
          />

          <button
            disabled={loading}
            className="w-full h-14 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-700 text-white font-semibold"
          >
            {loading ? "Verifying..." : "Verify OTP"}
          </button>

        </form>

      </div>

    </div>
  );
}