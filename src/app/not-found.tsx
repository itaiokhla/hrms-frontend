import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center">
      <p className="font-display text-6xl font-semibold text-primary">404</p>
      <h1 className="text-xl font-semibold">This page doesn't exist</h1>
      <p className="max-w-sm text-sm text-muted-foreground">The link may be broken, or the page may have moved.</p>
      <Link href="/dashboard" className="mt-3 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
        Go to dashboard
      </Link>
    </div>
  );
}
