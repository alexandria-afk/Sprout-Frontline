"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { AlertTriangle, Wrench, Package, BookOpen } from "lucide-react";

const TABS = [
  { href: "/dashboard/issues",              label: "Issues",        icon: AlertTriangle },
  { href: "/dashboard/maintenance",         label: "Tickets",       icon: Wrench       },
  { href: "/dashboard/maintenance/assets",  label: "Assets",        icon: Package      },
  { href: "/dashboard/maintenance/guides",  label: "Repair Guides", icon: BookOpen     },
];

export function IssuesTabNav() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/dashboard/issues"
      ? pathname === href || pathname.startsWith("/dashboard/issues/") && !pathname.startsWith("/dashboard/issues/categories") && !pathname.startsWith("/dashboard/issues/dashboard")
      : pathname === href || pathname.startsWith(href + "/");

  return (
    <div className="flex gap-1 bg-white border border-surface-border rounded-xl p-1 w-fit flex-wrap">
      {TABS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={clsx(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
            isActive(href)
              ? "bg-sprout-cyan text-white"
              : "text-dark-secondary hover:bg-gray-100 hover:text-dark"
          )}
        >
          <Icon className="w-3.5 h-3.5" />
          {label}
        </Link>
      ))}
    </div>
  );
}
