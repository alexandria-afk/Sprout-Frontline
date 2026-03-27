/**
 * cap-reminder Edge Function
 * Trigger: Scheduled — runs daily at 8am via Supabase cron
 * Logic: Find all open/in_progress CAPs due within 24 hours → send FCM push to assigned_to
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const fcmServerKey = Deno.env.get("FCM_SERVER_KEY");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Find CAPs due within 24 hours that are still open or in_progress
  const { data: caps, error } = await supabase
    .from("corrective_actions")
    .select(`
      id, description, due_at, status,
      assigned_to,
      profiles!assigned_to(id, full_name, fcm_token),
      form_submissions(form_template_id, form_templates(title))
    `)
    .in("status", ["open", "in_progress"])
    .gte("due_at", now.toISOString())
    .lte("due_at", in24h.toISOString())
    .eq("is_deleted", false);

  if (error) {
    console.error("Error fetching CAPs:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  let notified = 0;
  let failed = 0;
  const results: string[] = [];

  for (const cap of caps ?? []) {
    const profile = cap.profiles as any;
    const fcmToken = profile?.fcm_token;
    const userName = profile?.full_name ?? "Team member";
    const templateTitle = (cap.form_submissions as any)?.form_templates?.title ?? "Audit";
    const dueAt = new Date(cap.due_at).toLocaleString();

    // Log to notification_log regardless of FCM
    await supabase.from("notification_log").insert({
      user_id: cap.assigned_to,
      type: "cap_reminder",
      title: "Corrective Action Due Soon",
      body: `${cap.description} — Due: ${dueAt}`,
      payload: { cap_id: cap.id, due_at: cap.due_at },
    }).catch(() => {});

    if (!fcmToken || !fcmServerKey) {
      results.push(`cap ${cap.id}: no FCM token or key — logged only`);
      continue;
    }

    // Send FCM push notification
    try {
      const fcmRes = await fetch("https://fcm.googleapis.com/fcm/send", {
        method: "POST",
        headers: {
          "Authorization": `key=${fcmServerKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: fcmToken,
          notification: {
            title: "⚠️ Corrective Action Due Soon",
            body: `${templateTitle}: ${cap.description}\nDue: ${dueAt}`,
            sound: "default",
          },
          data: {
            type: "cap_reminder",
            cap_id: cap.id,
            due_at: cap.due_at,
          },
        }),
      });

      if (fcmRes.ok) {
        notified++;
        results.push(`cap ${cap.id}: notified ${userName}`);
      } else {
        failed++;
        results.push(`cap ${cap.id}: FCM error ${fcmRes.status}`);
      }
    } catch (err) {
      failed++;
      results.push(`cap ${cap.id}: FCM send failed — ${err}`);
    }
  }

  const summary = {
    total_caps: caps?.length ?? 0,
    notified,
    failed,
    results,
  };

  console.log("cap-reminder summary:", summary);
  return new Response(JSON.stringify(summary), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
