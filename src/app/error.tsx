"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {

  return (
    <div className="min-h-screen flex items-center justify-center">

      <div className="text-center">

        <h1 className="text-5xl font-bold text-red-600">
          Something went wrong
        </h1>

        <p className="mt-3 text-gray-500">
          {error.message}
        </p>

        <button
          onClick={reset}
          className="mt-8 bg-blue-600 text-white px-6 py-3 rounded-xl"
        >
          Try Again
        </button>

      </div>

    </div>
  );
}