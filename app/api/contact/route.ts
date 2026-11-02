import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { getOtpBotToken } from "@/lib/telegram-tokens";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function POST(req: NextRequest) {
  try {
    let name = "";
    let email = "";
    let message = "";
    let subject = "New Contact Us Message";

    // Support both FormData and JSON safely
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      name = String(formData.get("name") || "").trim();
      email = String(formData.get("email") || "").trim();
      message = String(formData.get("message") || "").trim();
      if (formData.get("subject")) subject = String(formData.get("subject")).trim();
    } else {
      const body = await req.json().catch(() => ({}));
      name = String(body.name || body.fullName || "").trim();
      email = String(body.email || "").trim();
      message = String(body.message || "").trim();
      if (body.subject) subject = String(body.subject).trim();
    }

    if (!email || !message) {
      return NextResponse.json(
        { error: "Email and message are required." },
        { status: 400 }
      );
    }

    const timestamp = new Date().toISOString();
    const contactEntry = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: name || "Anonymous User",
      email,
      subject,
      message,
      created_at: timestamp,
    };

    console.log(`[Contact] Received message from ${email} (${name}): ${message.slice(0, 50)}...`);

    // 1. Dispatch notification email to Platform Admin / Support
    const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || "support@xspy-trader.com";
    await sendEmail({
      to: adminEmail,
      subject: `📬 [Xspy Trader Contact] Message from ${name || email}`,
      html: `
        <!DOCTYPE html>
        <html>
        <body style="font-family: Arial, sans-serif; background: #0f172a; color: #f8fafc; padding: 24px;">
          <div style="max-width: 600px; margin: 0 auto; background: #1e293b; border-radius: 12px; padding: 24px; border: 1px solid #334155;">
            <h2 style="color: #60a5fa; margin-top: 0;">New Contact Inquiry</h2>
            <p><strong>From:</strong> ${name || "N/A"} &lt;${email}&gt;</p>
            <p><strong>Time:</strong> ${timestamp}</p>
            <p><strong>Subject:</strong> ${subject}</p>
            <hr style="border: none; border-top: 1px solid #334155; margin: 16px 0;" />
            <p style="font-weight: bold; color: #94a3b8;">Message:</p>
            <div style="background: #0f172a; padding: 16px; border-radius: 8px; border: 1px solid #1e293b; white-space: pre-wrap;">
              ${message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}
            </div>
            <p style="margin-top: 24px; font-size: 12px; color: #64748b;">
              Sent from Xspy-trader Contact Form
            </p>
          </div>
        </body>
        </html>
      `,
    }).catch((err) => console.warn("[Contact] Email dispatch warning:", err));

    // 2. Also send confirmation receipt to the sender
    await sendEmail({
      to: email,
      subject: "We received your message – Xspy Trader Support",
      html: `
        <!DOCTYPE html>
        <html>
        <body style="font-family: Arial, sans-serif; background: #0f172a; color: #f8fafc; padding: 24px;">
          <div style="max-width: 550px; margin: 0 auto; background: #1e293b; border-radius: 12px; padding: 24px; border: 1px solid #334155;">
            <h2 style="color: #60a5fa; margin-top: 0;">Thank You for Contacting Us</h2>
            <p>Hello ${name || "Trader"},</p>
            <p>We have successfully received your inquiry. Our support team will review your message and get back to you shortly.</p>
            <div style="background: #0f172a; padding: 14px; border-radius: 8px; border-left: 3px solid #3b82f6; margin: 16px 0; font-style: italic; color: #cbd5e1;">
              "${message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}"
            </div>
            <p style="font-size: 13px; color: #94a3b8;">
              Best regards,<br/>The Xspy Trader Support Team
            </p>
          </div>
        </body>
        </html>
      `,
    }).catch((err) => console.warn("[Contact] Sender receipt email warning:", err));

    // 3. Store in system_settings under 'recent_contact_messages' for admin records
    try {
      const { data } = await adminClient
        .from("system_settings")
        .select("value")
        .eq("key", "recent_contact_messages")
        .maybeSingle();

      const existing: any[] = Array.isArray(data?.value) ? data.value : [];
      const updated = [contactEntry, ...existing.slice(0, 99)]; // Keep latest 100

      await adminClient.from("system_settings").upsert({
        key: "recent_contact_messages",
        value: updated,
      });
    } catch (dbErr) {
      console.warn("[Contact] Storing in system_settings warning:", dbErr);
    }

    return NextResponse.json({
      success: true,
      message: "Your message has been sent successfully. We will reply to your email shortly.",
    });
  } catch (err: any) {
    console.error("[Contact] Error handling message:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to process your message. Please try again." },
      { status: 500 }
    );
  }
}
