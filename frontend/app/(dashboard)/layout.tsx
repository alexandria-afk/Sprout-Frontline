import { redirect } from "next/navigation";
import { createClient } from "@/services/supabase/server";
import { Sidebar } from "@/components/layout/Sidebar";
import { SidekickChat } from "@/components/shared/SidekickChat";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const role = (user.app_metadata?.role as string) ?? "staff";

  return (
    <div className="flex min-h-screen">
      <Sidebar role={role} userId={user.id} />
      <main className="flex-1 bg-surface-page overflow-auto min-w-0">
        {/* pt-16 / pb-24 on mobile = top header + bottom tab bar clearance */}
        <div className="p-4 md:p-8 pt-[4.5rem] md:pt-8 pb-24 md:pb-8">
          {children}
        </div>
      </main>
      <SidekickChat />
    </div>
  );
}
