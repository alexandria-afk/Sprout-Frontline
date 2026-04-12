import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getServerUser } from "@/services/server-auth";
import { Sidebar } from "@/components/layout/Sidebar";
import { SidekickChat } from "@/components/shared/SidekickChat";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getServerUser();

  if (!user) {
    redirect("/login");
  }

  const role = user.role ?? "staff";

  return (
    <div className="flex min-h-screen">
      {/* Suspense required: Sidebar uses useSearchParams() */}
      <Suspense fallback={null}>
        <Sidebar role={role} userId={user.id} />
      </Suspense>
      <main className="flex-1 bg-surface-page overflow-auto min-w-0">
        {/* pt-16 / pb-24 on mobile = top header + bottom tab bar clearance */}
        <div className="p-4 md:p-8 pt-[4.5rem] md:pt-8 pb-24 md:pb-8">
          {children}
        </div>
      </main>
      <Suspense fallback={null}>
        <SidekickChat />
      </Suspense>
    </div>
  );
}
