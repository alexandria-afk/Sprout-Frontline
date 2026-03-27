import { apiFetch } from "@/services/api/client";

export interface LeaderboardConfig {
  id: string;
  name: string;
  description?: string;
  metric_type: string;
  scope: "location" | "organisation";
  time_window: "weekly" | "monthly" | "quarterly" | "all_time";
  is_active: boolean;
  is_template: boolean;
}

export interface LeaderboardEntry {
  user_id: string;
  full_name?: string;
  role?: string;
  score: number;
  rank: number;
  badges?: { icon?: string; name: string }[];
}

export interface BadgeConfig {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  points_awarded: number;
  criteria_type: string;
  criteria_value?: number;
  criteria_window: string;
  is_template: boolean;
  is_active: boolean;
}

export interface BadgeAward {
  id: string;
  badge_id: string;
  user_id: string;
  awarded_at: string;
  awarded_by?: string;
  badge_configs?: BadgeConfig;
}

export interface UserPoints {
  user_id: string;
  total_points: number;
  issues_reported: number;
  issues_resolved: number;
  checklists_completed: number;
  tasks_completed: number;
  checklist_current_streak: number;
}

export async function listLeaderboards(): Promise<LeaderboardConfig[]> {
  const res = await apiFetch<LeaderboardConfig[] | { data: LeaderboardConfig[] }>("/api/v1/gamification/leaderboards");
  return (res as { data: LeaderboardConfig[] }).data ?? (res as LeaderboardConfig[]) ?? [];
}

export async function getLeaderboard(id: string): Promise<{ config: LeaderboardConfig; entries: LeaderboardEntry[] }> {
  return apiFetch(`/api/v1/gamification/leaderboards/${id}`);
}

export async function listBadgeConfigs(): Promise<BadgeConfig[]> {
  const res = await apiFetch<BadgeConfig[] | { data: BadgeConfig[] }>("/api/v1/gamification/badges");
  return (res as { data: BadgeConfig[] }).data ?? (res as BadgeConfig[]) ?? [];
}

export async function listMyBadges(): Promise<BadgeAward[]> {
  const res = await apiFetch<BadgeAward[] | { data: BadgeAward[] }>("/api/v1/gamification/badges/my");
  return (res as { data: BadgeAward[] }).data ?? (res as BadgeAward[]) ?? [];
}

export async function createBadgeConfig(body: Partial<BadgeConfig>): Promise<BadgeConfig> {
  return apiFetch("/api/v1/gamification/badges", { method: "POST", body: JSON.stringify(body) });
}

export async function updateBadgeConfig(id: string, body: Partial<BadgeConfig>): Promise<BadgeConfig> {
  return apiFetch(`/api/v1/gamification/badges/${id}`, { method: "PUT", body: JSON.stringify(body) });
}

export async function deleteBadgeConfig(id: string): Promise<void> {
  return apiFetch(`/api/v1/gamification/badges/${id}`, { method: "DELETE" });
}

export async function awardBadge(badgeId: string, userId: string): Promise<BadgeAward> {
  return apiFetch(`/api/v1/gamification/badges/${badgeId}/award`, { method: "POST", body: JSON.stringify({ user_id: userId }) });
}

export async function getMyPoints(): Promise<UserPoints | null> {
  return apiFetch("/api/v1/gamification/points/my");
}

export async function getOrgLeaderboard(): Promise<LeaderboardEntry[]> {
  const res = await apiFetch<{ entries: LeaderboardEntry[] }>("/api/v1/gamification/points/org");
  return res.entries ?? [];
}

export async function listBadgeTemplates(): Promise<BadgeConfig[]> {
  const res = await apiFetch<BadgeConfig[] | { data: BadgeConfig[] }>("/api/v1/gamification/templates/badges");
  return (res as { data: BadgeConfig[] }).data ?? (res as BadgeConfig[]) ?? [];
}

export async function seedTemplates(): Promise<void> {
  return apiFetch("/api/v1/gamification/templates/seed", { method: "POST" });
}
