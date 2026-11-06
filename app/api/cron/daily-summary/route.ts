import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getGroupBotToken } from "@/lib/telegram-tokens";
import { OFFICIAL_REF_LINK } from "@/lib/telegram-bot-knowledge";

// ─── Admin Supabase Client ────────────────────────────────────────────────────
const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const BOT_TOKEN = getGroupBotToken();
const SITE_URL = "https://xspy-trader.com";

// ─── Send to single Telegram chat ─────────────────────────────────────────────
async function sendTelegramMessage(
  chatId: string | number,
  text: string
): Promise<{ ok: boolean; description?: string }> {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "Markdown",
          disable_web_page_preview: true,
        }),
      }
    );
    const json = await res.json();
    return { ok: json.ok === true, description: json.description };
  } catch (err: any) {
    return { ok: false, description: err.message };
  }
}

// ─── Build Daily Summary Message ──────────────────────────────────────────────
async function generateDailyReport() {
  const today = new Date();
  const dateStr = today.toISOString().split("T")[0];
  const yesterdayIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  // 1. Fetch completed rounds in last 24h
  let completedRoundsCount = 0;
  let winningRoundsCount = 0;
  try {
    const { data: rounds } = await adminClient
      .from("trade_rounds")
      .select("id, forced_outcome")
      .eq("status", "completed")
      .gte("created_at", yesterdayIso);

    if (rounds) {
      completedRoundsCount = rounds.length;
      winningRoundsCount = rounds.filter((r) => r.forced_outcome === "win").length;
    }
  } catch {}

  // 2. Fetch total active investors / users
  let totalTraders = 0;
  try {
    const { count } = await adminClient
      .from("user_profiles")
      .select("uid", { count: "exact", head: true });
    totalTraders = count || 0;
  } catch {}

  // 3. Fetch active investments count
  let activeInvestmentsCount = 0;
  try {
    const { count } = await adminClient
      .from("user_investments")
      .select("id", { count: "exact", head: true })
      .eq("status", "active");
    activeInvestmentsCount = count || 0;
  } catch {}

  const winRateText = completedRoundsCount > 0 
    ? `${Math.round((winningRoundsCount / completedRoundsCount) * 100)}%` 
    : "100%";

  const message =
    `📊 *XSPY Trader — Daily Report & Trading Schedule* 🚀\n` +
    `📅 *Date:* \`${dateStr}\`\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📈 *Daily Trading Sessions Schedule (Monday – Friday):*\n` +
    `We provide daily professional live trade signals with guaranteed high payouts executed in seconds:\n` +
    `⏱️ *30s Trade:* Instant Profit *2.0%*\n` +
    `⏱️ *45s Trade:* Instant Profit *2.5%*\n` +
    `⏱️ *60s Trade:* Instant Profit *3.0%*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⛏️ *Cloud Mining Packages (Profits added every 24h):*\n` +
    `1️⃣ *Starter Package:* ($51 – $100) — *1.5%* Daily | ⏳ Duration: 7 Days\n` +
    `2️⃣ *Professional Package:* ($101 – $150) — *1.8%* Daily | ⏳ Duration: 18 Days\n` +
    `3️⃣ *VIP Package:* ($151 – $200) — *2.0%* Daily | ⏳ Duration: 30 Days\n` +
    `💰 *Profits are credited every 24 hours, and 100% of your initial capital returns upon completion!*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🤝 *Multi-Tier Referral System (3 Levels):*\n` +
    `Earn commissions from your team's deposits, trades, and packages:\n` +
    `🥇 Level 1: *7%* | 🥈 Level 2: *4%* | 🥉 Level 3: *2%*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⚙️ *Financial Policy & Security:*\n` +
    `💵 Minimum Deposit: *$51* only\n` +
    `💸 Minimum Withdrawal: *$21* (Only 8% fee)\n` +
    `⏱ Withdrawal Processing Time: 1 to 24 hours max with exclusive Gmail OTP verification.\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🌟 *Join now and become part of our successful investor community:*\n` +
    `👉 [Click here to register your account and start earning](${OFFICIAL_REF_LINK})\n\n` +
    `📌 *XSPY Trader — Your smart path to financial freedom!* 💼✨`;

  return {
    message,
    stats: {
      dateStr,
      completedRoundsCount,
      winningRoundsCount,
      winRateText,
      totalTraders,
      activeInvestmentsCount,
    },
  };
}

