// app/api/admin/weekly-winner/route.ts
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

export async function POST() {
  const supabase = createClient();
  const adminId = await verifyAdmin(supabase);
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const db = adminClient();
  const now = new Date();

  // Last Monday 00:00 UTC
  const dayOfWeek = now.getUTCDay();
  const daysToLastMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const lastMonday = new Date(now);
  lastMonday.setUTCDate(now.getUTCDate() - daysToLastMonday);
  lastMonday.setUTCHours(0, 0, 0, 0);

  // Count active new referrals (L1 with a deposit) per referrer during the week
  // A "new active referral this week" = the DEPOSIT was created this week (first deposit)
  const { data: weekDeposits } = await db
    .from("deposits")
    .select("user_id")
    .in("status", ["approved", "confirmed"])
    .gte("created_at", lastMonday.toISOString());

  const weekActiveIds = new Set((weekDeposits ?? []).map((d: any) => d.user_id));

  // Get referrers for these users
  const { data: referrals } = await db
    .from("referrals")
    .select("referrer_id, referred_id")
    .eq("level", 1)
    .in("referred_id", Array.from(weekActiveIds));

  // Get non-admin referrers
  const { data: adminUsers } = await db
    .from("user_profiles")
    .select("uid")
    .eq("role", "admin");
  const adminIds = new Set((adminUsers ?? []).map((u: any) => u.uid));

  const weekWinsMap: Record<string, number> = {};
  for (const r of (referrals ?? [])) {
    if (adminIds.has(r.referrer_id)) continue;
    weekWinsMap[r.referrer_id] = (weekWinsMap[r.referrer_id] ?? 0) + 1;
  }

  const sortedWinners = Object.entries(weekWinsMap).sort((a, b) => b[1] - a[1]);
  if (sortedWinners.length === 0) {
    const { data: topAllTime } = await db
      .from("user_profiles")
      .select("full_name, email, referral_code, total_referrals, referral_earnings")
      .order("referral_earnings", { ascending: false })
      .limit(1)
      .maybeSingle();

    const leaderName = topAllTime?.full_name || topAllTime?.email || "N/A";
    const leaderCode = topAllTime?.referral_code || "N/A";
    const leaderEarn = topAllTime?.referral_earnings || 0;
    const leaderRefs = topAllTime?.total_referrals || 0;

    return NextResponse.json({
      ok: false,
      message: `لم يتم تسجيل إيداعات إحالة جديدة هذا الأسبوع (منذ يوم الاثنين). المتصدر العام الحالي للمنصة: ${leaderName} (${leaderCode}) برصيد ${leaderRefs} إحالة وأرباح $${leaderEarn}.`,
      messageEn: `No active referral deposits recorded this week (since Monday). Current platform all-time leader: ${leaderName} (${leaderCode}) with ${leaderRefs} referrals and $${leaderEarn} earnings.`,
      allTimeLeader: topAllTime,
    });
  }

  const [winnerId, winnerCount] = sortedWinners[0];

  // Get winner profile
  const { data: winnerProfile } = await db
    .from("user_profiles")
    .select("uid, full_name, email, referral_code, telegram_chat_id")
    .eq("uid", winnerId)
    .single();

  if (!winnerProfile) {
    return NextResponse.json({ error: "Winner profile not found." }, { status: 500 });
  }

  const weekLabel = `${lastMonday.toISOString().slice(0, 10)} – ${now.toISOString().slice(0, 10)}`;
  const notifTitle = "🏆 You're This Week's Top Referrer!";
  const notifMessage = `Congratulations ${winnerProfile.full_name ?? "Champion"}! You ranked #1 on the Xspy Trader referral leaderboard for the week of ${weekLabel} with ${winnerCount} new active referrals. Keep it up — your success drives our community forward! 🚀`;

  // Send in-app notification
  await db.from("notifications").insert({
    user_id: winnerId,
    type: "success",
    title: notifTitle,
    message: notifMessage,
    metadata: { week: weekLabel, referrals_count: winnerCount, type: "weekly_winner" },
  });

  // Send Telegram notification if chat ID exists
  if (winnerProfile.telegram_chat_id) {
    const { getOtpBotToken } = await import("@/lib/telegram-tokens");
    const botToken = getOtpBotToken();
    if (botToken) {
      const telegramMsg = `🏆 *Congratulations ${winnerProfile.full_name ?? "Champion"}!*\n\nYou are this week's *Top Referrer* on Xspy Trader!\n\n📅 Week: ${weekLabel}\n👥 New Active Referrals: *${winnerCount}*\n\nKeep inviting friends and earning more commissions! Your referral code: \`${winnerProfile.referral_code ?? "N/A"}\`\n\nThank you for being a champion in our community! 🚀`;
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: winnerProfile.telegram_chat_id,
          text: telegramMsg,
          parse_mode: "Markdown",
        }),
      }).catch(() => {});
    }
  }

  return NextResponse.json({
    success: true,
    winner: {
      name: winnerProfile.full_name,
      email: winnerProfile.email,
      referral_code: winnerProfile.referral_code,
      active_referrals_this_week: winnerCount,
      week: weekLabel,
    },
  });
}
