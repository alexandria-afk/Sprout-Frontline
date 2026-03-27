"use client";

import { useEffect } from "react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Dashboard Error]", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
      <h2 className="text-xl font-semibold text-dark">Something went wrong</h2>
      <p className="text-sm text-muted max-w-sm">
        An unexpected error occurred on this page. Try again or refresh.
      </p>
      <button
        onClick={reset}
        className="bg-sprout-purple text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition"
      >
        Try again
      </button>
    </div>
  );
}
