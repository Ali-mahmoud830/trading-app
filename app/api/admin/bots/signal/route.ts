import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getGroupBotToken } from "@/lib/telegram-tokens";

// ─── Admin Supabase Client ────────────────────────────────────────────────────
const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const GROUP_BOT_TOKEN = getGroupBotToken();
const SITE_URL = "https://xspy-trader.com";

// ─── Send to single Telegram chat ─────────────────────────────────────────────
async function sendTelegramMessage(
  chatId: string | number,
  text: string
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${GROUP_BOT_TOKEN}/sendMessage`,
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
    return json.ok === true;
  } catch {
    return false;
  }
}

// ─── Build multilingual trade signal message ──────────────────────────────────
function buildSignalMessage(
  symbol: string,
  durationSec: number,
  payoutPercent: number,
  direction: "buy" | "sell",
  lang: string
): string {
  const directionEmoji = direction === "buy" ? "📈" : "📉";
  const directionAr = direction === "buy" ? "شراء 📈 (CALL)" : "بيع 📉 (PUT)";
  const directionEn = direction === "buy" ? "BUY 📈 (CALL)" : "SELL 📉 (PUT)";
  const directionFr = direction === "buy" ? "ACHAT 📈 (CALL)" : "VENTE 📉 (PUT)";
  const directionDe = direction === "buy" ? "KAUF 📈 (CALL)" : "VERKAUF 📉 (PUT)";
  const directionRu = direction === "buy" ? "ПОКУПКА 📈 (CALL)" : "ПРОДАЖА 📉 (PUT)";

  const formatDur = (s: number) => {
    if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60 > 0 ? `${s % 60}s` : ""}`.trim();
    return `${s}s`;
  };

  switch (lang) {
    case "ar":
      return (
        `${directionEmoji} *إشعار صفقة تداول جديدة — XSPY Trader!*\n\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `📊 *الزوج:* \`${symbol}\`\n` +
        `⏱ *المدة:* ${formatDur(durationSec)}\n` +
        `💰 *نسبة الربح:* ${payoutPercent}%\n` +
        `🎯 *التوجه:* ${directionAr}\n` +
        `━━━━━━━━━━━━━━━━━━\n\n` +
        `⚡ *الجولة مفتوحة الآن — انضم قبل انتهاء نافذة الدخول!*\n\n` +
        `👉 [ادخل إلى منصة التداول](${SITE_URL}/dashboard/trading)\n\n` +
        `_XSPY Trader — طريقك الذكي نحو الاستقلال المالي_ 💼✨`
      );
    case "fr":
      return (
        `${directionEmoji} *Nouveau signal de trading — XSPY Trader!*\n\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `📊 *Paire:* \`${symbol}\`\n` +
        `⏱ *Durée:* ${formatDur(durationSec)}\n` +
        `💰 *Rendement:* ${payoutPercent}%\n` +
        `🎯 *Direction:* ${directionFr}\n` +
        `━━━━━━━━━━━━━━━━━━\n\n` +
        `⚡ *La session est ouverte — rejoignez avant la fin de la fenêtre d'entrée!*\n\n` +
        `👉 [Accéder à la plateforme](${SITE_URL}/dashboard/trading)\n\n` +
        `_XSPY Trader — Votre voie intelligente vers l'indépendance financière_ 💼✨`
      );
    case "de":
      return (
        `${directionEmoji} *Neues Trading-Signal — XSPY Trader!*\n\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `📊 *Paar:* \`${symbol}\`\n` +
        `⏱ *Dauer:* ${formatDur(durationSec)}\n` +
        `💰 *Gewinn:* ${payoutPercent}%\n` +
        `🎯 *Richtung:* ${directionDe}\n` +
        `━━━━━━━━━━━━━━━━━━\n\n` +
        `⚡ *Die Runde ist jetzt offen — treten Sie vor Ablauf des Einstiegsfensters bei!*\n\n` +
        `👉 [Zur Trading-Plattform](${SITE_URL}/dashboard/trading)\n\n` +
        `_XSPY Trader — Ihr intelligenter Weg zur finanziellen Unabhängigkeit_ 💼✨`
      );
    case "ru":
      return (
        `${directionEmoji} *Новый торговый сигнал — XSPY Trader!*\n\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `📊 *Пара:* \`${symbol}\`\n` +
        `⏱ *Длительность:* ${formatDur(durationSec)}\n` +
        `💰 *Прибыль:* ${payoutPercent}%\n` +
        `🎯 *Направление:* ${directionRu}\n` +
        `━━━━━━━━━━━━━━━━━━\n\n` +
        `⚡ *Раунд открыт — присоединяйтесь до закрытия окна входа!*\n\n` +
        `👉 [Перейти на платформу](${SITE_URL}/dashboard/trading)\n\n` +
        `_XSPY Trader — Ваш умный путь к финансовой независимости_ 💼✨`
      );
    default: // en
      return (
        `${directionEmoji} *New Trade Signal — XSPY Trader!*\n\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `📊 *Pair:* \`${symbol}\`\n` +
        `⏱ *Duration:* ${formatDur(durationSec)}\n` +
        `💰 *Payout:* ${payoutPercent}%\n` +
        `🎯 *Direction:* ${directionEn}\n` +
        `━━━━━━━━━━━━━━━━━━\n\n` +
        `⚡ *Round is now open — join before the entry window closes!*\n\n` +
        `👉 [Go to Trading Platform](${SITE_URL}/dashboard/trading)\n\n` +
        `_XSPY Trader — Your smart path to financial independence_ 💼✨`
      );
  }
}

