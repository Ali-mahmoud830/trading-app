import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { verifyNexusWebhookSignature, getNexusInvoice } from "@/lib/nexus";
import { processReferralCommissions } from "@/lib/actions/commissions";

function getAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createSupabaseClient(url, key);
}

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const signatureHeader = req.headers.get("x-nexus-signature");
    const timestampHeader = req.headers.get("x-nexus-timestamp");
    const eventHeader = req.headers.get("x-nexus-event");

    let payload: any = null;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const event = payload?.event || eventHeader;
    const data = payload?.data || {};
    const invoiceId = data?.invoiceId;

    if (!invoiceId) {
      console.warn("[Nexus/webhook] Missing invoiceId in payload:", payload);
      return NextResponse.json({ error: "Missing invoiceId" }, { status: 400 });
    }

    // Security Verification:
    // First try HMAC signature verification with shared secret
    const webhookSecret = process.env.NEXUS_WEBHOOK_SECRET;
    let isSignatureValid = false;

    if (webhookSecret && webhookSecret !== "your_shared_webhook_secret_or_jwt_secret") {
      isSignatureValid = verifyNexusWebhookSignature(
        rawBody,
        signatureHeader,
        timestampHeader,
        webhookSecret
      );
    }

    // Defense-in-depth: If HMAC is not matched, verify the invoice directly with Nexus Gateway API
    if (!isSignatureValid) {
      try {
        console.log(`[Nexus/webhook] Validating invoice ${invoiceId} directly against Nexus Gateway API...`);
        const liveInvoice = await getNexusInvoice(invoiceId);
        if (liveInvoice && liveInvoice.invoiceId === invoiceId) {
          isSignatureValid = true;
          // Synchronize payload status with authoritative live data
          data.status = liveInvoice.status;
          data.paidCryptoAmount = liveInvoice.paidCryptoAmount;
          data.txHash = liveInvoice.txHash;
          data.baseAmount = liveInvoice.baseAmount;
        }
      } catch (checkErr) {
        console.error(`[Nexus/webhook] Direct verification failed for ${invoiceId}:`, checkErr);
      }
    }

    if (!isSignatureValid) {
      console.error("[Nexus/webhook] Unauthorized webhook attempt for invoice:", invoiceId);
      return NextResponse.json({ error: "Unauthorized webhook" }, { status: 401 });
    }

    console.log(`[Nexus/webhook] Verified webhook received for ${invoiceId}, event: ${event}, status: ${data.status}`);

    const adminSupabase = getAdminSupabase();

    // Find the corresponding deposit record
    const { data: dep, error: depErr } = await adminSupabase
      .from("deposits")
      .select("id, status, amount, user_id, uid")
      .eq("transaction_id", invoiceId)
      .maybeSingle();

    if (depErr) {
      console.error("[Nexus/webhook] Database error fetching deposit:", depErr);
    }

    // Handle PAYMENT_CONFIRMED event or CONFIRMED status
    if (event === "PAYMENT_CONFIRMED" || data.status === "CONFIRMED") {
      if (dep && dep.status !== "confirmed" && dep.status !== "approved") {
        const creditAmount = Number(dep.amount || data.baseAmount || data.amount || 0);
        const targetUserId = dep.user_id || dep.uid || data.userId;

        if (creditAmount > 0 && targetUserId) {
          // Fetch current profile balance
          const { data: userProfile } = await adminSupabase
            .from("user_profiles")
            .select("uid, balance")
            .eq("uid", targetUserId)
            .maybeSingle();

          if (userProfile) {
            const currentBal = Number(userProfile.balance || 0);
            const newBal = currentBal + creditAmount;

            await adminSupabase
              .from("user_profiles")
              .update({ balance: newBal })
              .eq("uid", userProfile.uid);

            console.log(
              `[Nexus/webhook] 💰 Successfully credited $${creditAmount} to user ${targetUserId}. New Balance: $${newBal}`
            );
          }

          // Process referral commissions (7%, 4%, 2%)
          try {
            const commRes = await processReferralCommissions(targetUserId, creditAmount, "deposit");
            console.log(`[Nexus/webhook] Referral commissions result:`, commRes);
          } catch (commErr) {
            console.error("[Nexus/webhook] Error processing referral commissions:", commErr);
          }
        }

        // Mark deposit as confirmed
        await adminSupabase
          .from("deposits")
          .update({
            status: "confirmed",
            confirmed_at: new Date().toISOString(),
          })
          .eq("id", dep.id);
      }

      return NextResponse.json({
        success: true,
        message: "Payment confirmed and balance credited",
        invoiceId,
      });
    }

    // Handle payment detected (in mempool / awaiting confirmations)
    if (event === "PAYMENT_DETECTED" && dep && dep.status === "pending") {
      await adminSupabase
        .from("deposits")
        .update({
          status: "detected",
        })
        .eq("id", dep.id);

      return NextResponse.json({
        success: true,
        message: "Payment detected on-chain",
        invoiceId,
      });
    }

    return NextResponse.json({
      success: true,
      message: "Webhook processed",
      invoiceId,
    });
  } catch (err: any) {
    console.error("[Nexus/webhook] Unhandled webhook error:", err);
    return NextResponse.json(
      { error: err?.message || "Webhook processing error" },
      { status: 500 }
    );
  }
}
