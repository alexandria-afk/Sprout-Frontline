/**
 * ticket-status-realtime Edge Function
 * Trigger: Database webhook on maintenance_tickets UPDATE
 * Broadcasts to Supabase Realtime channel tickets:{ticket_id} on status change.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

  const record = webhookPayload.record as Record<string, unknown> | undefined;
  const oldRecord = webhookPayload.old_record as Record<string, unknown> | undefined;

  if (!record || record.status === oldRecord?.status) {
    return new Response(JSON.stringify({ broadcast: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  await supabase.channel(`tickets:${record.id}`).send({
    type: "broadcast",
    event: "status_change",
    payload: {
      ticket_id: record.id,
      status: record.status,
      updated_at: record.updated_at,
    },
  });

  return new Response(JSON.stringify({ broadcast: true, ticket_id: record.id, status: record.status }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
