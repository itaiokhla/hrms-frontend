export default function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-2xl bg-white p-6 shadow">
      <div className="h-4 w-24 rounded bg-gray-200"></div>

      <div className="mt-4 h-8 w-20 rounded bg-gray-300"></div>

      <div className="mt-6 h-3 w-full rounded bg-gray-200"></div>
    </div>
  );
}