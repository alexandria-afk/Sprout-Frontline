"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Trophy, Download } from "lucide-react";
import { clsx } from "clsx";
import { getOrgLeaderboard } from "@/services/gamification";
import type { LeaderboardEntry } from "@/services/gamification";

export default function SafetyLeaderboardReportPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getOrgLeaderboard()
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, []);

  function exportCsv() {
    if (!entries.length) return;
    const rows = entries.map((e) => [
      e.rank,
      `"${(e.full_name ?? "").replace(/"/g, '""')}"`,
      e.role ?? "",
      e.score,
      (e.badges ?? []).length,
    ]);
    const csv = [["Rank", "Name", "Role", "Score", "Badges"], ...rows]
      .map((r) => r.join(","))
      .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "safety-leaderboard.csv";
    a.click();
  }

  const topScore = entries[0]?.score ?? 0;
  const avgScore =
    entries.length
      ? Math.round(entries.reduce((s, e) => s + e.score, 0) / entries.length)
      : 0;

  function rankEmoji(rank: number) {
    if (rank === 1) return "🥇";
    if (rank === 2) return "🥈";
    if (rank === 3) return "🥉";
    return null;
  }

  // podium order: 2nd, 1st, 3rd
  const podium =
    entries.length >= 3 ? [entries[1], entries[0], entries[2]] : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => router.push("/dashboard/insights?tab=reports")}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-dark/50 hover:text-dark transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-yellow-50 flex items-center justify-center shrink-0">
            <Trophy className="w-5 h-5 text-yellow-500" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-dark">Safety Leaderboard</h1>
            <p className="text-xs text-dark/50">
              Team safety scores and earned badges
            </p>
          </div>
        </div>
        <button
          onClick={exportCsv}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-dark/60 hover:bg-gray-200 transition-colors"
        >
          <Download className="w-3.5 h-3.5" /> CSV
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-sprout-purple/30 border-t-sprout-purple rounded-full animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-dark/40">
          No leaderboard data available
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-dark">{entries.length}</p>
              <p className="text-sm text-dark/50 mt-0.5">Participants</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-yellow-500">{topScore}</p>
              <p className="text-sm text-dark/50 mt-0.5">Top Score</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-border p-5">
              <p className="text-2xl font-bold text-dark">{avgScore}</p>
              <p className="text-sm text-dark/50 mt-0.5">Avg Score</p>
            </div>
          </div>

          {/* Podium (top 3) */}
          {podium && (
            <div className="grid grid-cols-3 gap-4">
              {podium.map((entry, idx) => (
                <div
                  key={entry.user_id}
                  className={clsx(
                    "bg-white rounded-2xl border p-5 text-center flex flex-col items-center gap-2 transition-shadow",
                    idx === 1
                      ? "border-yellow-300 shadow-md"
                      : "border-surface-border"
                  )}
                >
                  <div className="text-3xl">
                    {idx === 1 ? "🥇" : idx === 0 ? "🥈" : "🥉"}
                  </div>
                  <p className="font-semibold text-dark text-sm leading-tight">
                    {entry.full_name ?? "—"}
                  </p>
                  <p className="text-xs text-dark/40 capitalize">
                    {entry.role ?? "Staff"}
                  </p>
                  <p
                    className={clsx(
                      "text-2xl font-bold",
                      idx === 1 ? "text-yellow-500" : "text-dark"
                    )}
                  >
                    {entry.score}
                  </p>
                  {(entry.badges?.length ?? 0) > 0 && (
                    <div className="flex gap-1 flex-wrap justify-center">
                      {entry.badges!.slice(0, 3).map((b, bi) => (
                        <span key={bi} title={b.name} className="text-lg">
                          {b.icon ?? "🏅"}
                        </span>
                      ))}
                      {entry.badges!.length > 3 && (
                        <span className="text-xs text-dark/40 self-center">
                          +{entry.badges!.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Full rankings table */}
          <div className="bg-white rounded-xl border border-surface-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-border bg-gray-50">
                    {["Rank", "Name", "Role", "Score", "Badges"].map((h) => (
                      <th
                        key={h}
                        className={clsx(
                          "px-4 py-3 text-xs font-semibold text-dark/50",
                          h === "Name" || h === "Role"
                            ? "text-left"
                            : "text-center"
                        )}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {entries.map((e) => (
                    <tr key={e.user_id} className="hover:bg-gray-50/50">
                      <td className="px-4 py-2.5 text-center">
                        <span className="font-semibold text-dark/70">
                          {rankEmoji(e.rank) ?? `#${e.rank}`}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-medium text-dark">
                        {e.full_name ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-dark/50 capitalize text-xs">
                        {e.role ?? "Staff"}
                      </td>
                      <td className="px-4 py-2.5 text-center font-bold text-amber-600">
                        {e.score}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {(e.badges ?? []).slice(0, 4).map((b, bi) => (
                            <span
                              key={bi}
                              title={b.name}
                              className="text-base"
                            >
                              {b.icon ?? "🏅"}
                            </span>
                          ))}
                          {(e.badges?.length ?? 0) > 4 && (
                            <span className="text-xs text-dark/40">
                              +{e.badges!.length - 4}
                            </span>
                          )}
                          {(e.badges?.length ?? 0) === 0 && (
                            <span className="text-xs text-dark/30">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
