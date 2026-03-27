/**
 * send-fcm-notification Edge Function
 * Called by backend services and other Edge Functions.
 * Accepts { user_id, title, body, data } — looks up fcm_token,
 * sends via FCM legacy HTTP API, logs to notification_log.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const fcmServerKey = Deno.env.get("FCM_SERVER_KEY");

interface FcmPayload {
  user_id: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let payload: FcmPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { user_id, title, body, data } = payload;
  if (!user_id || !title || !body) {
    return new Response(JSON.stringify({ error: "user_id, title, and body are required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Look up FCM token
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("fcm_token")
    .eq("id", user_id)
    .single();

  if (profileErr || !profile) {
    await supabase.from("notification_log").insert({
      user_id,
      title,
      body,
      data,
      success: false,
      error_message: "Profile not found",
    });
    return new Response(JSON.stringify({ success: false, error: "Profile not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const fcmToken = profile.fcm_token;

  if (!fcmToken || !fcmServerKey) {
    await supabase.from("notification_log").insert({
      user_id,
      title,
      body,
      data,
      success: false,
      error_message: fcmToken ? "FCM_SERVER_KEY not configured" : "No FCM token for user",
    });
    return new Response(JSON.stringify({ success: false, error: "No FCM token or key" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Send via FCM legacy HTTP API
  let success = false;
  let errorMessage: string | undefined;

  try {
    const fcmRes = await fetch("https://fcm.googleapis.com/fcm/send", {
      method: "POST",
      headers: {
        "Authorization": `key=${fcmServerKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: fcmToken,
        notification: { title, body, sound: "default" },
        data: data ?? {},
      }),
    });

    if (fcmRes.ok) {
      const fcmBody = await fcmRes.json();
      success = fcmBody.success === 1 || fcmBody.success > 0;
      if (!success) {
        errorMessage = JSON.stringify(fcmBody.results?.[0]);
      }
    } else {
      errorMessage = `FCM HTTP ${fcmRes.status}`;
    }
  } catch (err) {
    errorMessage = String(err);
  }

  await supabase.from("notification_log").insert({
    user_id,
    title,
    body,
    data,
    success,
    error_message: errorMessage ?? null,
  });

  return new Response(JSON.stringify({ success, error: errorMessage }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
