"use client";

import Link from "next/link";
import { ShieldCheck, ArrowLeft, Check, Minus } from "lucide-react";

type Cell = true | false;

interface MatrixRow {
  feature: string;
  staff: Cell;
  manager: Cell;
  admin: Cell;
  super_admin: Cell;
}

interface MatrixSection {
  section: string;
  rows: MatrixRow[];
}

const ACCESS_MATRIX: MatrixSection[] = [
  {
    section: "Navigation",
    rows: [
      { feature: "Dashboard",            staff: true,  manager: true,  admin: true,  super_admin: true  },
      { feature: "Forms & Submissions",  staff: true,  manager: true,  admin: true,  super_admin: true  },
      { feature: "Tasks & Issues",       staff: true,  manager: true,  admin: true,  super_admin: true  },
      { feature: "Announcements",        staff: true,  manager: true,  admin: true,  super_admin: true  },
      { feature: "Leaderboard",          staff: true,  manager: true,  admin: true,  super_admin: true  },
      { feature: "Reports",              staff: false, manager: true,  admin: true,  super_admin: true  },
      { feature: "Workflows",            staff: false, manager: true,  admin: true,  super_admin: true  },
      { feature: "Settings",             staff: false, manager: false, admin: true,  super_admin: true  },
    ],
  },
  {
    section: "Forms & Audits",
    rows: [
      { feature: "Fill assigned forms",          staff: true,  manager: true,  admin: true,  super_admin: true  },
      { feature: "View all submissions",         staff: false, manager: true,  admin: true,  super_admin: true  },
      { feature: "Create / edit form templates", staff: false, manager: false, admin: true,  super_admin: true  },
      { feature: "Review audit CAPs",            staff: false, manager: true,  admin: true,  super_admin: true  },
    ],
  },
  {
    section: "Tasks & Issues",
    rows: [
      { feature: "View & complete tasks",   staff: true,  manager: true,  admin: true,  super_admin: true  },
      { feature: "Create issues",           staff: true,  manager: true,  admin: true,  super_admin: true  },
      { feature: "View all team issues",    staff: false, manager: true,  admin: true,  super_admin: true  },
      { feature: "Escalate to incident",    staff: false, manager: true,  admin: true,  super_admin: true  },
      { feature: "View incident reports",   staff: false, manager: true,  admin: true,  super_admin: true  },
      { feature: "Manage issue categories", staff: false, manager: false, admin: true,  super_admin: true  },
    ],
  },
  {
    section: "Announcements",
    rows: [
      { feature: "View announcements",   staff: true,  manager: true,  admin: true,  super_admin: true  },
      { feature: "Create announcements", staff: false, manager: false, admin: true,  super_admin: true  },
    ],
  },
  {
    section: "Workflows",
    rows: [
      { feature: "View workflow definitions & instances", staff: false, manager: true,  admin: true,  super_admin: true  },
      { feature: "Trigger manual workflows",             staff: false, manager: true,  admin: true,  super_admin: true  },
      { feature: "Create & edit workflows",              staff: false, manager: false, admin: true,  super_admin: true  },
      { feature: "Publish & activate workflows",         staff: false, manager: false, admin: true,  super_admin: true  },
    ],
  },
  {
    section: "Administration",
    rows: [
      { feature: "Manage users & roles",           staff: false, manager: false, admin: true,  super_admin: true  },
      { feature: "Manage vendors",                 staff: false, manager: false, admin: true,  super_admin: true  },
      { feature: "Manage assets & repair guides",  staff: false, manager: false, admin: true,  super_admin: true  },
      { feature: "Configure badges & leaderboard", staff: false, manager: false, admin: true,  super_admin: true  },
    ],
  },
];

const ROLE_COLS: { key: keyof MatrixRow; label: string }[] = [
  { key: "staff",       label: "Staff"       },
  { key: "manager",     label: "Manager"     },
  { key: "admin",       label: "Admin"       },
  { key: "super_admin", label: "Super Admin" },
];

function CellIcon({ value }: { value: Cell }) {
  if (value)
    return <Check className="w-4 h-4 text-sprout-green mx-auto" />;
  return <Minus className="w-3.5 h-3.5 text-dark/20 mx-auto" />;
}

export default function RolesPage() {
  return (
    <div className="min-h-full bg-[#F0F2F5] -m-4 md:-m-8 -mt-[4.5rem] md:-mt-8 p-4 md:p-6 pt-[4.5rem] md:pt-8 pb-24 md:pb-8">
      <div className="flex flex-col gap-6 max-w-2xl mx-auto w-full">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/settings"
            className="p-1.5 rounded-lg hover:bg-white/60 text-dark/50 hover:text-dark transition-colors shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="w-10 h-10 rounded-xl bg-sprout-purple/10 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-sprout-purple" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-dark">Roles &amp; Access</h1>
            <p className="text-sm text-dark-secondary">Current access matrix for all platform roles</p>
          </div>
        </div>

        {/* Matrix card */}
        <div className="bg-white rounded-2xl border border-surface-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-surface-border">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-dark/50 w-1/2">
                    Feature / Action
                  </th>
                  {ROLE_COLS.map((col) => (
                    <th key={String(col.key)} className="text-center px-3 py-3 text-xs font-semibold text-dark/50 w-[12%]">
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ACCESS_MATRIX.map((section) => (
                  <>
                    <tr key={section.section} className="bg-gray-50/60 border-t border-surface-border">
                      <td colSpan={5} className="px-4 py-1.5">
                        <span className="text-[10px] font-bold text-dark/35 uppercase tracking-widest">
                          {section.section}
                        </span>
                      </td>
                    </tr>
                    {section.rows.map((row) => (
                      <tr key={row.feature} className="border-t border-surface-border/60 hover:bg-gray-50/40 transition-colors">
                        <td className="px-4 py-2.5 text-xs text-dark/70">{row.feature}</td>
                        {ROLE_COLS.map((col) => (
                          <td key={String(col.key)} className="px-3 py-2.5 text-center">
                            <CellIcon value={row[col.key] as Cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 border-t border-surface-border bg-gray-50/50">
            <p className="text-[11px] text-dark/40 leading-snug">
              ✦ This matrix reflects the current hardcoded role definitions. Full RBAC with custom permission overrides is on the roadmap.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
