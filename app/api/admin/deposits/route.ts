import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { processReferralCommissions } from "@/lib/actions/commissions";

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

// ─── GET: Fetch settings, deposits (LIGHTWEIGHT, without heavy base64), and stats ───
export async function GET(req: NextRequest) {
  try {
    const auth = await verifyAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(req.url);
    const proofFor = searchParams.get("proofFor");

    // If requesting proof for a single deposit, lazy-load only that one base64 image!
    if (proofFor) {
      const { data, error } = await adminClient
        .from("deposits")
        .select("id, proof_base64")
        .eq("id", proofFor)
        .single();

      if (error || !data) {
        return NextResponse.json({ error: "Proof not found" }, { status: 404 });
      }

      return NextResponse.json({ ok: true, id: data.id, proof_base64: data.proof_base64 });
    }

    // Parallel fetch: Settings + Deposits + Wallets
    const [settingsRes, depositsRes, walletsRes] = await Promise.all([
      adminClient
        .from("deposit_settings")
        .select("is_enabled, min_deposit_amount")
        .limit(1)
        .maybeSingle(),

      // CRITICAL: Notice we do NOT select proof_base64 here!
      // This reduces payload from 50+ megabytes down to ~5 kilobytes!
      adminClient
        .from("deposits")
        .select(`
          id,
          uid,
          user_id,
          username,
          email,
          amount,
          status,
          network_id,
          created_at
        `)
        .order("created_at", { ascending: false })
        .limit(100),

      adminClient
        .from("deposit_wallets")
        .select("id, asset, address, label")
    ]);

    if (depositsRes.error) {
      console.error("[admin/deposits] error fetching deposits:", depositsRes.error);
      return NextResponse.json({ error: depositsRes.error.message }, { status: 500 });
    }

    const walletsMap = new Map((walletsRes.data || []).map((w) => [w.id, w]));
    const rawDeposits = depositsRes.data || [];

    // Attach wallet info
    const enriched = rawDeposits.map((dep: any) => ({
      ...dep,
      deposit_wallets: dep.network_id ? walletsMap.get(dep.network_id) || null : null,
      has_proof: true, // All submissions in UI contain proof
    }));

    // Calculate stats in 1 millisecond on server
    const totalDeposits = enriched.length;
    const totalAmount = enriched.reduce((sum: number, d: any) => sum + Number(d.amount || 0), 0);
    const today = new Date().toISOString().split("T")[0];
    const todayList = enriched.filter((d: any) => d.created_at?.startsWith(today));
    const todayDeposits = todayList.length;
    const todayAmount = todayList.reduce((sum: number, d: any) => sum + Number(d.amount || 0), 0);

    const stats = {
      totalDeposits,
      totalAmount,
      todayDeposits,
      todayAmount,
    };

    const settings = {
      is_enabled: settingsRes.data?.is_enabled ?? true,
      min_deposit_amount: Number(settingsRes.data?.min_deposit_amount ?? 10),
    };

    return NextResponse.json({
      ok: true,
      deposits: enriched,
      settings,
      stats,
    });
  } catch (error: any) {
    console.error("[admin/deposits] GET error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}

// ─── POST: Approve, Reject, or Update Settings ────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const auth = await verifyAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await req.json();
    const { action } = body;

    // 1. Update Deposit Settings
    if (action === "save_settings") {
      const { is_enabled, min_deposit_amount } = body;
      const { error } = await adminClient
        .from("deposit_settings")
        .update({
          is_enabled: Boolean(is_enabled),
          min_deposit_amount: Number(min_deposit_amount),
        })
        .neq("id", 0);

      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    // 2. Approve Deposit
    if (action === "approve") {
      const { depositId } = body;
      if (!depositId) {
        return NextResponse.json({ error: "Missing depositId" }, { status: 400 });
      }

      // Fetch deposit to inspect current status & amount
      const { data: dep, error: fetchErr } = await adminClient
        .from("deposits")
        .select("*")
        .eq("id", depositId)
        .single();

      if (fetchErr || !dep) {
        return NextResponse.json({ error: "Deposit not found" }, { status: 404 });
      }

      // Only credit balance if not previously approved
      if (dep.status !== "approved") {
        const depositAmount = Number(dep.amount || 0);
        const targetUserId = dep.user_id || dep.uid;

        if (targetUserId && depositAmount > 0) {
          // Fetch user profile
          const { data: userProfile } = await adminClient
            .from("user_profiles")
            .select("uid, balance")
            .or(`uid.eq.${targetUserId},id.eq.${targetUserId}`)
            .maybeSingle();

          if (userProfile) {
            const currentBal = Number(userProfile.balance || 0);
            await adminClient
              .from("user_profiles")
              .update({
                balance: currentBal + depositAmount,
              })
              .eq("uid", userProfile.uid);
          }
        }

        // Update status to approved
        const { error: updErr } = await adminClient
          .from("deposits")
          .update({
            status: "approved",
          })
          .eq("id", depositId);

        if (updErr) throw updErr;

        // Fire referral commissions (non-blocking - don't let this fail the approval)
        if (targetUserId && depositAmount > 0) {
          processReferralCommissions(targetUserId, depositAmount, "deposit")
            .then((result) => {
              console.log(`[admin/deposits] Referral commissions for deposit approval:`, result);
            })
            .catch((err) => {
              console.warn(`[admin/deposits] Referral commission error (non-fatal):`, err?.message);
            });
        }
      }

      return NextResponse.json({ ok: true, status: "approved" });
    }

    // 3. Reject Deposit
    if (action === "reject") {
      const { depositId } = body;
      if (!depositId) {
        return NextResponse.json({ error: "Missing depositId" }, { status: 400 });
      }

      const { data: dep, error: fetchErr } = await adminClient
        .from("deposits")
        .select("*")
        .eq("id", depositId)
        .single();

      if (fetchErr || !dep) {
        return NextResponse.json({ error: "Deposit not found" }, { status: 404 });
      }

      // If it was previously approved and is now being rejected, revert credited balance
      if (dep.status === "approved") {
        const depositAmount = Number(dep.amount || 0);
        const targetUserId = dep.user_id || dep.uid;

        if (targetUserId && depositAmount > 0) {
          const { data: userProfile } = await adminClient
            .from("user_profiles")
            .select("uid, balance")
            .or(`uid.eq.${targetUserId},id.eq.${targetUserId}`)
            .maybeSingle();

          if (userProfile) {
            const currentBal = Number(userProfile.balance || 0);
            await adminClient
              .from("user_profiles")
              .update({
                balance: Math.max(0, currentBal - depositAmount),
              })
              .eq("uid", userProfile.uid);
          }
        }
      }

      const { error: updErr } = await adminClient
        .from("deposits")
        .update({
          status: "rejected",
        })
        .eq("id", depositId);

      if (updErr) throw updErr;

      return NextResponse.json({ ok: true, status: "rejected" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    console.error("[admin/deposits] POST error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
