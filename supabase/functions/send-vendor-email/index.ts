/**
 * send-vendor-email Edge Function
 * Called by escalation engine and PDF export endpoint.
 * Accepts { vendor_id, subject, body, pdf_attachment? (base64) }
 * Sends via Resend API. Logs to notification_log.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const resendApiKey = Deno.env.get("RESEND_API_KEY");
const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") ?? "noreply@renegade.app";

interface VendorEmailPayload {
  vendor_id: string;
  subject: string;
  body: string;
  pdf_attachment?: string; // base64-encoded PDF
  pdf_filename?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let payload: VendorEmailPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { vendor_id, subject, body, pdf_attachment, pdf_filename } = payload;
  if (!vendor_id || !subject || !body) {
    return new Response(JSON.stringify({ error: "vendor_id, subject, and body are required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Look up vendor contact email
  const { data: vendor, error: vendorErr } = await supabase
    .from("vendors")
    .select("id, name, contact_email")
    .eq("id", vendor_id)
    .eq("is_deleted", false)
    .single();

  if (vendorErr || !vendor || !vendor.contact_email) {
    await supabase.from("notification_log").insert({
      vendor_id,
      title: subject,
      body,
      success: false,
      error_message: "Vendor not found or has no contact email",
    });
    return new Response(JSON.stringify({ success: false, error: "Vendor email not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!resendApiKey) {
    await supabase.from("notification_log").insert({
      vendor_id,
      title: subject,
      body,
      success: false,
      error_message: "RESEND_API_KEY not configured",
    });
    return new Response(JSON.stringify({ success: false, error: "Email delivery not configured" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Build Resend request
  const emailBody: Record<string, unknown> = {
    from: fromEmail,
    to: [vendor.contact_email],
    subject,
    html: `<div style="font-family:sans-serif;line-height:1.5">${body.replace(/\n/g, "<br>")}</div>`,
  };

  if (pdf_attachment) {
    emailBody.attachments = [
      {
        filename: pdf_filename ?? "report.pdf",
        content: pdf_attachment,
      },
    ];
  }

  let success = false;
  let errorMessage: string | undefined;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailBody),
    });

    if (res.ok) {
      success = true;
    } else {
      const errBody = await res.json().catch(() => ({}));
      errorMessage = `Resend error ${res.status}: ${JSON.stringify(errBody)}`;
    }
  } catch (err) {
    errorMessage = String(err);
  }

  await supabase.from("notification_log").insert({
    vendor_id,
    title: subject,
    body,
    success,
    error_message: errorMessage ?? null,
  });

  return new Response(JSON.stringify({ success, error: errorMessage }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
