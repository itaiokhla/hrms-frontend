'use client';

import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function BackButton() {
  const router = useRouter();

  return (
    <button
      onClick={() => router.back()}
      className="mb-6 flex items-center gap-2 rounded-xl bg-white px-4 py-2 shadow-md hover:bg-gray-100 transition"
    >
      <ArrowLeft size={18} />
      Back
    </button>
  );
}