// ─── POST /api/admin/bots/signal ──────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      symbol,
      duration_sec,
      payout_percent,
      direction,
    }: {
      symbol: string;
      duration_sec: number;
      payout_percent: number;
      direction: "buy" | "sell";
    } = body;

    if (!symbol || !duration_sec || !payout_percent || !direction) {
      return NextResponse.json(
        { ok: false, error: "Missing required fields: symbol, duration_sec, payout_percent, direction" },
        { status: 400 }
      );
    }

    // Fetch all users with a linked Telegram chat ID
    const { data: profiles, error: profilesError } = await adminClient
      .from("user_profiles")
      .select("uid, telegram_chat_id")
      .not("telegram_chat_id", "is", null)
      .neq("telegram_chat_id", "");

    if (profilesError) {
      return NextResponse.json(
        { ok: false, error: profilesError.message },
        { status: 500 }
      );
    }

    const users = profiles || [];
    let successCount = 0;
    let failureCount = 0;

    // Also fetch group chat IDs from system_settings for group broadcast
    const { data: groupSetting } = await adminClient
      .from("system_settings")
      .select("value")
      .eq("key", "telegram_group_chat_id")
      .maybeSingle();

    const groupChatId = (groupSetting?.value as string) || "";
    const targetGroupIds = groupChatId
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // Broadcast to all linked users
    const sendTasks = users.map(async (profile) => {
      if (!profile.telegram_chat_id) return;
      const message = buildSignalMessage(symbol, duration_sec, payout_percent, direction, "ar");
      const ok = await sendTelegramMessage(profile.telegram_chat_id, message);
      if (ok) successCount++;
      else failureCount++;
    });

    // Also broadcast Arabic version to all target groups
    let groupsSentCount = 0;
    const groupTasks = targetGroupIds.map(async (cid) => {
      const groupMsg = buildSignalMessage(symbol, duration_sec, payout_percent, direction, "ar");
      const ok = await sendTelegramMessage(cid, groupMsg);
      if (ok) groupsSentCount++;
    });

    await Promise.all([...sendTasks, ...groupTasks]);

    // Safely log to admin notifications
    try {
      await adminClient.from("admin_notifications").insert({
        type: "trade_signal_broadcast",
        title: "📢 Trade Signal Broadcast Sent",
        message: `Signal for ${direction.toUpperCase()} on ${symbol} (${duration_sec}s, ${payout_percent}%) sent to ${successCount} users and ${groupsSentCount}/${targetGroupIds.length} groups.`,
        data: { symbol, duration_sec, payout_percent, direction, successCount, failureCount, groupsSentCount, targetGroupIds },
        is_read: false,
        created_at: new Date().toISOString(),
      });
    } catch {}

    return NextResponse.json({
      ok: true,
      successCount,
      failureCount,
      totalUsers: users.length,
      groupBroadcast: groupsSentCount > 0,
      groupsCount: groupsSentCount,
    });
  } catch (error) {
    console.error("[Signal Broadcast Error]", error);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ─── GET — health check ───────────────────────────────────────────────────────
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "POST /api/admin/bots/signal",
    description: "Broadcast a trade signal to all Telegram-linked users",
    requiredBody: {
      symbol: "string (e.g. EUR/USD)",
      duration_sec: "number (e.g. 60)",
      payout_percent: "number (e.g. 2)",
      direction: '"buy" | "sell"',
    },
  });
}
