"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, ClipboardList, Megaphone, LogOut, GitBranch,
  BarChart2, AlertTriangle, Settings, Trophy, GraduationCap,
  CalendarClock, CheckSquare, Bell, Languages,
} from "lucide-react";
import { clsx } from "clsx";
import { createClient } from "@/services/supabase/client";
import { getDashboardSummary } from "@/services/dashboard";
import { getUnreadCount } from "@/services/notifications";
import { useTranslation } from "@/lib/i18n";
import { updateUser } from "@/services/users";

// ── Nav items — ordered per spec, role-gated per architecture.md ──────────────
// labelKey maps to keys in messages/en.json and messages/th.json
const NAV_ITEMS = [
  { href: "/dashboard",                          labelKey: "nav.dashboard",    icon: LayoutDashboard, roles: ["super_admin","admin","manager","staff"] },
  { href: "/dashboard/insights",                 labelKey: "nav.insights",     icon: BarChart2,       roles: ["super_admin","admin","manager"] },
  { href: "/dashboard/issues?tab=tasks",         labelKey: "nav.tasks",        icon: CheckSquare,     roles: ["super_admin","admin","manager","staff"] },
  { href: "/dashboard/issues?tab=issues",        labelKey: "nav.issues",       icon: AlertTriangle,   roles: ["super_admin","admin","manager","staff"] },
  { href: "/dashboard/forms?tab=my_assignments", labelKey: "nav.forms",        icon: ClipboardList,   roles: ["super_admin","admin","manager","staff"] },
  { href: "/dashboard/shifts",                   labelKey: "nav.shifts",       icon: CalendarClock,   roles: ["super_admin","admin","manager","staff"] },
  { href: "/dashboard/workflows",                labelKey: "nav.workflows",    icon: GitBranch,       roles: ["super_admin","admin","manager"] },
  { href: "/dashboard/announcements",            labelKey: "nav.announcements",icon: Megaphone,       roles: ["super_admin","admin","manager","staff"] },
  { href: "/dashboard/training",                 labelKey: "nav.training",     icon: GraduationCap,   roles: ["super_admin","admin","manager","staff"] },
  { href: "/dashboard/safety",                   labelKey: "nav.leaderboard",  icon: Trophy,          roles: ["super_admin","admin","manager","staff"] },
  { href: "/dashboard/settings",                 labelKey: "nav.settings",     icon: Settings,        roles: ["super_admin","admin"] },
];

const Logo = ({ size = "md" }: { size?: "sm" | "md" }) => (
  <div className={clsx("flex items-center", size === "sm" ? "gap-2" : "gap-3")}>
    <div className={clsx("flex items-center justify-center rounded-xl bg-sprout-green/20", size === "sm" ? "w-7 h-7" : "w-9 h-9")}>
      <svg viewBox="0 0 24 24" className={clsx("text-sprout-green fill-current", size === "sm" ? "w-4 h-4" : "w-5 h-5")}>
        <path d="M17 8C8 10 5.9 16.17 3.82 21 5.8 15 8 10.88 17 8z" />
        <path d="M21.71 8.29l-3-3a1 1 0 0 0-1.42 0C15.91 6.67 15 9.12 15 12c0 1.71.33 3.33.94 4.79L13.5 18.2A7.09 7.09 0 0 0 8 13.07c0 4.27 3.23 7.77 7.39 8A9 9 0 0 0 21.71 8.29z" />
      </svg>
    </div>
    {size === "md" ? (
      <div>
        <div className="font-bold text-sm leading-tight">Frontliner</div>
        <div className="text-white/50 text-xs">by Sprout</div>
      </div>
    ) : (
      <span className="font-bold text-sm text-white">Frontliner</span>
    )}
  </div>
);

const MANAGER_ROLES = ["super_admin", "admin", "manager"];

