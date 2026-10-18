"use client";

import { Loader2 } from "lucide-react";

interface PageLoaderProps {
  text?: string;
}

export default function PageLoader({
  text = "Please wait...",
}: PageLoaderProps) {
  return (
    <div className="flex min-h-[300px] flex-col items-center justify-center">
      <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
      <p className="mt-4 text-sm text-gray-500">{text}</p>
    </div>
  );
}