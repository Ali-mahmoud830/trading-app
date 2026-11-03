// app/api/admin/referrals-overview/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

const adminClient = () =>
  createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

async function verifyAdmin(supabase: ReturnType<typeof createClient>) {
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) return null;
  const db = adminClient();
  const { data: profile } = await db
    .from("user_profiles")
    .select("role")
    .eq("uid", user.id)
    .single();
  if (profile?.role !== "admin") return null;
  return user.id;
}

export async function GET() {
  const supabase = createClient();
  const adminId = await verifyAdmin(supabase);
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const db = adminClient();

  // All platform users with referral metrics
  const { data: allUsers } = await db
    .from("user_profiles")
    .select("uid, full_name, email, referral_code, balance, total_referrals, referral_earnings, created_at, status, role");

  const users = allUsers ?? [];
  const userIds = users.map((u: any) => u.uid);

  if (userIds.length === 0) return NextResponse.json({ users: [] });

  // All referrals
  const { data: allReferrals } = await db
    .from("referrals")
    .select("referrer_id, referred_id, level, status");

  // All commissions
  const { data: allCommissions } = await db
    .from("referral_commissions")
    .select("recipient_uid, amount, level, metadata, created_at");

  // All deposits (approved) — for active referral count
  const { data: allDeposits } = await db
    .from("deposits")
    .select("user_id, amount, status, created_at")
    .in("status", ["approved", "confirmed"]);

  // All investments
  const { data: allInvestments } = await db
    .from("investments")
    .select("user_id, amount, profit, status");

  // Build per-user summary
  const referralsMap: Record<string, { total: number; active: number; byLevel: Record<number, number> }> = {};
  const commissionsMap: Record<string, { deposit: number; trade: number; package: number; milestone: number; total: number }> = {};
  const depositsMap: Record<string, number> = {};

  // Who has a deposit (to calculate active referrals)
  const usersWithDeposits = new Set((allDeposits ?? []).map((d: any) => d.user_id));

  // Referrals per referrer
  for (const r of (allReferrals ?? [])) {
    if (!referralsMap[r.referrer_id]) {
      referralsMap[r.referrer_id] = { total: 0, active: 0, byLevel: { 1: 0, 2: 0, 3: 0 } };
    }
    referralsMap[r.referrer_id].total++;
    referralsMap[r.referrer_id].byLevel[r.level] = (referralsMap[r.referrer_id].byLevel[r.level] ?? 0) + 1;
    if (usersWithDeposits.has(r.referred_id)) {
      referralsMap[r.referrer_id].active++;
    }
  }

  // Commissions per recipient
  for (const c of (allCommissions ?? [])) {
    const uid = c.recipient_uid;
    if (!commissionsMap[uid]) commissionsMap[uid] = { deposit: 0, trade: 0, package: 0, milestone: 0, total: 0 };
    const amt = Number(c.amount ?? 0);
    const reason = c.metadata?.reason ?? "";
    if (reason === "deposit") commissionsMap[uid].deposit += amt;
    else if (reason === "trade") commissionsMap[uid].trade += amt;
    else if (reason === "package") commissionsMap[uid].package += amt;
    else if (reason === "milestone") commissionsMap[uid].milestone += amt;
    commissionsMap[uid].total += amt;
  }

  // Deposits per user
  for (const d of (allDeposits ?? [])) {
    depositsMap[d.user_id] = (depositsMap[d.user_id] ?? 0) + Number(d.amount ?? 0);
  }

  // Investments per user
  const investmentsMap: Record<string, number> = {};
  for (const inv of (allInvestments ?? [])) {
    investmentsMap[inv.user_id] = (investmentsMap[inv.user_id] ?? 0) + Number(inv.profit ?? 0);
  }

  // Calculate expected vs actual commissions (discrepancy detection)
  // Expected: sum of all deposits by referred users * commission rate
  // Actual: sum of commissions received
  const RATE_L1 = 0.10;
  const userResults = users.map((u: any) => {
    const refs = referralsMap[u.uid] ?? { total: 0, active: 0, byLevel: { 1: 0, 2: 0, 3: 0 } };
    const comms = commissionsMap[u.uid] ?? { deposit: 0, trade: 0, package: 0, milestone: 0, total: 0 };

    // Get L1 referrals' deposit amounts
    const l1Referrals = (allReferrals ?? []).filter((r: any) => r.referrer_id === u.uid && r.level === 1);
    const l1Ids = l1Referrals.map((r: any) => r.referred_id);
    const expectedFromDeposits = l1Ids.reduce((sum: number, id: string) => sum + (depositsMap[id] ?? 0) * RATE_L1, 0);
    const discrepancy = Math.abs(comms.deposit - expectedFromDeposits) > 0.01
      ? { expected: expectedFromDeposits, actual: comms.deposit, diff: comms.deposit - expectedFromDeposits }
      : null;

    return {
      uid: u.uid,
      full_name: u.full_name ?? "Unknown",
      email: u.email ?? "N/A",
      referral_code: u.referral_code ?? "N/A",
      balance: Number(u.balance ?? 0),
      total_referrals: refs.total,
      active_referrals: refs.active,
      level_breakdown: refs.byLevel,
      deposit_earnings: comms.deposit,
      trade_earnings: comms.trade,
      package_earnings: comms.package,
      milestone_earnings: comms.milestone,
      total_earnings: comms.total,
      total_deposited: depositsMap[u.uid] ?? 0,
      investment_profit: investmentsMap[u.uid] ?? 0,
      status: u.status ?? "active",
      joined: u.created_at,
      discrepancy,
    };
  });

  // Sort by total_earnings desc
  userResults.sort((a: any, b: any) => b.total_earnings - a.total_earnings);

  const discrepancies = userResults.filter((u: any) => u.discrepancy !== null);

  return NextResponse.json({ users: userResults, discrepancies });
}
