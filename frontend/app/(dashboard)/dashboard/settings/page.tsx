"use client";

import Link from "next/link";
import { Settings, Users, Building2, ChevronRight, Wrench, BookOpen, Tag, Award, ShieldCheck, History, MapPin, Sparkles, CalendarClock, Sliders } from "lucide-react";

const SETTINGS_ITEMS = [
  {
    href: "/dashboard/users",
    icon: Users,
    label: "User Management",
    description: "Invite and manage staff, managers, and admins. Assign locations and roles.",
    roles: "Admin",
  },
  {
    href: "/dashboard/settings/locations",
    icon: MapPin,
    label: "Locations",
    description: "Add, edit, and remove branch locations. Locations are used to organise users, assets, and assignments.",
    roles: "Admin",
  },
  {
    href: "/dashboard/vendors",
    icon: Building2,
    label: "Vendors",
    description: "Manage external vendors and their access to issue categories.",
    roles: "Admin",
  },
  {
    href: "/dashboard/maintenance/assets",
    icon: Wrench,
    label: "Assets",
    description: "Manage equipment, machinery, and other trackable assets.",
    roles: "Admin",
  },
  {
    href: "/dashboard/maintenance/guides",
    icon: BookOpen,
    label: "Repair Guides",
    description: "Upload and manage troubleshooting guides for assets and issue categories.",
    roles: "Admin",
  },
  {
    href: "/dashboard/issues/categories",
    icon: Tag,
    label: "Issue Categories",
    description: "Configure issue categories, SLA hours, custom fields, and escalation rules.",
    roles: "Admin",
  },
  {
    href: "/dashboard/settings/badges",
    icon: Award,
    label: "Leaderboards & Badges",
    description: "Configure leaderboards and manage achievement badges. Set up which metrics appear on the leaderboard and create badges staff earn automatically when criteria are met.",
    roles: "Admin",
  },
  {
    href: "/dashboard/settings/roles",
    icon: ShieldCheck,
    label: "Roles & Access",
    description: "View the current access matrix showing what each role can see and do across the platform.",
    roles: "Admin",
  },
  {
    href: "/dashboard/settings/shift-settings",
    icon: CalendarClock,
    label: "Shift Settings",
    description: "Configure attendance rules — late thresholds, overtime limits, and break durations for your organisation.",
    roles: "Admin",
  },
  {
    href: "/dashboard/settings/feature-settings",
    icon: Sliders,
    label: "Feature Settings",
    description: "Enable or disable optional platform features like staff availability tracking and AI schedule generation.",
    roles: "Admin",
  },
  {
    href: "/dashboard/settings/audit-trail",
    icon: History,
    label: "Audit Trail",
    description: "View a complete log of user actions and system events across the platform.",
    roles: "Admin",
  },
  {
    href: "/onboarding",
    icon: Sparkles,
    label: "Onboarding Setup",
    description: "Re-run the AI-powered workspace setup wizard to add templates, employees, or reconfigure your workspace.",
    roles: "Admin",
  },
];

export default function SettingsPage() {
  return (
    <div className="min-h-full bg-[#F0F2F5] -m-4 md:-m-8 -mt-[4.5rem] md:-mt-8 p-4 md:p-6 pt-[4.5rem] md:pt-8 pb-24 md:pb-8">
      <div className="flex flex-col gap-4 md:gap-6 max-w-2xl mx-auto w-full">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sprout-purple/10 flex items-center justify-center">
            <Settings className="w-5 h-5 text-sprout-purple" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-dark">Settings</h1>
            <p className="text-sm text-dark-secondary">Manage your organisation configuration</p>
          </div>
        </div>

        {/* Settings items */}
        <div className="flex flex-col gap-3">
          {SETTINGS_ITEMS.map(({ href, icon: Icon, label, description, roles }) => (
            <Link
              key={href}
              href={href}
              className="bg-white rounded-2xl border border-surface-border p-5 flex items-center gap-4 hover:shadow-sm transition-shadow group"
            >
              <div className="w-12 h-12 rounded-xl bg-sprout-purple/10 flex items-center justify-center shrink-0">
                <Icon className="w-6 h-6 text-sprout-purple" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-dark">{label}</div>
                <div className="text-sm text-dark-secondary mt-0.5">{description}</div>
                <div className="text-xs text-dark-secondary/70 mt-1">{roles} only</div>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-sprout-purple transition-colors shrink-0" />
            </Link>
          ))}
        </div>

      </div>
    </div>
  );
}
