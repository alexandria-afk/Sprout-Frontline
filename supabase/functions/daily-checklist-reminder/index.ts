// Daily Checklist Reminder — Edge Function (Deno)
// Runs on a schedule (configure in Supabase dashboard or via cron).
// Phase 1: Queries due assignments and logs counts.
// Phase 2: Will send FCM push notifications to assigned users.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Find assignments due today that are still active and not soft-deleted
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const { data: dueAssignments, error } = await supabase
      .from("form_assignments")
      .select("id, form_template_id, assigned_to_user_id, assigned_to_location_id")
      .eq("is_active", true)
      .eq("is_deleted", false)
      .gte("due_at", today.toISOString())
      .lt("due_at", tomorrow.toISOString());

    if (error) throw error;

    const count = dueAssignments?.length ?? 0;
    console.log(`[daily-checklist-reminder] Due assignments today: ${count}`);

    // TODO (Phase 2): For each assignment, look up the user's fcm_token
    // and send a push notification via FCM.

    return new Response(
      JSON.stringify({ success: true, assignments_due: count }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err) {
    console.error("[daily-checklist-reminder] Error:", err);
    return new Response(
      JSON.stringify({ success: false, message: String(err) }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
