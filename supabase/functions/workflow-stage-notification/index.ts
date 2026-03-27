/**
 * workflow-stage-notification Edge Function
 * Trigger: Database webhook on workflow_stage_instances UPDATE
 *          where status changes to 'in_progress'
 * Logic: Send FCM push to assigned_to user notifying them of a pending task.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const fcmServerKey = Deno.env.get("FCM_SERVER_KEY");

interface WebhookPayload {
  type: "UPDATE";
  table: string;
  record: {
    id: string;
    workflow_instance_id: string;
    stage_id: string;
    assigned_to: string | null;
    status: string;
    started_at: string | null;
  };
  old_record: {
    status: string;
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  // Only act when status transitions to in_progress
  if (
    payload.record?.status !== "in_progress" ||
    payload.old_record?.status === "in_progress"
  ) {
    return new Response(JSON.stringify({ skipped: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const stageInstanceId = payload.record.id;
  const assignedTo = payload.record.assigned_to;

  if (!assignedTo) {
    return new Response(JSON.stringify({ skipped: true, reason: "no assigned_to" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Fetch stage and instance details for the notification message
  const { data: stageInst } = await supabase
    .from("workflow_stage_instances")
    .select(`
      id,
      workflow_instances(
        id, submission_id,
        workflow_definitions(name),
        form_submissions(form_template_id, form_templates(title))
      ),
      workflow_stages(name, action_type)
    `)
    .eq("id", stageInstanceId)
    .single();

  const stage = stageInst?.workflow_stages as any;
  const instance = stageInst?.workflow_instances as any;
  const workflowName = instance?.workflow_definitions?.name ?? "Workflow";
  const templateTitle = instance?.form_submissions?.form_templates?.title ?? "Form";
  const stageName = stage?.name ?? "Task";
  const actionType = stage?.action_type ?? "review";

  // Fetch assigned user's FCM token
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, fcm_token")
    .eq("id", assignedTo)
    .single();

  const fcmToken = (profile as any)?.fcm_token;
  const userName = (profile as any)?.full_name ?? "User";

  // Log notification
  await supabase.from("notification_log").insert({
    user_id: assignedTo,
    type: "workflow_stage_assigned",
    title: `Workflow Task Assigned`,
    body: `${workflowName}: ${stageName} — ${templateTitle}`,
    payload: {
      workflow_instance_id: payload.record.workflow_instance_id,
      stage_instance_id: stageInstanceId,
      action_type: actionType,
    },
  }).catch(() => {});

  if (!fcmToken || !fcmServerKey) {
    return new Response(
      JSON.stringify({ success: true, notified: false, reason: "no FCM token or key" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Send FCM push
  const actionLabels: Record<string, string> = {
    review: "Please review and approve",
    approve: "Your approval is required",
    fill_form: "Please complete a form",
    sign: "Your signature is required",
  };
  const actionLabel = actionLabels[actionType] ?? "Action required";

  const fcmRes = await fetch("https://fcm.googleapis.com/fcm/send", {
    method: "POST",
    headers: {
      "Authorization": `key=${fcmServerKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: fcmToken,
      notification: {
        title: `📋 ${workflowName}: ${stageName}`,
        body: `${templateTitle} — ${actionLabel}`,
        sound: "default",
      },
      data: {
        type: "workflow_stage_assigned",
        workflow_instance_id: payload.record.workflow_instance_id,
        stage_instance_id: stageInstanceId,
        action_type: actionType,
      },
    }),
  });

  const notified = fcmRes.ok;
  console.log(`workflow-stage-notification: stage ${stageInstanceId} → ${userName} notified=${notified}`);

  return new Response(
    JSON.stringify({ success: true, notified, stage_instance_id: stageInstanceId }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
