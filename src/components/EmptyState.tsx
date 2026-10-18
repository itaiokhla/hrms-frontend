"use client";

import { Inbox } from "lucide-react";

interface EmptyStateProps {
  title: string;
  description?: string;
}

export default function EmptyState({
  title,
  description,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <Inbox className="h-14 w-14 text-gray-300" />

      <h2 className="mt-4 text-lg font-semibold text-gray-700">
        {title}
      </h2>

      {description && (
        <p className="mt-2 text-sm text-gray-500">
          {description}
        </p>
      )}
    </div>
  );
}