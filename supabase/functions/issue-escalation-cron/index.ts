/**
 * issue-escalation-cron Edge Function
 * Trigger: Scheduled — runs every 30 minutes via Supabase cron.
 * Evaluates sla_breach and unresolved_hours escalation rules
 * for all open issues and maintenance tickets.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const fcmServerKey = Deno.env.get("FCM_SERVER_KEY");

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function sendFcmToUser(userId: string, title: string, body: string, data: Record<string, string>) {
  try {
    await supabase.functions.invoke("send-fcm-notification", {
      body: { user_id: userId, title, body, data },
    });
  } catch (err) {
    console.error("FCM send failed:", err);
  }
}

async function sendEmailToVendor(vendorId: string, subject: string, body: string) {
  try {
    await supabase.functions.invoke("send-vendor-email", {
      body: { vendor_id: vendorId, subject, body },
    });
  } catch (err) {
    console.error("Vendor email send failed:", err);
  }
}

async function resolveNotifyTargets(rule: Record<string, unknown>, issue: Record<string, unknown>): Promise<void> {
  const title = `Issue Escalation: ${issue.title}`;
  const body = `Issue "${issue.title}" at location requires attention. Status: ${issue.status}, Priority: ${issue.priority}.`;

  if (rule.notify_vendor_id) {
    await sendEmailToVendor(rule.notify_vendor_id as string, title, body);
    return;
  }

  if (rule.notify_user_id) {
    await sendFcmToUser(rule.notify_user_id as string, title, body, {
      type: "issue_escalation",
      issue_id: issue.id as string,
    });
    return;
  }

  if (rule.notify_role) {
    // Notify all users at the issue's location with the matching role
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id")
      .eq("organisation_id", issue.organisation_id as string)
      .eq("location_id", issue.location_id as string)
      .eq("role", rule.notify_role as string)
      .eq("is_deleted", false);

    for (const p of profiles ?? []) {
      await sendFcmToUser(p.id, title, body, {
        type: "issue_escalation",
        issue_id: issue.id as string,
      });
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const now = new Date();
  let processed = 0;
  let escalated = 0;

  // ── Fetch open issues ────────────────────────────────────────────────────
  const { data: openIssues, error: issuesErr } = await supabase
    .from("issues")
    .select("id, title, status, priority, organisation_id, location_id, category_id, created_at, due_at")
    .in("status", ["open", "in_progress", "pending_vendor"])
    .eq("is_deleted", false);

  if (issuesErr) {
    console.error("Error fetching issues:", issuesErr);
    return new Response(JSON.stringify({ error: issuesErr.message }), { status: 500 });
  }

  for (const issue of openIssues ?? []) {
    if (!issue.category_id) continue;

    const { data: rules } = await supabase
      .from("escalation_rules")
      .select("*")
      .eq("category_id", issue.category_id)
      .eq("organisation_id", issue.organisation_id)
      .in("trigger_type", ["sla_breach", "unresolved_hours"])
      .eq("is_deleted", false)
      .order("escalation_order", { ascending: true });

    for (const rule of rules ?? []) {
      processed++;

      if (rule.trigger_type === "sla_breach") {
        // Fetch category SLA hours
        const { data: category } = await supabase
          .from("issue_categories")
          .select("sla_hours")
          .eq("id", issue.category_id)
          .single();

        if (!category) continue;
        const slaHours = category.sla_hours ?? 24;
        const createdAt = new Date(issue.created_at);
        const breachAt = new Date(createdAt.getTime() + slaHours * 60 * 60 * 1000);

        if (now > breachAt) {
          await resolveNotifyTargets(rule, issue);
          escalated++;
        }
      } else if (rule.trigger_type === "unresolved_hours" && rule.trigger_value) {
        const createdAt = new Date(issue.created_at);
        const hoursElapsed = (now.getTime() - createdAt.getTime()) / (60 * 60 * 1000);

        if (hoursElapsed >= rule.trigger_value) {
          await resolveNotifyTargets(rule, issue);
          escalated++;
        }
      }
    }
  }

  const summary = {
    issues_evaluated: openIssues?.length ?? 0,
    rules_processed: processed,
    escalations_triggered: escalated,
    ran_at: now.toISOString(),
  };

  console.log("issue-escalation-cron summary:", summary);
  return new Response(JSON.stringify(summary), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
