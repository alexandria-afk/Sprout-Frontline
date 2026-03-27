"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Global Error]", error);
  }, [error]);

  return (
    <html>
      <body className="flex flex-col items-center justify-center min-h-screen gap-4 text-center px-4">
        <h2 className="text-xl font-semibold">Something went wrong</h2>
        <p className="text-sm text-gray-500 max-w-sm">
          An unexpected error occurred. Try again or refresh the page.
        </p>
        <button
          onClick={reset}
          className="bg-sprout-cyan text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
