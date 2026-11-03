import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const SITE_URL = "https://www.xspy-trader.com";

import { getOtpBotToken, getGroupBotToken } from "@/lib/telegram-tokens";

function getBotToken(botType: "otp" | "group"): string {
  if (botType === "otp") {
    return getOtpBotToken();
  }
  return getGroupBotToken();
}

const OFFICIAL_DESCRIPTIONS = {
  otp: {
    descEn: `🛡️ XSPY Trader Official Verification Bot\n\nLink your Telegram account to receive instant 2FA OTP security codes for withdrawal confirmation and account protection.\n\nOfficial site: ${SITE_URL}`,
    shortEn: "Official XSPY Trader 2FA Security Bot. Generates Chat ID and sends withdrawal OTP codes.",
    descAr: `🛡️ بوت التحقق والأمان الرسمي لمنصة XSPY Trader\n\nاربط حسابك لتوليد معرف المحادثة (Chat ID) وتلقي رموز الأمان (OTP) الفورية لتأكيد عمليات السحب وحماية أموالك.\n\nالموقع الرسمي: ${SITE_URL}`,
    shortAr: "بوت الأمان الرسمي لمنصة XSPY Trader لتأكيد عمليات السحب وتوليد Chat ID.",
  },
  group: {
    descEn: `🤖 XSPY Trader Official AI Assistant\n\nYour 24/7 intelligent guide for the XSPY Trader platform.\n\nFeatures:\n• Instant support on Deposits, Withdrawals & Trading\n• Real-time investment package calculations\n• Community management & security protection\n• Official site: ${SITE_URL}`,
    shortEn: "Official 24/7 AI Assistant & Community Guide for XSPY Trader.",
    descAr: `🤖 المساعد الذكي الرسمي لمنصة XSPY Trader\n\nدليلك الذكي على مدار الساعة للإجابة على كافة استفسارات المنصة:\n• تفاصيل الإيداع، السحب، وخطوات التداول\n• استعراض باقات الاستثمار والأرباح اليومية\n• حماية المجموعة والرد الفوري على الأعضاء\n• الموقع الرسمي: ${SITE_URL}`,
    shortAr: "المساعد الذكي الرسمي والدعم الفوري على مدار الساعة لمنصة XSPY Trader.",
  },
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, botType, targetChatId, messageText, userId } = body;

    const token = getBotToken(botType || "otp");

    // ── 1. Re-sync Webhook ─────────────────────────────────────────────────────
    if (action === "resync_webhook") {
      const targetUrl =
        botType === "group"
          ? `${SITE_URL}/api/telegram/group-bot`
          : `${SITE_URL}/api/telegram/webhook`;

      if (!token) {
        return NextResponse.json({ ok: false, message: `Token for ${botType} bot is not configured.` }, { status: 400 });
      }

      // First delete webhook with drop_pending_updates to clear any stale error status from Telegram
      await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drop_pending_updates: true }),
      }).catch(() => null);

      const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: targetUrl,
          drop_pending_updates: true,
          max_connections: 40,
        }),
      }).then((r) => r.json());

      const info = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`).then((r) => r.json());

      return NextResponse.json({
        ok: res.ok,
        result: res,
        webhookInfo: info.result,
        targetUrl,
      });
    }

    // ── 2. Sanitize & Reset Bot Profile ─────────────────────────────────────────
    if (action === "sanitize_profile") {
      if (!token) {
        return NextResponse.json({ ok: false, message: `Token for ${botType} bot is not configured.` }, { status: 400 });
      }

      const langsToClear = ["", "en", "ru", "es", "zh", "de", "fr", "it", "pt", "tr", "fa", "hi"];
      for (const lang of langsToClear) {
        await Promise.all([
          fetch(`https://api.telegram.org/bot${token}/setMyDescription`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ description: "", language_code: lang }),
          }).catch(() => null),
          fetch(`https://api.telegram.org/bot${token}/setMyShortDescription`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ short_description: "", language_code: lang }),
          }).catch(() => null),
        ]);
      }

      const texts = OFFICIAL_DESCRIPTIONS[botType as "otp" | "group"] || OFFICIAL_DESCRIPTIONS.otp;

      // Set English / Default
      await fetch(`https://api.telegram.org/bot${token}/setMyDescription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: texts.descEn, language_code: "" }),
      });
      await fetch(`https://api.telegram.org/bot${token}/setMyShortDescription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ short_description: texts.shortEn, language_code: "" }),
      });

      // Set Arabic
      await fetch(`https://api.telegram.org/bot${token}/setMyDescription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: texts.descAr, language_code: "ar" }),
      });
      await fetch(`https://api.telegram.org/bot${token}/setMyShortDescription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ short_description: texts.shortAr, language_code: "ar" }),
      });

      return NextResponse.json({
        ok: true,
        message: `Profile descriptions for @${botType} sanitized and reset to official branding.`,
      });
    }

    // ── 3. Send Message / Broadcast ────────────────────────────────────────────
    if (action === "send_message") {
      if (!messageText || !messageText.trim()) {
        return NextResponse.json({ ok: false, message: "Message text is required" }, { status: 400 });
      }

      if (!token) {
        return NextResponse.json({ ok: false, message: "Bot token not configured" }, { status: 400 });
      }

      if (targetChatId) {
        // Direct message to one user
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: targetChatId,
            text: messageText,
            parse_mode: "Markdown",
          }),
        }).then((r) => r.json());

        return NextResponse.json({
          ok: res.ok,
          result: res,
          recipient: targetChatId,
        });
      }

      // Broadcast to ALL linked users
      const { data: users } = await adminClient
        .from("user_profiles")
        .select("telegram_chat_id, full_name")
        .not("telegram_chat_id", "is", null);

      if (!users || users.length === 0) {
        return NextResponse.json({ ok: false, message: "No linked Telegram users found" }, { status: 404 });
      }

      let successCount = 0;
      let failureCount = 0;

      for (const u of users) {
        if (!u.telegram_chat_id) continue;
        try {
          const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: u.telegram_chat_id,
              text: messageText,
              parse_mode: "Markdown",
            }),
          }).then((r) => r.json());

          if (res.ok) successCount++;
          else failureCount++;
        } catch {
          failureCount++;
        }
      }

      // Log notification safely
      try {
        await adminClient.from("admin_notifications").insert({
          type: "telegram_broadcast",
          title: `📢 Telegram Broadcast Sent via @${botType}`,
          message: `Broadcast delivered to ${successCount} users (${failureCount} failed).`,
          data: { messageText, successCount, failureCount, timestamp: new Date().toISOString() },
          is_read: false,
          created_at: new Date().toISOString(),
        });
      } catch {}

      return NextResponse.json({
        ok: true,
        successCount,
        failureCount,
        total: users.length,
      });
    }

    // ── 4. Unlink User Telegram ────────────────────────────────────────────────
    if (action === "unlink_user") {
      if (!userId) {
        return NextResponse.json({ ok: false, message: "User ID required" }, { status: 400 });
      }

      const { error } = await adminClient
        .from("user_profiles")
        .update({ telegram_chat_id: null })
        .eq("uid", userId);

      if (error) {
        return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true, message: "Telegram account unlinked successfully." });
    }

    // ── 5. Test Ping ───────────────────────────────────────────────────────────
    if (action === "test_ping") {
      const startTime = Date.now();
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`).then((r) => r.json());
      const latencyMs = Date.now() - startTime;

      return NextResponse.json({
        ok: res.ok,
        latencyMs,
        bot: res.result || null,
      });
    }

    return NextResponse.json({ ok: false, message: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    console.error("[Admin Bots Control Error]", err);
    return NextResponse.json({ ok: false, message: err.message || "Execution error" }, { status: 500 });
  }
}