export function Sidebar({ role = "staff", userId }: { role?: string; userId?: string }) {
  const pathname     = usePathname();
  const searchParams = useSearchParams();
  const router       = useRouter();
  const { t, locale, setLocale } = useTranslation();

  const visibleItems = NAV_ITEMS.filter((item) => item.roles.includes(role));

  async function handleToggleLanguage() {
    const next = locale === "en" ? "th" : "en";
    setLocale(next);
    if (userId) {
      try { await updateUser(userId, { language: next }); } catch {}
    }
  }

  const [pendingCount,      setPendingCount]      = useState(0);
  const [unreadNotifCount,  setUnreadNotifCount]  = useState(0);

  useEffect(() => {
    if (!MANAGER_ROLES.includes(role)) return;
    const fetch = () =>
      getDashboardSummary().then((s) => setPendingCount(s.pending_count ?? 0)).catch(() => {});
    fetch();
    const interval = setInterval(fetch, 30_000);
    return () => clearInterval(interval);
  }, [role]);

  useEffect(() => {
    const fetchCount = () =>
      getUnreadCount().then((r) => setUnreadNotifCount(r.count)).catch(() => {});
    fetchCount();
    const interval = setInterval(fetchCount, 60_000);
    return () => clearInterval(interval);
  }, []);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const hrefPath = (href: string) => href.split("?")[0];

  // ── Active-state logic ───────────────────────────────────────────────────────
  // Items that share a base path but differ by ?tab (Tasks vs Issues & Incidents)
  // are disambiguated by reading the current URL's tab param.
  const isActive = (href: string) => {
    const [path, query] = href.split("?");

    // Dashboard: exact match only
    if (path === "/dashboard") return pathname === path;

    // Not on this section at all
    if (!pathname.startsWith(path)) return false;

    // No query constraint — any sub-path matches
    if (!query) return true;

    const hrefTab    = new URLSearchParams(query).get("tab");
    const currentTab = searchParams.get("tab");

    if (!hrefTab) return true;

    // /dashboard/issues is shared by Tasks (?tab=tasks) and Issues & Incidents (?tab=issues).
    // The page defaults to "tasks" when no tab param is present.
    if (path === "/dashboard/issues") {
      const effective = currentTab ?? "tasks";
      if (hrefTab === "tasks")  return effective === "tasks";
      if (hrefTab === "issues") return effective === "issues" || effective === "incidents";
    }

    return currentTab === hrefTab;
  };

  return (
    <>
      {/* ── Desktop sidebar (md+) ────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-64 min-h-screen bg-sprout-navy text-white shrink-0">
        <div className="px-6 py-5 border-b border-white/10">
          <Logo size="md" />
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {visibleItems.map(({ href, labelKey, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                isActive(href)
                  ? "bg-sprout-green text-white"
                  : "text-white/70 hover:bg-white/10 hover:text-white",
              )}
            >
              <Icon size={18} />
              <span className="flex-1">{t(labelKey)}</span>

              {/* Unread inbox badge on Dashboard */}
              {hrefPath(href) === "/dashboard" && unreadNotifCount > 0 && (
                <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-sprout-purple text-white text-[10px] font-bold flex items-center justify-center">
                  {unreadNotifCount > 99 ? "99+" : unreadNotifCount}
                </span>
              )}

              {/* Pending forms badge */}
              {hrefPath(href) === "/dashboard/forms" && pendingCount > 0 && (
                <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {pendingCount > 99 ? "99+" : pendingCount}
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="px-3 py-4 border-t border-white/10 space-y-1">
          {/* Language toggle */}
          <button
            onClick={handleToggleLanguage}
            title={t("language.label")}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white transition-colors"
          >
            <Languages size={18} />
            <span className="flex-1 text-left">
              {locale === "en" ? "ไทย" : "English"}
            </span>
          </button>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white transition-colors"
          >
            <LogOut size={18} />
            {t("button.signOut")}
          </button>
        </div>
      </aside>

      {/* ── Mobile top header ────────────────────────────────── */}
      <header className="md:hidden fixed top-0 inset-x-0 z-40 h-14 bg-sprout-navy flex items-center justify-between px-4 border-b border-white/10">
        <Logo size="sm" />
        <div className="flex items-center gap-2">
          <button
            onClick={handleToggleLanguage}
            className="flex items-center gap-1 text-white/60 hover:text-white transition-colors text-xs font-medium"
          >
            <Languages size={14} />
            {locale === "en" ? "ไทย" : "EN"}
          </button>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 text-white/60 hover:text-white transition-colors text-xs font-medium"
          >
            <LogOut size={15} />
            {t("button.signOut")}
          </button>
        </div>
      </header>

      {/* ── Mobile bottom tab bar ────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-sprout-navy border-t border-white/10 safe-area-bottom">
        <div className="flex overflow-x-auto scrollbar-none">
          {visibleItems.map(({ href, labelKey, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex-shrink-0 flex flex-col items-center justify-center gap-0.5 px-3 py-2.5 transition-colors relative",
                isActive(href) ? "text-sprout-green" : "text-white/40",
              )}
            >
              <div className="relative">
                <Icon size={22} />
                {hrefPath(href) === "/dashboard" && unreadNotifCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-sprout-purple text-white text-[8px] font-bold flex items-center justify-center">
                    {unreadNotifCount > 9 ? "9+" : unreadNotifCount}
                  </span>
                )}
                {hrefPath(href) === "/dashboard/forms" && pendingCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center">
                    {pendingCount > 9 ? "9+" : pendingCount}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium leading-none whitespace-nowrap">{t(labelKey)}</span>
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
