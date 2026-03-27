"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, History, ChevronLeft, ChevronRight } from "lucide-react";
import { getAuditTrail, type AuditTrailEvent } from "@/services/settings";

// ── Entity type config ────────────────────────────────────────────────────────

const ENTITY_CONFIG: Record<
  string,
  { label: string; borderColor: string; emoji: string; filterKey: string }
> = {
  task:     { label: "Task",     borderColor: "border-l-blue-500",   emoji: "📋", filterKey: "task"     },
  issue:    { label: "Issue",    borderColor: "border-l-orange-500", emoji: "⚠️",  filterKey: "issue"    },
  form:     { label: "Form",     borderColor: "border-l-green-500",  emoji: "📝", filterKey: "form"     },
  workflow: { label: "Workflow", borderColor: "border-l-purple-500", emoji: "⚡", filterKey: "workflow" },
  incident: { label: "Incident", borderColor: "border-l-red-500",    emoji: "🚨", filterKey: "incident" },
};

const FILTERS = [
  { key: "",         label: "All"       },
  { key: "task",     label: "Tasks"     },
  { key: "issue",    label: "Issues"    },
  { key: "form",     label: "Forms"     },
  { key: "workflow", label: "Workflows" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTimestamp(ts: string): string {
  if (!ts) return "—";
  try {
    return new Intl.DateTimeFormat("en-PH", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(ts));
  } catch {
    return ts;
  }
}

function entityLink(event: AuditTrailEvent): string | null {
  switch (event.entity_type) {
    case "task":     return `/dashboard/tasks/${event.entity_id}`;
    case "issue":    return `/dashboard/issues/${event.entity_id}`;
    case "form":     return `/dashboard/forms/${event.entity_id}`;
    case "workflow": return `/dashboard/workflows/${event.entity_id}`;
    default:         return null;
  }
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-t border-surface-border animate-pulse">
      <td className="px-4 py-3">
        <div className="h-3.5 w-28 bg-gray-200 rounded" />
      </td>
      <td className="px-4 py-3">
        <div className="h-3.5 w-48 bg-gray-200 rounded mb-1.5" />
        <div className="h-3 w-32 bg-gray-100 rounded" />
      </td>
      <td className="px-4 py-3">
        <div className="h-3.5 w-36 bg-gray-200 rounded" />
      </td>
      <td className="px-4 py-3">
        <div className="h-3.5 w-24 bg-gray-200 rounded" />
      </td>
    </tr>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AuditTrailPage() {
  const [events, setEvents] = useState<AuditTrailEvent[]>([]);
  const [total, setTotal]   = useState(0);
  const [page, setPage]     = useState(1);
  const pageSize             = 50;
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getAuditTrail({ page, entity_type: filter || undefined })
      .then((res) => {
        if (!cancelled) {
          setEvents(res.data);
          setTotal(res.total);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load audit trail. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [page, filter]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function handleFilterChange(key: string) {
    setFilter(key);
    setPage(1);
  }

  return (
    <div className="min-h-full bg-[#F0F2F5] -m-4 md:-m-8 -mt-[4.5rem] md:-mt-8 p-4 md:p-6 pt-[4.5rem] md:pt-8 pb-24 md:pb-8">
      <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/settings"
            className="p-1.5 rounded-lg hover:bg-white/60 text-dark/50 hover:text-dark transition-colors shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="w-10 h-10 rounded-xl bg-sprout-purple/10 flex items-center justify-center shrink-0">
            <History className="w-5 h-5 text-sprout-purple" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-dark">Audit Trail</h1>
            <p className="text-sm text-dark-secondary">
              Complete log of user actions and system events
            </p>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex gap-2 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => handleFilterChange(f.key)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                filter === f.key
                  ? "bg-sprout-purple text-white"
                  : "bg-white text-dark/70 border border-surface-border hover:bg-gray-50"
              }`}
            >
              {f.label}
            </button>
          ))}
          {total > 0 && !loading && (
            <span className="ml-auto text-xs text-dark/40 self-center">
              {total.toLocaleString()} event{total !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Table card */}
        <div className="bg-white rounded-2xl border border-surface-border overflow-hidden">
          {error ? (
            <div className="px-6 py-12 text-center text-sm text-red-500">{error}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-surface-border">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-dark/50 whitespace-nowrap w-40">
                      Timestamp
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-dark/50">
                      Event
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-dark/50 whitespace-nowrap w-48">
                      Entity
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-dark/50 whitespace-nowrap w-36">
                      Actor
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
                  ) : events.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-16 text-center text-sm text-dark/40">
                        <div className="flex flex-col items-center gap-2">
                          <History className="w-8 h-8 text-dark/20" />
                          <span>No audit events found{filter ? ` for "${filter}"` : ""}.</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    events.map((event) => {
                      const config = ENTITY_CONFIG[event.entity_type] ?? {
                        label: event.entity_type,
                        borderColor: "border-l-gray-300",
                        emoji: "•",
                        filterKey: event.entity_type,
                      };
                      const link = entityLink(event);

                      return (
                        <tr
                          key={event.id}
                          className={`border-t border-surface-border/60 hover:bg-gray-50/40 transition-colors border-l-4 ${config.borderColor}`}
                        >
                          {/* Timestamp */}
                          <td className="px-4 py-3 text-xs text-dark/50 whitespace-nowrap">
                            {formatTimestamp(event.timestamp)}
                          </td>

                          {/* Event */}
                          <td className="px-4 py-3">
                            <div className="text-xs font-medium text-dark">
                              {config.emoji}{" "}
                              {event.description}
                            </div>
                            <div className="text-[11px] text-dark/40 mt-0.5 capitalize">
                              {event.event_type.replace(/_/g, " ")}
                            </div>
                          </td>

                          {/* Entity */}
                          <td className="px-4 py-3">
                            {link ? (
                              <Link
                                href={link}
                                className="text-xs text-sprout-purple hover:underline font-medium line-clamp-2"
                              >
                                {event.entity_title}
                              </Link>
                            ) : (
                              <span className="text-xs text-dark/70 line-clamp-2">
                                {event.entity_title}
                              </span>
                            )}
                            <div className="text-[11px] text-dark/40 mt-0.5 capitalize">
                              {config.label}
                            </div>
                          </td>

                          {/* Actor */}
                          <td className="px-4 py-3">
                            <span className="text-xs text-dark/80">
                              {event.actor_name}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {!loading && !error && total > pageSize && (
            <div className="px-4 py-3 border-t border-surface-border bg-gray-50/50 flex items-center justify-between gap-3">
              <span className="text-xs text-dark/40">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-surface-border bg-white text-dark/70 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-surface-border bg-white text-dark/70 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
