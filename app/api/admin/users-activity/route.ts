// app/api/admin/users-activity/route.ts
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

const INACTIVITY_THRESHOLD_DAYS = 14;

function getReEngagementSuggestion(daysSinceActivity: number, totalDeposits: number): string {
  if (daysSinceActivity > 60) {
    return "🚨 High risk of churn. Consider a personalised email campaign offering a limited-time 5% bonus on their next deposit, or send a direct Telegram message.";
  }
  if (daysSinceActivity > 30) {
    return "⚠️ Re-engage with a special event invite or a referral contest. Offer a 2% loyalty bonus if they top up within 7 days.";
  }
  if (totalDeposits === 0) {
    return "💡 First-time deposit incentive — offer a welcome bonus or explain the earning potential more clearly in a personal message.";
  }
  return "📩 Send a gentle reminder about an upcoming trading session or a new investment package.";
}

export async function GET() {
  const supabase = createClient();
  const adminId = await verifyAdmin(supabase);
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const db = adminClient();
  const now = new Date();

  // Get all non-admin users
  const { data: allUsers } = await db
    .from("user_profiles")
    .select("uid, full_name, email, balance, status, created_at")
    .neq("role", "admin");

  const users = allUsers ?? [];
  const userIds = users.map((u: any) => u.uid);
  if (userIds.length === 0) return NextResponse.json({ active: [], inactive: [], stats: {} });

  // Recent deposits (as proxy for last activity)
  const { data: deposits } = await db
    .from("deposits")
    .select("user_id, created_at, amount, status")
    .in("user_id", userIds)
    .order("created_at", { ascending: false });

  // Recent investments
  const { data: investments } = await db
    .from("investments")
    .select("user_id, created_at, status")
    .in("user_id", userIds)
    .order("created_at", { ascending: false });

  // Week boundaries (Monday-to-Monday)
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon
  const daysToLastMonday = (dayOfWeek === 0 ? 6 : dayOfWeek - 1);
  const lastMonday = new Date(now);
  lastMonday.setDate(now.getDate() - daysToLastMonday);
  lastMonday.setHours(0, 0, 0, 0);

  // Build last-activity map per user
  const lastActivityMap: Record<string, Date> = {};
  const depositTotalsMap: Record<string, number> = {};
  const weekDepositsMap: Record<string, number> = {};

  for (const d of (deposits ?? [])) {
    const uid = d.user_id;
    const dt = new Date(d.created_at);
    if (!lastActivityMap[uid] || dt > lastActivityMap[uid]) {
      lastActivityMap[uid] = dt;
    }
    if (d.status === "approved" || d.status === "confirmed") {
      depositTotalsMap[uid] = (depositTotalsMap[uid] ?? 0) + Number(d.amount ?? 0);
      if (dt >= lastMonday) {
        weekDepositsMap[uid] = (weekDepositsMap[uid] ?? 0) + Number(d.amount ?? 0);
      }
    }
  }
  for (const inv of (investments ?? [])) {
    const uid = inv.user_id;
    const dt = new Date(inv.created_at);
    if (!lastActivityMap[uid] || dt > lastActivityMap[uid]) {
      lastActivityMap[uid] = dt;
    }
  }

  const processed = users.map((u: any) => {
    const lastActivity = lastActivityMap[u.uid] ?? new Date(u.created_at);
    const daysSince = Math.floor((now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24));
    const isInactive = daysSince >= INACTIVITY_THRESHOLD_DAYS;
    const totalDeposits = depositTotalsMap[u.uid] ?? 0;

    return {
      uid: u.uid,
      full_name: u.full_name ?? "Unknown",
      email: u.email ?? "N/A",
      balance: Number(u.balance ?? 0),
      status: u.status ?? "active",
      joined: u.created_at,
      last_activity: lastActivity.toISOString(),
      days_since_activity: daysSince,
      is_inactive: isInactive,
      total_deposits: totalDeposits,
      week_deposits: weekDepositsMap[u.uid] ?? 0,
      suggestion: isInactive ? getReEngagementSuggestion(daysSince, totalDeposits) : null,
    };
  });

  const activeUsers = processed.filter((u: any) => !u.is_inactive).sort((a: any, b: any) => b.week_deposits - a.week_deposits);
  const inactiveUsers = processed.filter((u: any) => u.is_inactive).sort((a: any, b: any) => b.days_since_activity - a.days_since_activity);

  const stats = {
    total: processed.length,
    active: activeUsers.length,
    inactive: inactiveUsers.length,
    new_this_week: users.filter((u: any) => new Date(u.created_at) >= lastMonday).length,
    total_deposited_this_week: Object.values(weekDepositsMap).reduce((s: number, v: number) => s + v, 0),
  };

  return NextResponse.json({ active: activeUsers, inactive: inactiveUsers, stats });
}
