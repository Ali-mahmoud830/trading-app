import { NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getNexusInvoice } from "@/lib/nexus";
import { processReferralCommissions } from "@/lib/actions/commissions";

function getAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createSupabaseClient(url, key);
}

export async function GET(req: Request) {
  try {
    const supabase = createServerSupabase();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const invoiceId = searchParams.get("invoiceId");

    if (!invoiceId) {
      return NextResponse.json(
        { error: "invoiceId parameter is required" },
        { status: 400 }
      );
    }

    // 1. Fetch live status from Nexus Gateway
    const invoice = await getNexusInvoice(invoiceId);

    const isConfirmed =
      invoice.status === "CONFIRMED" ||
      parseFloat(invoice.paidCryptoAmount || "0") > 0 ||
      !!invoice.txHash;

    // 2. If confirmed on-chain, ensure user balance is credited and deposit is marked confirmed
    if (isConfirmed) {
      const adminSupabase = getAdminSupabase();

      // Find the deposit record
      const { data: dep } = await adminSupabase
        .from("deposits")
        .select("id, status, amount, user_id")
        .eq("transaction_id", invoiceId)
        .maybeSingle();

      if (dep && dep.status !== "confirmed" && dep.status !== "approved") {
        const creditAmount = Number(dep.amount || invoice.baseAmount || 0);

        if (creditAmount > 0 && dep.user_id) {
          // Fetch current profile balance
          const { data: userProfile } = await adminSupabase
            .from("user_profiles")
            .select("uid, balance")
            .eq("uid", dep.user_id)
            .maybeSingle();

          if (userProfile) {
            const currentBal = Number(userProfile.balance || 0);
            const newBal = currentBal + creditAmount;

            await adminSupabase
              .from("user_profiles")
              .update({ balance: newBal })
              .eq("uid", userProfile.uid);

            console.log(
              `[Nexus/check-status] Credited $${creditAmount} to user ${dep.user_id}. New balance: $${newBal}`
            );
          }

          // Process referral commissions (7%, 4%, 2%)
          try {
            await processReferralCommissions(dep.user_id, creditAmount, "deposit");
          } catch (commErr) {
            console.error("[Nexus/check-status] Error processing referral commissions:", commErr);
          }
        }

        // Update deposit status to confirmed
        await adminSupabase
          .from("deposits")
          .update({
            status: "confirmed",
            confirmed_at: new Date().toISOString(),
          })
          .eq("id", dep.id);
      }
    }

    return NextResponse.json({
      success: true,
      data: invoice,
    });
  } catch (err: any) {
    console.error("[Nexus/check-status] Error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to check invoice status" },
      { status: 500 }
    );
  }
}
