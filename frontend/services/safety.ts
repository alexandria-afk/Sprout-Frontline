/**
 * Safety service — leaderboard and points helpers.
 *
 * NOTE: Badge management (listing, awarding, my badges) has moved to the
 * gamification module. Use `@/services/gamification` for all badge operations.
 * The old safety_badges / user_safety_badges tables were dropped; badge data
 * now lives in badge_configs / user_badge_awards.
 */
import { apiFetch } from "@/services/api/client";
import type { SafetyPoints } from "@/types";

export function getSafetyLeaderboard(locationId?: string): Promise<{ data: SafetyPoints[]; total: number }> {
  const q = locationId ? `?location_id=${locationId}` : "";
  return apiFetch(`/api/v1/safety/leaderboard${q}`);
}

export function getMyPoints(): Promise<SafetyPoints> {
  return apiFetch("/api/v1/safety/points/my");
}
