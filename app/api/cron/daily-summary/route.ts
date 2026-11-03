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
    `📊 *التقرير اليومي وجدول صفقات XSPY Trader* 🚀\n` +
    `📅 *التاريخ:* \`${dateStr}\`\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📈 *جدول صفقات التداول اليومية (من الاثنين إلى الجمعة):*\n` +
    `نقدم لكم يومياً إشارات تداول احترافية ومباشرة بنسب ربح مجزية تُنفذ في ثوانٍ:\n` +
    `⏱️ *صفقة 30 ثانية:* ربح فوري *2.0%*\n` +
    `⏱️ *صفقة 45 ثانية:* ربح فوري *2.5%*\n` +
    `⏱️ *صفقة 60 ثانية:* ربح فوري *3.0%*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⛏️ *باقات التعدين السحابي (أرباح تضاف يومياً كل 24 ساعة):*\n` +
    `1️⃣ *باقة المبتدئين:* ($51 - $100) — ربح *1.5%* يومياً | ⏳ المدة: 7 أيام\n` +
    `2️⃣ *الباقة الاحترافية:* ($101 - $150) — ربح *1.8%* يومياً | ⏳ المدة: 18 يوماً\n` +
    `3️⃣ *باقة VIP:* ($151 - $200) — ربح *2.0%* يومياً | ⏳ المدة: 30 يوماً\n` +
    `💰 *الأرباح تضاف كل 24 ساعة، ورأس المال بالكامل يعود فور نهاية الباقة!*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🤝 *نظام الإحالة المتعدد (3 مستويات):*\n` +
    `اربح من إيداعات، تداولات، وباقات فريقك:\n` +
    `🥇 المستوى الأول: *7%* | 🥈 المستوى الثاني: *4%* | 🥉 المستوى الثالث: *2%*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⚙️ *السياسة المالية والأمان:*\n` +
    `💵 الحد الأدنى للإيداع: *$51* فقط\n` +
    `💸 الحد الأدنى للسحب: *$21* (رسوم 8% فقط)\n` +
    `⏱ مدة معالجة السحب: من ساعة إلى 24 ساعة كحد أقصى مع تأكيد أمني حصري عبر Gmail.\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🌟 *انضم الآن وكن جزءاً من مجتمع المستثمرين الناجحين:*\n` +
    `👉 [اضغط هنا لتسجيل حسابك وبدء الأرباح](${OFFICIAL_REF_LINK})\n\n` +
    `📌 *XSPY Trader – طريقك الذكي نحو الاستقلال المالي!* 💼✨`;

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