// ─── GET: Cron handler & status ───────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const force = searchParams.get("force") === "true";

    // Fetch target group chat ID from system_settings or env
    const { data: groupSetting } = await adminClient
      .from("system_settings")
      .select("value")
      .eq("key", "telegram_group_chat_id")
      .maybeSingle();

    const groupChatId = (groupSetting?.value as string) || process.env.TELEGRAM_GROUP_CHAT_ID;

    const report = await generateDailyReport();

    if (!groupChatId) {
      return NextResponse.json({
        ok: false,
        message: "No telegram_group_chat_id configured in system_settings or env.",
        stats: report.stats,
      });
    }

    const targetIds = groupChatId
      .split(/[,;\n]+/)
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);

    const results = await Promise.all(
      targetIds.map(async (cid: string) => {
        const res = await sendTelegramMessage(cid, report.message);
        return { chatId: cid, ...res };
      })
    );

    const overallOk = results.some((r) => r.ok);

    // Safely log admin notification
    try {
      await adminClient.from("admin_notifications").insert({
        type: "daily_summary_report",
        title: "📊 Daily Summary Telegram Report Sent",
        message: overallOk
          ? `Daily report broadcast to ${results.filter((r) => r.ok).length} Telegram Group(s).`
          : `Daily report broadcast failed for all target groups.`,
        data: { targetIds, results, stats: report.stats },
        is_read: false,
        created_at: new Date().toISOString(),
      });
    } catch {}

    return NextResponse.json({
      ok: overallOk,
      sentTo: targetIds,
      results,
      stats: report.stats,
    });
  } catch (error: any) {
    console.error("[Daily Summary Cron Error]", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Internal error" },
      { status: 500 }
    );
  }
}

// ─── POST: Admin manual trigger ───────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const targetChatId = body.targetChatId;

    // Fetch group chat ID from settings if not supplied in body
    let groupChatId = targetChatId;
    if (!groupChatId) {
      const { data: groupSetting } = await adminClient
        .from("system_settings")
        .select("value")
        .eq("key", "telegram_group_chat_id")
        .maybeSingle();

      groupChatId = (groupSetting?.value as string) || process.env.TELEGRAM_GROUP_CHAT_ID;
    }

    if (!groupChatId) {
      return NextResponse.json(
        { ok: false, message: "Target Telegram Group Chat ID not set." },
        { status: 400 }
      );
    }

    const report = await generateDailyReport();

    const targetIds = groupChatId
      .split(/[,;\n]+/)
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);

    const results = await Promise.all(
      targetIds.map(async (cid: string) => {
        const res = await sendTelegramMessage(cid, report.message);
        return { chatId: cid, ...res };
      })
    );

    const overallOk = results.some((r) => r.ok);

    // Safely log admin notification
    try {
      await adminClient.from("admin_notifications").insert({
        type: "daily_summary_manual_broadcast",
        title: "📊 Manual Daily Summary Broadcast Triggered",
        message: overallOk
          ? `Admin manually broadcast daily summary to ${results.filter((r) => r.ok).length} Telegram Group(s).`
          : `Failed to broadcast daily summary: ${results.map((r) => r.description).join("; ")}`,
        data: { targetIds, results, stats: report.stats },
        is_read: false,
        created_at: new Date().toISOString(),
      });
    } catch {}

    return NextResponse.json({
      ok: overallOk,
      sentTo: targetIds,
      results,
      stats: report.stats,
    });
  } catch (error: any) {
    console.error("[Daily Summary Manual Trigger Error]", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Internal error" },
      { status: 500 }
    );
  }
}
