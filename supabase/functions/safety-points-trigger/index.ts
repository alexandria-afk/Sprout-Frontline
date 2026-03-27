/**
 * safety-points-trigger Edge Function
 * Trigger: Database webhook on issues INSERT and UPDATE
 * On INSERT by staff → increment safety_points.issues_reported + check badges.
 * On UPDATE to resolved → increment safety_points.issues_resolved + check badges.
 * Sends FCM badge notification if badge auto-awarded.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function upsertPoints(
  userId: string,
  orgId: string,
  field: "issues_reported" | "issues_resolved",
): Promise<{ issues_reported: number; issues_resolved: number; total_points: number } | null> {
  // Get existing row or create
  const { data: existing } = await supabase
    .from("safety_points")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    const update: Record<string, unknown> = {
      [field]: (existing[field] ?? 0) + 1,
      updated_at: new Date().toISOString(),
    };
    const { data: updated } = await supabase
      .from("safety_points")
      .update(update)
      .eq("user_id", userId)
      .select()
      .single();
    return updated;
  } else {
    const insert = {
      user_id: userId,
      organisation_id: orgId,
      total_points: 0,
      issues_reported: field === "issues_reported" ? 1 : 0,
      issues_resolved: field === "issues_resolved" ? 1 : 0,
    };
    const { data: inserted } = await supabase
      .from("safety_points")
      .insert(insert)
      .select()
      .single();
    return inserted;
  }
}

async function checkAndAwardBadges(
  userId: string,
  orgId: string,
  points: { issues_reported: number; issues_resolved: number },
) {
  // Find un-awarded badges eligible for this user
  const { data: badges } = await supabase
    .from("safety_badges")
    .select("id, name, description, points, criteria_type, criteria_value")
    .eq("organisation_id", orgId)
    .in("criteria_type", ["issues_reported", "issues_resolved"])
    .eq("is_deleted", false);

  if (!badges?.length) return;

  // Get already awarded badge ids
  const { data: alreadyAwarded } = await supabase
    .from("user_badge_awards")
    .select("badge_id")
    .eq("user_id", userId)
    .eq("is_deleted", false);

  const awardedIds = new Set((alreadyAwarded ?? []).map((a) => a.badge_id));

  for (const badge of badges) {
    if (awardedIds.has(badge.id)) continue;

    const count =
      badge.criteria_type === "issues_reported"
        ? points.issues_reported
        : points.issues_resolved;

    if (badge.criteria_value && count >= badge.criteria_value) {
      // Award badge
      await supabase.from("user_badge_awards").insert({
        user_id: userId,
        badge_id: badge.id,
        awarded_by: null, // auto-awarded
      });

      // Add badge points
      if (badge.points > 0) {
        await supabase
          .from("safety_points")
          .update({ total_points: supabase.rpc("safety_points_add", { uid: userId, pts: badge.points }) })
          .eq("user_id", userId);
      }

      // Send FCM notification
      await supabase.functions.invoke("send-fcm-notification", {
        body: {
          user_id: userId,
          title: `Badge Earned: ${badge.name}`,
          body: badge.description ?? `You earned the ${badge.name} badge!`,
          data: { type: "badge_awarded", badge_id: badge.id },
        },
      });
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let webhookPayload: Record<string, unknown>;
  try {
    webhookPayload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const type = webhookPayload.type as string; // INSERT or UPDATE
  const record = webhookPayload.record as Record<string, unknown>;
  const oldRecord = webhookPayload.old_record as Record<string, unknown> | undefined;

  if (!record) {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const reporterId = record.reported_by as string;
  const orgId = record.organisation_id as string;
  const assigneeId = record.assigned_to as string | undefined;

  if (type === "INSERT" && reporterId) {
    const pts = await upsertPoints(reporterId, orgId, "issues_reported");
    if (pts) {
      await checkAndAwardBadges(reporterId, orgId, pts);
    }
  }

  if (
    type === "UPDATE" &&
    record.status === "resolved" &&
    oldRecord?.status !== "resolved" &&
    assigneeId
  ) {
    const pts = await upsertPoints(assigneeId, orgId, "issues_resolved");
    if (pts) {
      await checkAndAwardBadges(assigneeId, orgId, pts);
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
