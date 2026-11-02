import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const SITE_URL = "https://www.xspy-trader.com";

const ALLOWED_DOMAINS = [
  "xspy-trader.com",
  "xspy-trader.vercel.app",
  "t.me/XspyTraderOtp_bot",
  "t.me/XSpyAIBot",
  "t.me/xspy",
];

function checkDescriptionForTamper(text: string): { isTampered: boolean; suspiciousUrls: string[] } {
  if (!text) return { isTampered: false, suspiciousUrls: [] };
  const urlRegex = /(https?:\/\/[^\s]+)|(t\.me\/[^\s]+)/gi;
  const matches = text.match(urlRegex) || [];
  const suspiciousUrls: string[] = [];

  for (const url of matches) {
    const lower = url.toLowerCase();
    if (!ALLOWED_DOMAINS.some((domain) => lower.includes(domain.toLowerCase()))) {
      suspiciousUrls.push(url);
    }
  }

  return {
    isTampered: suspiciousUrls.length > 0,
    suspiciousUrls,
  };
}

async function inspectBot(token: string, expectedWebhookUrl: string, botType: "otp" | "group") {
  if (!token) {
    return {
      configured: false,
      error: "Token not configured in environment variables",
    };
  }

  try {
    const [meRes, webhookRes, descRes, shortDescRes, descArRes, shortDescArRes] = await Promise.all([
      fetch(`https://api.telegram.org/bot${token}/getMe`).then((r) => r.json()),
      fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`).then((r) => r.json()),
      fetch(`https://api.telegram.org/bot${token}/getMyDescription`).then((r) => r.json()),
      fetch(`https://api.telegram.org/bot${token}/getMyShortDescription`).then((r) => r.json()),
      fetch(`https://api.telegram.org/bot${token}/getMyDescription?language_code=ar`).then((r) => r.json()),
      fetch(`https://api.telegram.org/bot${token}/getMyShortDescription?language_code=ar`).then((r) => r.json()),
    ]);

    const me = meRes?.result || null;
    const webhook = webhookRes?.result || null;
    const defaultDesc = descRes?.result?.description || "";
    const defaultShortDesc = shortDescRes?.result?.short_description || "";
    const arDesc = descArRes?.result?.description || "";
    const arShortDesc = shortDescArRes?.result?.short_description || "";

    const combinedText = `${defaultDesc} ${defaultShortDesc} ${arDesc} ${arShortDesc}`;
    const tamperCheck = checkDescriptionForTamper(combinedText);

    const anomalies: string[] = [];
    if (tamperCheck.isTampered) {
      anomalies.push(`Suspicious external links detected in bot description: ${tamperCheck.suspiciousUrls.join(", ")}`);
    }

    const currentWebhookUrl = (webhook?.url || "").trim();
    if (!currentWebhookUrl) {
      anomalies.push("Webhook is NOT set (bot is not receiving incoming messages)");
    } else if (currentWebhookUrl !== expectedWebhookUrl) {
      anomalies.push(`Webhook URL mismatch: currently points to '${currentWebhookUrl}', expected '${expectedWebhookUrl}'`);
    }

    if (webhook?.pending_update_count && webhook.pending_update_count > 15) {
      anomalies.push(`High pending updates backlog (${webhook.pending_update_count} messages queued). Check endpoint response latency.`);
    }

    if (webhook?.last_error_message) {
      anomalies.push(`Telegram reported delivery error: ${webhook.last_error_message}`);
    }

    // Auto-log anomaly to admin_notifications if any
    if (anomalies.length > 0) {
      try {
        await adminClient.from("admin_notifications").insert({
          type: "telegram_anomaly",
          title: `⚠️ Anomaly Detected: @${me?.username || botType}`,
          message: anomalies.join(" | "),
          data: { botType, anomalies, timestamp: new Date().toISOString() },
          is_read: false,
          created_at: new Date().toISOString(),
        });
      } catch {
        // Non-blocking
      }
    }

    return {
      configured: true,
      botType,
      me,
      webhook: {
        url: webhook?.url || "",
        isExpectedUrl: currentWebhookUrl === expectedWebhookUrl,
        hasCustomCertificate: webhook?.has_custom_certificate || false,
        pendingUpdateCount: webhook?.pending_update_count || 0,
        lastErrorDate: webhook?.last_error_date ? new Date(webhook.last_error_date * 1000).toISOString() : null,
        lastErrorMessage: webhook?.last_error_message || null,
        maxConnections: webhook?.max_connections || 40,
        ipAddress: webhook?.ip_address || null,
      },
      descriptions: {
        default: defaultDesc,
        defaultShort: defaultShortDesc,
        ar: arDesc,
        arShort: arShortDesc,
      },
      tamperCheck,
      anomalies,
      isHealthy: anomalies.length === 0,
    };
  } catch (err: any) {
    return {
      configured: true,
      error: err.message || "Failed to inspect bot status",
    };
  }
}

export async function GET(req: NextRequest) {
  try {
    const { getOtpBotToken, getGroupBotToken } = await import("@/lib/telegram-tokens");
    const tokenOtp = getOtpBotToken();
    const tokenGroup = getGroupBotToken();

    const expectedOtpWebhook = `${SITE_URL}/api/telegram/webhook`;
    const expectedGroupWebhook = `${SITE_URL}/api/telegram/group-bot`;

    // Fetch bots status in parallel
    const [otpBot, groupBot, usersStats, recentNotifications] = await Promise.all([
      inspectBot(tokenOtp, expectedOtpWebhook, "otp"),
      inspectBot(tokenGroup, expectedGroupWebhook, "group"),
      adminClient
        .from("user_profiles")
        .select("uid, full_name, email, telegram_chat_id, balance, status, country, created_at")
        .not("telegram_chat_id", "is", null),
      adminClient
        .from("admin_notifications")
        .select("*")
        .or("type.ilike.%telegram%,type.eq.link_violation")
        .order("created_at", { ascending: false })
        .limit(25),
    ]);

    const linkedUsers = usersStats.data || [];
    const totalLinkedUsers = linkedUsers.length;

    const allAnomalies = [
      ...((otpBot as any).anomalies || []),
      ...((groupBot as any).anomalies || []),
    ];

    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      hasAnomalies: allAnomalies.length > 0,
      allAnomalies,
      bots: {
        otpBot,
        groupBot,
      },
      stats: {
        totalLinkedUsers,
        totalNotifications: (recentNotifications.data || []).length,
      },
      recentLogs: recentNotifications.data || [],
    });
  } catch (error: any) {
    console.error("[Admin Bots Status Error]", error);
    return NextResponse.json(
      { status: "error", message: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
