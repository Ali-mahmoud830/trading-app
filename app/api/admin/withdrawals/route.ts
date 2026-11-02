import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function verifyAdmin() {
  const supabase = createServerClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();

  if (authErr || !user) {
    return { error: "Unauthorized", status: 401 };
  }

  const { data: adminProfile } = await adminClient
    .from("user_profiles")
    .select("role")
    .eq("uid", user.id)
    .single();

  if (adminProfile?.role !== "admin") {
    return { error: "Forbidden", status: 403 };
  }

  return { user, adminProfile };
}

// ─── GET: Fetch all withdrawals, stats, control & settings ─────────────────────
export async function GET() {
  try {
    const auth = await verifyAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    // 1. Fetch control & settings
    const [{ data: controlData }, { data: settingsData }] = await Promise.all([
      adminClient.from("withdrawal_control").select("is_enabled").limit(1).maybeSingle(),
      adminClient
        .from("withdrawal_settings")
        .select("fee_percentage, min_withdraw_amount, withdraw_enabled")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    // 2. Fetch withdrawals
    const { data: wdRows, error: wdErr } = await adminClient
      .from("withdrawals")
      .select("*")
      .order("created_at", { ascending: false });

    if (wdErr) {
      console.error("[admin/withdrawals] fetch error:", wdErr);
      return NextResponse.json({ error: wdErr.message }, { status: 500 });
    }

    const withdrawals = wdRows || [];

    // 3. Fetch related user profiles & wallets in batch
    const userIds = Array.from(new Set(withdrawals.map((w) => w.user_id).filter(Boolean)));
    const walletIds = Array.from(new Set(withdrawals.map((w) => w.wallet_id).filter(Boolean)));

    const [{ data: userProfiles }, { data: wallets }] = await Promise.all([
      userIds.length > 0
        ? adminClient
            .from("user_profiles")
            .select("uid, full_name, email, balance, country")
            .in("uid", userIds)
        : Promise.resolve({ data: [] }),
      walletIds.length > 0
        ? adminClient
            .from("withdrawal_wallets")
            .select("id, asset, address, label")
            .in("id", walletIds)
        : Promise.resolve({ data: [] }),
    ]);

    const userMap = new Map((userProfiles || []).map((u) => [u.uid, u]));
    const walletMap = new Map((wallets || []).map((w) => [w.id, w]));

    // 4. Enrich withdrawals with calculated fields
    const enriched = withdrawals.map((w) => {
      const user = userMap.get(w.user_id);
      const wallet = walletMap.get(w.wallet_id);

      const rawAmount = Number(w.amount || w.requested_amount || 0);
      const rawFee = Number(
        w.fee ?? (w.amount && w.fee_pct ? (w.amount * w.fee_pct) / 100 : 0)
      );
      const feePct = Number(
        w.fee_pct ?? (rawAmount > 0 ? Math.round((rawFee / rawAmount) * 100) : 0)
      );
      const netAmount = Number(w.net_amount ?? (rawAmount - rawFee));

      return {
        id: w.id,
        userId: w.user_id,
        walletId: w.wallet_id,
        amount: rawAmount,
        fee: rawFee,
        feePct,
        netAmount,
        status: w.status,
        otpVerified: Boolean(w.otp_verified),
        kycStatus: w.kyc_status || "pending",
        rejectionReason: w.rejection_reason || null,
        txId: w.tx_id || null,
        createdAt: w.created_at,
        updatedAt: w.updated_at,
        username: user?.full_name || "Unknown",
        email: user?.email || "—",
        userBalance: Number(user?.balance || 0),
        userCountry: user?.country || "",
        walletLabel: wallet?.label || "Main",
        asset: wallet?.asset || "USDT",
        address: wallet?.address || "",
      };
    });

    // 5. Compute stats
    let totalAll = 0;
    let totalApproved = 0;
    let pendingCount = 0;
    let todaysTotal = 0;
    let todaysCount = 0;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    for (const w of enriched) {
      totalAll += w.amount;
      if (w.status === "approved" || w.status === "paid") {
        totalApproved += w.amount;
      }
      if (w.status === "pending") {
        pendingCount++;
      }
      const itemDate = new Date(w.createdAt);
      if (itemDate >= startOfToday) {
        todaysTotal += w.amount;
        todaysCount++;
      }
    }

    return NextResponse.json({
      ok: true,
      control: {
        is_enabled: controlData?.is_enabled ?? true,
      },
      settings: {
        fee_percentage: Number(settingsData?.fee_percentage ?? 10),
        min_withdraw_amount: Number(settingsData?.min_withdraw_amount ?? 21),
        withdraw_enabled: settingsData?.withdraw_enabled ?? true,
      },
      stats: {
        totalAll,
        totalApproved,
        pendingCount,
        todaysTotal,
        todaysCount,
      },
      withdrawals: enriched,
    });
  } catch (error: any) {
    console.error("[admin/withdrawals] GET error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}

// ─── POST: Manage control, settings, edit amount, and status updates ──────────
export async function POST(req: NextRequest) {
  try {
    const auth = await verifyAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await req.json();
    const { action } = body;

    // 1. Toggle withdrawal control (enable/disable)
    if (action === "toggle_control") {
      const isEnabled = Boolean(body.isEnabled);

      // Update withdrawal_control
      const { error: ctrlErr } = await adminClient
        .from("withdrawal_control")
        .upsert(
          { id: 1, is_enabled: isEnabled },
          { onConflict: "id" }
        );

      if (ctrlErr) throw ctrlErr;

      // Also update withdrawal_settings.withdraw_enabled
      await adminClient
        .from("withdrawal_settings")
        .upsert(
          { id: 1, withdraw_enabled: isEnabled },
          { onConflict: "id" }
        );

      return NextResponse.json({ ok: true, is_enabled: isEnabled });
    }

    // 2. Save settings (fee % and min withdraw amount)
    if (action === "save_settings") {
      const feePercentage = Number(body.feePercentage);
      const minWithdrawAmount = Number(body.minWithdrawAmount);

      const { error: setErr } = await adminClient
        .from("withdrawal_settings")
        .upsert(
          {
            id: 1,
            fee_percentage: feePercentage,
            min_withdraw_amount: minWithdrawAmount,
          },
          { onConflict: "id" }
        );

      if (setErr) throw setErr;

      return NextResponse.json({ ok: true });
    }

    // 3. Edit individual withdrawal amount (with user balance auto-adjustment)
    if (action === "edit_amount") {
      const { withdrawalId, newAmount, newFee, newNetAmount, note } = body;

      if (!withdrawalId || newAmount == null || newAmount <= 0) {
        return NextResponse.json({ error: "Invalid amount or withdrawal ID" }, { status: 400 });
      }

      // Fetch existing withdrawal
      const { data: w, error: wErr } = await adminClient
        .from("withdrawals")
        .select("*")
        .eq("id", withdrawalId)
        .single();

      if (wErr || !w) {
        return NextResponse.json({ error: "Withdrawal not found" }, { status: 404 });
      }

      if (w.status !== "pending") {
        return NextResponse.json(
          { error: "Only pending withdrawals can have their amount edited" },
          { status: 400 }
        );
      }

      const oldAmount = Number(w.amount || w.requested_amount || 0);
      const diff = Number(newAmount) - oldAmount;

      // If amount changed, adjust user's account balance
      if (diff !== 0) {
        const { data: userProfile, error: uErr } = await adminClient
          .from("user_profiles")
          .select("balance")
          .eq("uid", w.user_id)
          .single();

        if (uErr || !userProfile) {
          return NextResponse.json({ error: "User profile not found" }, { status: 404 });
        }

        const currentBalance = Number(userProfile.balance || 0);

        if (diff > 0) {
          // Amount increased: user must have enough balance for the extra difference
          if (currentBalance < diff) {
            return NextResponse.json(
              {
                error: `User does not have enough balance to increase withdrawal by $${diff}. Current balance: $${currentBalance}`,
              },
              { status: 400 }
            );
          }
          // Deduct difference from user balance
          await adminClient
            .from("user_profiles")
            .update({ balance: currentBalance - diff })
            .eq("uid", w.user_id);
        } else {
          // Amount decreased: refund the difference back to user balance
          const refund = Math.abs(diff);
          await adminClient
            .from("user_profiles")
            .update({ balance: currentBalance + refund })
            .eq("uid", w.user_id);
        }
      }

      // Update withdrawal record
      const feeVal = Number(newFee ?? 0);
      const netVal = Number(newNetAmount ?? (newAmount - feeVal));

      const { error: updErr } = await adminClient
        .from("withdrawals")
        .update({
          amount: Number(newAmount),
          requested_amount: Number(newAmount),
          fee: feeVal,
          net_amount: netVal,
          ...(note ? { rejection_reason: `[Admin Edit Note]: ${note}` } : {}),
        })
        .eq("id", withdrawalId);

      if (updErr) throw updErr;

      return NextResponse.json({ ok: true, amount: newAmount, net_amount: netVal });
    }

    // 4. Update status (approve, processing, paid, reject) with balance refund on rejection
    if (action === "update_status") {
      const { withdrawalId, status: newStatus, txId, rejectReason } = body;

      if (!withdrawalId || !newStatus) {
        return NextResponse.json({ error: "Missing withdrawal ID or status" }, { status: 400 });
      }

      // Fetch withdrawal to check previous status and amount
      const { data: w, error: wErr } = await adminClient
        .from("withdrawals")
        .select("*")
        .eq("id", withdrawalId)
        .single();

      if (wErr || !w) {
        return NextResponse.json({ error: "Withdrawal not found" }, { status: 404 });
      }

      // Refund user balance if rejected and wasn't already rejected
      if (newStatus === "rejected" && w.status !== "rejected") {
        const { data: userProfile } = await adminClient
          .from("user_profiles")
          .select("balance")
          .eq("uid", w.user_id)
          .single();

        if (userProfile) {
          const currentBal = Number(userProfile.balance || 0);
          const refundAmount = Number(w.amount || w.requested_amount || 0);
          await adminClient
            .from("user_profiles")
            .update({ balance: currentBal + refundAmount })
            .eq("uid", w.user_id);
        }
      }

      // Update withdrawal status
      const { error: updErr } = await adminClient
        .from("withdrawals")
        .update({
          status: newStatus,
          ...(txId ? { tx_id: txId } : {}),
          ...(rejectReason ? { rejection_reason: rejectReason } : {}),
        })
        .eq("id", withdrawalId);

      if (updErr) throw updErr;

      return NextResponse.json({ ok: true, status: newStatus });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    console.error("[admin/withdrawals] POST error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
