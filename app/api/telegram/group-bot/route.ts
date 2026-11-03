import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  PLATFORM_KNOWLEDGE,
  SITE_URL,
  OFFICIAL_REF_LINK,
  getLivePlatformKnowledge,
} from "@/lib/telegram-bot-knowledge";

// ─── Admin Supabase Client ────────────────────────────────────────────────────
const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

import { getGroupBotToken } from "@/lib/telegram-tokens";

const BOT_TOKEN = getGroupBotToken();
const OTP_BOT_USERNAME = "@XSpyTraderOtp_bot";
const GEMINI_API_KEY = (
  process.env.GEMINI_API_KEY ||
  process.env.NEXT_PUBLIC_GEMINI_API_KEY ||
  ""
).trim();

// ─── Rate Limiting (in-memory, per deployment instance) ──────────────────────
const rateLimitMap = new Map<number, number>();
const RATE_LIMIT_WINDOW_MS = 15000; // 15 seconds between AI responses per user

function isRateLimited(userId: number): boolean {
  const lastResponse = rateLimitMap.get(userId);
  if (lastResponse && Date.now() - lastResponse < RATE_LIMIT_WINDOW_MS) {
    return true;
  }
  rateLimitMap.set(userId, Date.now());
  return false;
}

// ─── Debug GET endpoint ───────────────────────────────────────────────────────
export async function GET() {
  await registerBotCommands().catch(() => {});
  return NextResponse.json({
    status: "ok",
    bot: "XSpyAIBot (Group Bot)",
    hasBotToken: !!BOT_TOKEN,
    botTokenPrefix: BOT_TOKEN ? BOT_TOKEN.substring(0, 10) + "..." : "NOT SET",
    hasGeminiKey: !!GEMINI_API_KEY,
    geminiKeyPrefix: GEMINI_API_KEY
      ? GEMINI_API_KEY.substring(0, 10) + "..."
      : "NOT SET",
    model: "gemini-flash-latest",
    version: "v9",
    commandsRegistered: true,
  });
}

// ─── URL Detection & Spam Guard ──────────────────────────────────────────────
const ALLOWED_DOMAINS = [
  "xspy-trader.com",
  "xspy-trader.vercel.app",
  "xspy_trader",
  "xspytrader",
  "t.me/xspytraderbot",
  "t.me/xspytraderotp_bot",
  "t.me/xspytraderbot",
  "t.me/xspy_ai_bot",
  "t.me/xspyaibot",
];

function containsExternalLink(text: string): boolean {
  const urlRegex = /(https?:\/\/[^\s]+)|(t\.me\/[^\s]+)/gi;
  const matches = text.match(urlRegex) || [];

  for (const url of matches) {
    const lower = url.toLowerCase();
    if (ALLOWED_DOMAINS.some((domain) => lower.includes(domain))) continue;
    return true;
  }
  return false;
}

// ─── Advanced Anti-Fraud & Staff Impersonation Detection ─────────────────────
function containsImpersonationAttempt(text: string): boolean {
  const lower = text.toLowerCase();

  const impersonationTriggers = [
    // Arabic support impersonation / phishing
    "انا الدعم",
    "أنا الدعم",
    "خدمة العملاء",
    "فريق الدعم",
    "ادارة المنصة",
    "إدارة المنصة",
    "ادمن المنصة",
    "أدمن المنصة",
    "أنا المدير",
    "انا المدير",
    "أنا المشرف",
    "انا المشرف",
    "مسؤول الدعم",
    "موظف المنصة",
    "كلمني خاص",
    "تواصل معي خاص",
    "راسلني خاص",
    "تعال خاص",
    "ابعتلي خاص",
    "ارسل كود",
    "أرسل الكود",
    "رمز السحب",
    "كود التحقق",
    "رمز التحقق",
    "كلمة المرور",
    "كلمات المرور",
    "هات الكود",
    "ابعث الكود",
    // English
    "i am admin",
    "i am support",
    "official support",
    "xspy support",
    "xspy admin",
    "support agent",
    "head of support",
    "i work at xspy",
    "contact me in dm",
    "dm me for help",
    "send me your code",
    "give me your otp",
    "send me private message",
    "text me privately",
    "send your credentials",
    "send me your seed",
    // French
    "je suis le support",
    "admin officiel",
    "support officiel",
    "écrivez-moi en privé",
    "envoyez votre code",
    // German
    "ich bin der support",
    "offizieller support",
    "schreib mir privat",
    "sende deinen code",
    // Russian
    "я поддержка",
    "я администратор",
    "официальная поддержка",
    "напиши мне в лс",
    "отправь свой код",
  ];

  return impersonationTriggers.some((trigger) => lower.includes(trigger));
}

// ─── Telegram API Helper ──────────────────────────────────────────────────────
async function callTelegram(method: string, body: object) {
  const res = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return res.json();
}

// ─── Register Telegram Bot Commands Menu ───────────────────────────────────────
async function registerBotCommands() {
  try {
    const commands = [
      { command: "start", description: "🚀 القائمة الرئيسية / Main Menu" },
      { command: "deals", description: "📊 صفقات اليوم / Today's Trades" },
      { command: "packages", description: "⛏️ باقات التعدين / Mining Packages" },
      { command: "referral", description: "🤝 نظام الإحالة / Referral System" },
      { command: "register", description: "📝 فتح حساب جديد / Register Account" },
      { command: "help", description: "🆘 المساعدة والتعليمات / Help & FAQ" },
    ];
    await callTelegram("setMyCommands", { commands });
  } catch {}
}

// ─── Send Message (with Markdown fallback) ────────────────────────────────────
async function sendMessage(
  chatId: number | string,
  text: string,
  options: {
    replyToMessageId?: number;
    replyMarkup?: object;
    parseMode?: "Markdown" | "HTML" | "MarkdownV2";
  } = {}
) {
  const { replyToMessageId, replyMarkup, parseMode = "Markdown" } = options;

  let res = await callTelegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: parseMode,
    ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });

  // Fallback to plaintext if Markdown parsing fails
  if (!res.ok) {
    console.warn(`[GroupBot] Parse mode failed, retrying plaintext. Error:`, res.description);
    res = await callTelegram("sendMessage", {
      chat_id: chatId,
      text,
      ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }
  return res;
}

// ─── Delete Message ───────────────────────────────────────────────────────────
async function deleteMessage(chatId: number | string, messageId: number) {
  return callTelegram("deleteMessage", {
    chat_id: chatId,
    message_id: messageId,
  });
}

// ─── Mute User (restrict permissions for 24h) ─────────────────────────────────
async function muteUser(chatId: number | string, userId: number) {
  const until = Math.floor(Date.now() / 1000) + 86400;
  return callTelegram("restrictChatMember", {
    chat_id: chatId,
    user_id: userId,
    permissions: {
      can_send_messages: false,
      can_send_audios: false,
      can_send_documents: false,
      can_send_photos: false,
      can_send_videos: false,
      can_send_video_notes: false,
      can_send_voice_notes: false,
      can_send_polls: false,
      can_send_other_messages: false,
      can_add_web_page_previews: false,
    },
    until_date: until,
  });
}

// ─── Ban User On Platform for 24h ────────────────────────────────────────────
async function banUserOnSite(telegramUserId: number): Promise<boolean> {
  try {
    const bannedUntil = new Date(Date.now() + 86400 * 1000).toISOString();

    const { data: profile } = await adminClient
      .from("user_profiles")
      .select("uid")
      .eq("telegram_chat_id", String(telegramUserId))
      .single();

    if (profile?.uid) {
      await adminClient
        .from("user_profiles")
        .update({
          status: "banned",
          banned_until: bannedUntil,
          ban_reason: "Posting external links in the official Telegram group",
        })
        .eq("uid", profile.uid);
      return true;
    }
  } catch (err) {
    console.error("[GroupBot] Failed to ban user on site:", err);
  }
  return false;
}

// ─── Log Admin Notification ───────────────────────────────────────────────────
async function logAdminNotification(
  type: string,
  title: string,
  message: string,
  data?: object
) {
  try {
    await adminClient.from("admin_notifications").insert({
      type,
      title,
      message,
      data: data || {},
      is_read: false,
      created_at: new Date().toISOString(),
    });
  } catch {
    // Non-critical — swallow error silently
  }
}

// ─── Supported Languages ──────────────────────────────────────────────────────
export type SupportedLang = "ar" | "en" | "fr" | "de" | "ru";

interface BotResponse {
  text: string;
  replyMarkup?: object;
}

// ─── Language Detection ───────────────────────────────────────────────────────
function detectLanguage(text: string, userLang?: string): SupportedLang {
  // 1. Script checks take highest priority
  if (/[\u0600-\u06FF]/.test(text)) return "ar";
  if (/[\u0400-\u04FF]/.test(text)) return "ru";

  const lower = (text || "").toLowerCase();

  // 2. Keyword detection for Latin-script languages
  if (
    /\b(bonjour|salut|retrait|retirer|depot|dépôt|déposer|comment|pourquoi|combien|parrainage|compte|sécurité|securite|argent|gagner|investir|merci)\b/i.test(
      lower
    )
  ) {
    return "fr";
  }

  if (
    /\b(hallo|guten|auszahlung|auszahlen|einzahlung|einzahlen|wie|warum|wieviel|überweisung|konto|sicherheit|geld|verdienen|anlegen|danke)\b/i.test(
      lower
    )
  ) {
    return "de";
  }

  // 3. User's Telegram interface language code
  const code = (userLang || "").toLowerCase();
  if (code.startsWith("ar")) return "ar";
  if (code.startsWith("fr")) return "fr";
  if (code.startsWith("de")) return "de";
  if (code.startsWith("ru")) return "ru";

  return "en";
}

// ─── Inline Keyboards ─────────────────────────────────────────────────────────
function buildWithdrawalInlineKeyboard(lang: SupportedLang) {
  const labels: Record<
    SupportedLang,
    { withdraw: string; profile: string }
  > = {
    ar: {
      withdraw: "💸 التوجه لصفحة السحب",
      profile: "👤 تأكيد بيانات الملف الشخصي",
    },
    en: {
      withdraw: "💸 Go to Withdraw Page",
      profile: "👤 Verify Profile Details",
    },
    fr: {
      withdraw: "💸 Page de retrait",
      profile: "👤 Mon Profil",
    },
    de: {
      withdraw: "💸 Auszahlungsseite öffnen",
      profile: "👤 Mein Profil",
    },
    ru: {
      withdraw: "💸 Перейти к выводу",
      profile: "👤 Настройки профиля",
    },
  };
  const l = labels[lang] || labels.en;
  return {
    inline_keyboard: [
      [{ text: l.withdraw, url: `${SITE_URL}/dashboard/withdraw` }],
      [{ text: l.profile, url: `${SITE_URL}/dashboard/profile` }],
    ],
  };
}

function buildVerificationInlineKeyboard(lang: SupportedLang) {
  const labels: Record<SupportedLang, { bot: string; profile: string }> = {
    ar: { bot: "💬 تفعيل إشعارات تيليجرام", profile: "👤 فتح الملف الشخصي" },
    en: { bot: "💬 Enable Telegram Alerts", profile: "👤 Open Profile" },
    fr: {
      bot: "💬 Alertes Telegram",
      profile: "👤 Ouvrir le Profil",
    },
    de: { bot: "💬 Telegram Benachrichtigungen", profile: "👤 Profil öffnen" },
    ru: {
      bot: "💬 Уведомления Telegram",
      profile: "👤 Открыть профиль",
    },
  };
  const l = labels[lang] || labels.en;
  return {
    inline_keyboard: [
      [{ text: l.bot, url: "https://t.me/XSpyTraderOtp_bot" }],
      [{ text: l.profile, url: `${SITE_URL}/dashboard/profile` }],
    ],
  };
}

function buildDepositInlineKeyboard(lang: SupportedLang) {
  const labels: Record<SupportedLang, string> = {
    ar: "💰 التوجه لصفحة الإيداع",
    en: "💰 Go to Deposit Page",
    fr: "💰 Aller sur la page de dépôt",
    de: "💰 Zur Einzahlungsseite",
    ru: "💰 Перейти к пополнению",
  };
  return {
    inline_keyboard: [
      [{ text: labels[lang] || labels.en, url: `${SITE_URL}/dashboard/deposit` }],
    ],
  };
}

function buildTradingInlineKeyboard(lang: SupportedLang) {
  const labels: Record<SupportedLang, string> = {
    ar: "📊 التوجه لصفحة التداول",
    en: "📊 Go to Trading Page",
    fr: "📊 Aller sur la page de trading",
    de: "📊 Zur Trading-Seite",
    ru: "📊 Перейти к сделкам",
  };
  return {
    inline_keyboard: [
      [{ text: labels[lang] || labels.en, url: `${SITE_URL}/dashboard/trading` }],
    ],
  };
}

function buildPackagesInlineKeyboard(lang: SupportedLang) {
  const labels: Record<SupportedLang, string> = {
    ar: "⛏️ تصفح باقات الاستثمار",
    en: "⛏️ View Investment Packages",
    fr: "⛏️ Voir les packs d'investissement",
    de: "⛏️ Pakete ansehen",
    ru: "⛏️ Посмотреть пакеты",
  };
  return {
    inline_keyboard: [
      [{ text: labels[lang] || labels.en, url: `${SITE_URL}/dashboard/packages` }],
    ],
  };
}

function buildReferralsInlineKeyboard(lang: SupportedLang) {
  const labels: Record<SupportedLang, string> = {
    ar: "🤝 صفحة الإحالات وفريقي",
    en: "🤝 My Referrals & Team",
    fr: "🤝 Mes parrainages et équipe",
    de: "🤝 Meine Partner & Team",
    ru: "🤝 Моя партнёрская сеть",
  };
  return {
    inline_keyboard: [
      [{ text: labels[lang] || labels.en, url: `${SITE_URL}/dashboard/referrals` }],
    ],
  };
}

function buildRegisterInlineKeyboard(lang: SupportedLang) {
  const labels: Record<SupportedLang, string> = {
    ar: "📝 فتح حساب جديد الآن",
    en: "📝 Create Account Now",
    fr: "📝 Créer un compte maintenant",
    de: "📝 Jetzt Konto eröffnen",
    ru: "📝 Зарегистрироваться сейчас",
  };
  return {
    inline_keyboard: [
      [{ text: labels[lang] || labels.en, url: OFFICIAL_REF_LINK }],
    ],
  };
}

// ─── Persistent Reply Keyboard ────────────────────────────────────────────────
function buildPersistentReplyKeyboard(lang: SupportedLang) {
  const keyboards: Record<
    SupportedLang,
    { deals: string; packages: string; referral: string; register: string }
  > = {
    ar: {
      deals: "📊 صفقات اليوم",
      packages: "⛏️ باقات التعدين",
      referral: "🤝 نظام الإحالة",
      register: "🚀 تسجيل حساب",
    },
    en: {
      deals: "📊 Today's Trades",
      packages: "⛏️ Mining Packages",
      referral: "🤝 Referral System",
      register: "🚀 Register Account",
    },
    fr: {
      deals: "📊 Trades du jour",
      packages: "⛏️ Packs Minage",
      referral: "🤝 Parrainage",
      register: "🚀 Inscription",
    },
    de: {
      deals: "📊 Heutige Trades",
      packages: "⛏️ Mining-Pakete",
      referral: "🤝 Empfehlungssystem",
      register: "🚀 Registrieren",
    },
    ru: {
      deals: "📊 Сделки сегодня",
      packages: "⛏️ Майнинг пакеты",
      referral: "🤝 Реферальная система",
      register: "🚀 Регистрация",
    },
  };

  const k = keyboards[lang] || keyboards.en;
  return {
    keyboard: [
      [{ text: k.deals }, { text: k.packages }],
      [{ text: k.referral }, { text: k.register }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

function isDealsButton(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    t.includes("صفقات اليوم") ||
    t.includes("today's trades") ||
    t.includes("trades du jour") ||
    t.includes("heutige trades") ||
    t.includes("сделки сегодня") ||
    t === "/deals" ||
    t === "/trade" ||
    t === "/trades"
  );
}

function isPackagesButton(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    t.includes("باقات التعدين") ||
    t.includes("mining packages") ||
    t.includes("packs minage") ||
    t.includes("mining-pakete") ||
    t.includes("майнинг пакеты") ||
    t === "/packages" ||
    t === "/mining"
  );
}

function isReferralButton(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    t.includes("نظام الإحالة") ||
    t.includes("برنامج الإحالة") ||
    t.includes("referral system") ||
    t.includes("parrainage") ||
    t.includes("empfehlungssystem") ||
    t.includes("реферальная система") ||
    t === "/referral" ||
    t === "/referrals"
  );
}

function isRegisterButton(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    t.includes("تسجيل حساب") ||
    t.includes("register account") ||
    t.includes("inscription") ||
    t.includes("registrieren") ||
    t.includes("регистрация") ||
    t === "/register"
  );
}

function isWithdrawalQuery(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("withdraw") ||
    lower.includes("سحب") ||
    lower.includes("السحب") ||
    lower.includes("اسحب") ||
    lower.includes("retrait") ||
    lower.includes("retirer") ||
    lower.includes("auszahlung") ||
    lower.includes("auszahlen") ||
    lower.includes("abheben") ||
    lower.includes("вывод") ||
    lower.includes("вывести")
  );
}

// ─── Multilingual Knowledge Dictionary ────────────────────────────────────────
const FALLBACK_CONTENT: Record<
  SupportedLang,
  {
    withdraw: string;
    deposit: string;
    trade: string;
    package: string;
    referral: string;
    register: string;
    verify: string;
    defaultSupport: string;
  }
> = {
  ar: {
    withdraw:
      `💸 *طريقة وشروط السحب من منصة XSPY Trader*\n\n` +
      `*الحد الأدنى للسحب:* $21 | *الرسوم:* 8% فقط | *وقت المعالجة:* من 1 إلى 24 ساعة كحد أقصى\n` +
      `⚠️ *الحد الأقصى للتكرار:* يُسمح بطلب سحب واحد فقط كل 24 ساعة.\n\n` +
      `📋 *خطوات السحب والأمان:*\n` +
      `1️⃣ *تأكيد بيانات الملف الشخصي:* تأكد من ملء وتأكيد بيانات ملفك الشخصي بالكامل أولاً.\n` +
      `2️⃣ *إضافة عنوان محفظة السحب:* من قسم *المحفظة › إدارة المحافظ* (المحافظ الجديدة تخضع لحماية 24 ساعة).\n` +
      `3️⃣ *طلب السحب وتأكيد الأمان:* توجه إلى *المحفظة › سحب*، اختر محفظتك وأدخل المبلغ ($21 فأكثر).\n` +
      `4️⃣ *رمز التحقق (Gmail OTP):* ستتلقى رمز أمان سري مكون من 6 أرقام مباشرة على بريدك الإلكتروني المسجل (Gmail). أدخل الرمز لتأكيد السحب فوراً.\n\n` +
      `🔒 *ملاحظة هامة:* السحب مؤمن حصرياً عبر رمز التحقق المرسل لبريدك الإلكتروني (Gmail). لا تشارك رمزك مع أحد!\n\n` +
      `🌐 *صفحة السحب:* ${SITE_URL}/dashboard/withdraw`,

    deposit:
      `💰 *طريقة الإيداع في منصة XSPY Trader*\n\n` +
      `*الحد الأدنى للإيداع:* $51 فقط للبدء.\n\n` +
      `📋 *خطوات شحن الرصيد:*\n` +
      `1️⃣ توجه إلى *لوحة التحكم › المحفظة › إيداع*\n` +
      `2️⃣ اختر شبكة العملة الرقمية (USDT TRC20, BEP20, BTC وغيرها)\n` +
      `3️⃣ انسخ عنوان المحفظة المعروض بدقة وقم بالتحويل من محفظتك الشخصية\n` +
      `4️⃣ قم برفع لقطة شاشة للتحويل المكتمل مع رمز المعاملة (TXID)\n\n` +
      `⏱ *وقت التأكيد:* يتم التأكيد خلال 5 إلى 15 دقيقة بعد المراجعة.\n\n` +
      `🌐 *صفحة الإيداع:* ${SITE_URL}/dashboard/deposit`,

    trade:
      `📊 *نظام التداول اليومي في منصة XSPY Trader*\n\n` +
      `صفقات تداول يومية مضمونة ومدروسة تفتحها الإدارة من الإثنين إلى الجمعة:\n\n` +
      `📈 *نسب الأرباح حسب مدة الصفقة:*\n` +
      `⏱ صفقة 30 ثانية: *ربح 2%*\n` +
      `⏱ صفقة 45 ثانية: *ربح 2.5%*\n` +
      `⏱ صفقة 60 ثانية: *ربح 3%*\n\n` +
      `📋 *طريقة المشاركة:*\n` +
      `1️⃣ تفتح الإدارة الصفقة اليومية وتعلن عنها للأعضاء.\n` +
      `2️⃣ ادخل إلى *لوحة التحكم › التداول* وانضم للصفقة النشطة بالمبلغ الذي تريده.\n` +
      `3️⃣ بعد انتهاء الثواني المحددة تُضاف الأرباح مباشرة إلى رصيدك.\n\n` +
      `💡 *مثال:* دخول صفقة 60 ثانية بمبلغ $100 = ربح $3 صافي خلال دقيقة واحدة (الإجمالي $103)!\n\n` +
      `🌐 *صفحة التداول:* ${SITE_URL}/dashboard/trading`,

    package:
      `⛏️ *باقات التعدين والاستثمار في XSPY Trader*\n\n` +
      `اختر الباقة المناسبة لأهدافك واحصل على أرباح يومية مضافة كل 24 ساعة:\n\n` +
      `1️⃣ *باقة المبتدئين (Beginner Package):*\n` +
      `💵 الاستثمار: $51 إلى $100 | 🔹 العمولة اليومية: *1.5%* | ⏳ المدة: *7 أيام*\n\n` +
      `2️⃣ *الباقة الاحترافية (Professional Plan):*\n` +
      `💵 الاستثمار: $101 إلى $150 | 🔹 العمولة اليومية: *1.8%* | ⏳ المدة: *18 يوماً*\n\n` +
      `3️⃣ *باقة كبار المستثمرين (VIP Plan):*\n` +
      `💵 الاستثمار: $151 إلى $200 | 🔹 العمولة اليومية: *2.0%* | ⏳ المدة: *30 يوماً*\n\n` +
      `🔹 *نظام توزيع الأرباح:* تُضاف الأرباح إلى رصيدك كل 24 ساعة من لحظة التفعيل، وعند نهاية مدة الباقة يعود رأس المال الأساسي بالكامل إلى رصيدك.\n\n` +
      `🌐 *صفحة باقات التعدين:* ${SITE_URL}/dashboard/packages`,

    referral:
      `🤝 *نظام الإحالات وفريق العمل في XSPY Trader*\n\n` +
      `نظام مكافآت متعدد المستويات يمنحك أرباحاً عبر 3 طرق مختلفة:\n\n` +
      `🎁 *1. أرباح الإحالات الأساسية (من الإيداعات):*\n` +
      `🥇 المستوى الأول: *7%*\n` +
      `🥈 المستوى الثاني: *4%*\n` +
      `🥉 المستوى الثالث: *2%*\n\n` +
      `📈 *2. أرباح إحالات التداول (من أرباح صفقات فريقك):*\n` +
      `🥇 المستوى الأول: *7%*\n` +
      `🥈 المستوى الثاني: *4%*\n` +
      `🥉 المستوى الثالث: *2%*\n\n` +
      `📦 *3. أرباح إحالات باقات التعدين (من خطط تعدين فريقك):*\n` +
      `🥇 المستوى الأول: *7%*\n` +
      `🥈 المستوى الثاني: *4%*\n` +
      `🥉 المستوى الثالث: *2%*\n\n` +
      `🔗 *رابط إحالتك ومتابعة الفريق:* ${SITE_URL}/dashboard/referrals`,

    register:
      `🚀 *التسجيل وبدء الاستثمار في XSPY Trader*\n\n` +
      `ابدأ رحلتك نحو الأرباح اليومية والحرية المالية مع منصة XSPY Trader!\n\n` +
      `🌐 *رابط التسجيل الرسمي المباشر:* 👉 ${OFFICIAL_REF_LINK} 👈\n\n` +
      `💵 *الحد الأدنى للإيداع:* $51 فقط\n` +
      `💸 *الحد الأدنى للسحب:* $21 فقط (برسوم 8% فقط)\n` +
      `📊 *صفقات تداول يومية:* أرباح 2% إلى 3% في ثوانٍ معدودة\n` +
      `⛏️ *باقات تعدين:* عوائد يومية 1.5% حتى 2% مضافة كل 24 ساعة مع استرداد رأس المال بالكامل\n\n` +
      `🔗 *سجل الآن:* ${OFFICIAL_REF_LINK}`,

    verify:
      `🔐 *الأمان والتحقق في منصة XSPY Trader*\n\n` +
      `🛡️ *تأكيد السحب الأمني:* يتم تأكيد عمليات السحب حصرياً وبأعلى معايير الأمان عبر كود تأكيد سري (OTP) يُرسل مباشرةً إلى *بريدك الإلكتروني (Gmail)* المسجل.\n\n` +
      `💬 *ربط تيليجرام (اختياري للإشعارات والتنبيهات):*\n` +
      `يمكنك ربط حسابك ببوت الإشعارات [@XSpyTraderOtp_bot](https://t.me/XSpyTraderOtp_bot) لاستلام إشعارات الصفقات اليومية وتنبيهات الحساب الفورية.\n` +
      `1️⃣ افتح البوت واضغط *START*\n` +
      `2️⃣ انسخ رقم الـ *Chat ID*\n` +
      `3️⃣ الصقه في ملفك الشخصي: ${SITE_URL}/dashboard/profile واضغط حفظ.\n\n` +
      `⚠️ *تنبيه أمني:* لا تشارك أي رموز تحقق مع أي شخص إطلاقاً!`,

    defaultSupport:
      `🤖 *المساعد الذكي الرسمي لمنصة XSPY Trader*\n\n` +
      `أهلاً بك! أنا في خدمتك على مدار الساعة للإجابة على استفساراتك حول:\n\n` +
      `📊 *التداول اليومي (2% - 3%)*\n` +
      `⛏️ *باقات التعدين اليومية (1.5% - 2%)*\n` +
      `🤝 *نظام الإحالات (7% - 4% - 2%)*\n` +
      `💰 *الإيداع ($51 كحد أدنى)* | 💸 *السحب ($21 برسم 8%)*\n\n` +
      `🌐 *رابط التسجيل الرسمي:* ${OFFICIAL_REF_LINK}`,
  },

  en: {
    withdraw:
      `💸 *Withdrawal Policy & Guide — XSPY Trader*\n\n` +
      `*Minimum Withdrawal:* $21 | *Fee:* 8% only | *Processing Time:* 1 to 24 hours max\n` +
      `⚠️ *Frequency:* Only 1 withdrawal per 24 hours is permitted.\n\n` +
      `📋 *Withdrawal Steps:*\n` +
      `1️⃣ *Verify Profile:* Make sure your profile details are fully filled and saved.\n` +
      `2️⃣ *Add Wallet:* Under *Wallet › Manage Wallets* (newly added wallets have a 24h security hold).\n` +
      `3️⃣ *Submit Request:* Go to *Wallet › Withdraw*, select your wallet, and enter amount ($21+).\n` +
      `4️⃣ *Email OTP Authorization:* A secure 6-digit confirmation code will be dispatched to your registered **Gmail** address. Enter the code to authorize your payout.\n\n` +
      `🔒 *Note:* Withdrawals are protected exclusively via Gmail OTP. Never share your security code with anyone!\n\n` +
      `🌐 *Withdrawal Page:* ${SITE_URL}/dashboard/withdraw`,

    deposit:
      `💰 *How to Deposit on XSPY Trader*\n\n` +
      `*Minimum Deposit:* $51 to get started.\n\n` +
      `📋 *Deposit Steps:*\n` +
      `1️⃣ Go to *Dashboard › Wallet › Deposit*\n` +
      `2️⃣ Select your preferred crypto network (USDT TRC20, BEP20, BTC, ETH, etc.)\n` +
      `3️⃣ Copy the displayed wallet address and transfer from your personal wallet\n` +
      `4️⃣ Upload the transaction receipt screenshot and TXID\n\n` +
      `⏱ *Confirmation Time:* 5–15 minutes after review.\n\n` +
      `🌐 *Deposit Page:* ${SITE_URL}/dashboard/deposit`,

    trade:
      `📊 *Daily Trading Deals on XSPY Trader*\n\n` +
      `Guaranteed daily trading deals opened by administration (Monday through Friday) with high profit margins:\n\n` +
      `⏱️ *30-second trade:* *2% profit*\n` +
      `⏱️ *45-second trade:* *2.5% profit*\n` +
      `⏱️ *60-second trade:* *3% profit*\n\n` +
      `📋 *How to Participate:*\n` +
      `1️⃣ When the daily session is announced, go to *Dashboard › Trading*\n` +
      `2️⃣ Enter your desired stake and join the live round\n` +
      `3️⃣ Profits are credited instantly to your account balance upon expiration!\n\n` +
      `💡 *Example:* Joining a 60-second trade with $100 earns +$3 net profit in 60 seconds (Total: $103).\n\n` +
      `🌐 *Trading Page:* ${SITE_URL}/dashboard/trading`,

    package:
      `⛏️ *Mining Packages on XSPY Trader*\n\n` +
      `Choose a package to earn automated daily earnings credited every 24 hours:\n\n` +
      `1️⃣ *Beginner Package:*\n` +
      `💵 Investment: $51 to $100 | 🔹 Daily Commission: *1.5%* | ⏳ Duration: *7 days*\n\n` +
      `2️⃣ *Professional Plan:*\n` +
      `💵 Investment: $101 to $150 | 🔹 Daily Commission: *1.8%* | ⏳ Duration: *18 days*\n\n` +
      `3️⃣ *VIP Plan:*\n` +
      `💵 Investment: $151 to $200 | 🔹 Daily Commission: *2.0%* | ⏳ Duration: *30 days*\n\n` +
      `🔹 *Daily Profit System:* Earnings are credited directly to your balance every 24 hours. At package completion, your initial principal investment is fully returned!\n\n` +
      `🌐 *Packages Page:* ${SITE_URL}/dashboard/packages`,

    referral:
      `🤝 *Referral Program on XSPY Trader*\n\n` +
      `Earn generous rewards across 3 streams and 3 team levels:\n\n` +
      `🎁 *1. Basic Deposit Referrals:*\n` +
      `🥇 Level 1: *7%* | 🥈 Level 2: *4%* | 🥉 Level 3: *2%*\n\n` +
      `📈 *2. Trading Referral Earnings (from team's profits):*\n` +
      `🥇 Level 1: *7%* | 🥈 Level 2: *4%* | 🥉 Level 3: *2%*\n\n` +
      `📦 *3. Mining Plan Referral Earnings:*\n` +
      `🥇 Level 1: *7%* | 🥈 Level 2: *4%* | 🥉 Level 3: *2%*\n\n` +
      `🔗 *Your Referral Link:* ${SITE_URL}/dashboard/referrals`,

    register:
      `🚀 *Join XSPY Trader Today*\n\n` +
      `Your ideal gateway into the world of digital investment and daily profits!\n\n` +
      `🌐 *Official Registration Link:* 👉 ${OFFICIAL_REF_LINK} 👈\n\n` +
      `💵 *Minimum Deposit:* $51\n` +
      `💸 *Minimum Withdrawal:* $21 (8% fee)\n` +
      `📊 *Daily Trades:* 2% to 3% profit in seconds\n` +
      `⛏️ *Mining Packages:* 1.5% to 2% daily + principal back\n\n` +
      `🔗 *Register here:* ${OFFICIAL_REF_LINK}`,

    verify:
      `🔐 *Security & Verification on XSPY Trader*\n\n` +
      `🛡️ *Withdrawal Authorization:* All withdrawals are verified **exclusively via Gmail OTP** sent to your registered email address.\n\n` +
      `💬 *Telegram Bot Linking (Optional for Alerts):*\n` +
      `Link [@XSpyTraderOtp_bot](https://t.me/XSpyTraderOtp_bot) to receive live trade announcements, round reminders, and platform notifications directly on Telegram.\n` +
      `1️⃣ Open [@XSpyTraderOtp_bot](https://t.me/XSpyTraderOtp_bot) and click *START*\n` +
      `2️⃣ Copy your *Chat ID*\n` +
      `3️⃣ Paste in your profile: ${SITE_URL}/dashboard/profile and save.\n\n` +
      `⚠️ *Alert:* Never share verification codes with anyone!`,

    defaultSupport:
      `🤖 *XSPY Trader Official Support AI*\n\n` +
      `Welcome! I am here 24/7 to help you with:\n\n` +
      `📊 *Daily Trading (2% - 3%)*\n` +
      `⛏️ *Mining Packages (1.5% - 2% daily, 7-30 days)*\n` +
      `🤝 *3-Tier Referral Rewards (7% - 4% - 2%)*\n` +
      `💰 *Deposits ($51 min)* | 💸 *Withdrawals ($21 min, 8% fee)*\n\n` +
      `🌐 *Register:* ${OFFICIAL_REF_LINK}`,
  },

  fr: {
    withdraw:
      `💸 *Comment effectuer un retrait sur XSPY Trader*\n\n` +
      `*Minimum :* 21 $ | *Frais :* 8 % seulement | *Délai de traitement :* 1h à 24h maximum\n` +
      `⚠️ *Limite :* Un seul retrait toutes les 24 heures est autorisé.\n\n` +
      `📋 *Étapes de retrait et sécurité :*\n` +
      `1️⃣ *Complétez votre profil :* Vos informations doivent être enregistrées.\n` +
      `2️⃣ *Portefeuille de retrait :* Dans *Portefeuille › Gérer les portefeuilles* (délai de sécurité de 24h pour les nouveaux ajouts).\n` +
      `3️⃣ *Demande de retrait :* Dans *Portefeuille › Retirer*, sélectionnez votre adresse et saisissez le montant (min 21 $).\n` +
      `4️⃣ *Validation par Gmail OTP :* Un code de sécurité secret à 6 chiffres est envoyé directement sur votre adresse **Gmail** enregistrée pour valider la transaction.\n\n` +
      `🔒 *Sécurité :* Le retrait est protégé exclusivement par votre code Gmail. Ne le partagez jamais !\n\n` +
      `🌐 *Page de retrait :* ${SITE_URL}/dashboard/withdraw`,

    deposit:
      `💰 *Comment effectuer un dépôt sur XSPY Trader*\n\n` +
      `*Dépôt minimum :* 51 $ pour démarrer.\n\n` +
      `📋 *Étapes de dépôt :*\n` +
      `1️⃣ Rendez-vous dans *Tableau de bord › Portefeuille › Déposer*\n` +
      `2️⃣ Choisissez votre réseau crypto (USDT TRC20, BEP20, BTC, etc.)\n` +
      `3️⃣ Copiez l'adresse affichée et effectuez le virement depuis votre portefeuille personnel\n` +
      `4️⃣ Téléversez la capture d'écran du paiement et le TXID\n\n` +
      `⏱ *Délai de traitement :* 5 à 15 minutes.\n\n` +
      `🌐 *Page de dépôt :* ${SITE_URL}/dashboard/deposit`,

    trade:
      `📊 *Trading Quotidien sur XSPY Trader*\n\n` +
      `Des sessions de trading quotidiennes garanties ouvertes par l'administration (du lundi au vendredi) :\n\n` +
      `⏱️ *Trade de 30 secondes :* *2 % de profit*\n` +
      `⏱️ *Trade de 45 secondes :* *2,5 % de profit*\n` +
      `⏱️ *Trade de 60 secondes :* *3 % de profit*\n\n` +
      `📋 *Comment participer :*\n` +
      `1️⃣ Lorsque la session est annoncée, allez dans *Tableau de bord › Trading*\n` +
      `2️⃣ Choisissez votre mise et rejoignez le tour en direct\n` +
      `3️⃣ Vos bénéfices sont crédités immédiatement sur votre solde à la fin du chrono !\n\n` +
      `💡 *Exemple :* 100 $ misés sur 60s rapportent *3 $ de profit net* (Total : 103 $).\n\n` +
      `🌐 *Page de trading :* ${SITE_URL}/dashboard/trading`,

    package:
      `⛏️ *Packs d'Investissement & Minage sur XSPY Trader*\n\n` +
      `Choisissez un pack et recevez des profits automatiques chaque 24 heures :\n\n` +
      `1️⃣ *Pack Débutant (Beginner) :*\n` +
      `💵 Investissement : 51 $ à 100 $ | 🔹 Commission journalière : *1,5 %* | ⏳ Durée : *7 jours*\n\n` +
      `2️⃣ *Pack Professionnel (Professional) :*\n` +
      `💵 Investissement : 101 $ à 150 $ | 🔹 Commission journalière : *1,8 %* | ⏳ Durée : *18 jours*\n\n` +
      `3️⃣ *Pack VIP :*\n` +
      `💵 Investissement : 151 $ à 200 $ | 🔹 Commission journalière : *2,0 %* | ⏳ Durée : *30 jours*\n\n` +
      `🔹 *Système de profit :* Vos gains sont versés chaque 24 heures. À la fin de la période, votre capital initial est intégralement restitué !\n\n` +
      `🌐 *Page des packs :* ${SITE_URL}/dashboard/packages`,

    referral:
      `🤝 *Programme de Parrainage sur XSPY Trader*\n\n` +
      `Touchez des commissions généreuses sur 3 niveaux d'équipe et 3 filières :\n\n` +
      `🎁 *1. Parrainage sur les dépôts :*\n` +
      `🥇 Niveau 1 : *7 %* | 🥈 Niveau 2 : *4 %* | 🥉 Niveau 3 : *2 %*\n\n` +
      `📈 *2. Parrainage sur les gains de trading :*\n` +
      `🥇 Niveau 1 : *7 %* | 🥈 Niveau 2 : *4 %* | 🥉 Niveau 3 : *2 %*\n\n` +
      `📦 *3. Parrainage sur les packs de minage :*\n` +
      `🥇 Niveau 1 : *7 %* | 🥈 Niveau 2 : *4 %* | 🥉 Niveau 3 : *2 %*\n\n` +
      `🔗 *Votre lien de parrainage :* ${SITE_URL}/dashboard/referrals`,

    register:
      `🚀 *Rejoignez XSPY Trader Aujourd'hui*\n\n` +
      `Votre opportunité idéale pour générer des profits quotidiens en trading et minage !\n\n` +
      `🌐 *Lien d'inscription officiel :* 👉 ${OFFICIAL_REF_LINK} 👈\n\n` +
      `💵 *Dépôt minimum :* 51 $\n` +
      `💸 *Retrait minimum :* 21 $ (frais 8 %)\n` +
      `📊 *Trading quotidien :* 2 % à 3 % en quelques secondes\n` +
      `⛏️ *Packs minage :* 1,5 % à 2 %/jour avec retour du capital\n\n` +
      `🔗 *Inscription :* ${OFFICIAL_REF_LINK}`,

    verify:
      `🔐 *Sécurité & Vérification sur XSPY Trader*\n\n` +
      `🛡️ *Validation des retraits :* Tous les retraits sont sécurisés **exclusivement par code OTP Gmail** envoyé sur votre messagerie enregistrée.\n\n` +
      `💬 *Liaison Telegram (Optionnelle pour les alertes) :*\n` +
      `Connectez [@XSpyTraderOtp_bot](https://t.me/XSpyTraderOtp_bot) pour recevoir les alertes des sessions de trading et annonces en temps réel.\n` +
      `1️⃣ Ouvrez le bot et cliquez sur *START*\n` +
      `2️⃣ Copiez votre *Chat ID*\n` +
      `3️⃣ Collez-le dans votre profil : ${SITE_URL}/dashboard/profile et enregistrez.\n\n` +
      `⚠️ *Avertissement :* Ne partagez jamais vos codes de sécurité !`,

    defaultSupport:
      `🤖 *Support Officiel XSPY Trader*\n\n` +
      `Bienvenue ! Je suis à votre service 24h/24 pour vous renseigner sur :\n\n` +
      `📊 *Trading Quotidien (2% - 3%)*\n` +
      `⛏️ *Packs Minage (1,5% - 2%/jour, 7-30 jours)*\n` +
      `🤝 *Parrainage (7% - 4% - 2%)*\n` +
      `💰 *Dépôt (51 $ min)* | 💸 *Retrait (21 $ min, frais 8%)*\n\n` +
      `🌐 *Inscription :* ${OFFICIAL_REF_LINK}`,
  },

  de: {
    withdraw:
      `💸 *Auszahlungsrichtlinien & Anleitung — XSPY Trader*\n\n` +
      `*Mindestauszahlung:* 21 $ | *Gebühr:* nur 8 % | *Bearbeitungszeit:* 1 bis maximal 24 Stunden\n` +
      `⚠️ *Häufigkeit:* Es ist nur 1 Auszahlung alle 24 Stunden erlaubt.\n\n` +
      `📋 *Schritte zur Auszahlung:*\n` +
      `1️⃣ *Profil überprüfen:* Vergewissern Sie sich, dass Ihre Profildaten vollständig gespeichert sind.\n` +
      `2️⃣ *Wallet hinterlegen:* Unter *Wallet › Wallets verwalten* (24h Sicherheitssperre für neue Wallets).\n` +
      `3️⃣ *Auszahlung beantragen:* Unter *Wallet › Auszahlen* Wallet wählen und Betrag eingeben (ab 21 $).\n` +
      `4️⃣ *Gmail OTP Autorisierung:* Ein geheimer 6-stelliger Sicherheitscode wird an Ihre registrierte **Gmail-Adresse** gesendet. Geben Sie den Code ein, um die Auszahlung freizugeben.\n\n` +
      `🔒 *Hinweis:* Auszahlungen sind exklusiv per Gmail OTP geschützt. Teilen Sie niemals Ihre Codes!\n\n` +
      `🌐 *Auszahlungsseite:* ${SITE_URL}/dashboard/withdraw`,

    deposit:
      `💰 *So funktioniert die Einzahlung auf XSPY Trader*\n\n` +
      `*Mindesteinzahlung:* nur 51 $ zum Starten.\n\n` +
      `📋 *Einzahlungsschritte:*\n` +
      `1️⃣ Gehen Sie zu *Dashboard › Wallet › Einzahlen*\n` +
      `2️⃣ Wählen Sie Ihr Krypto-Netzwerk (USDT TRC20, BEP20, BTC usw.)\n` +
      `3️⃣ Kopieren Sie die Wallet-Adresse und überweisen Sie von Ihrer privaten Wallet\n` +
      `4️⃣ Screenshot der Transaktion und TXID hochladen\n\n` +
      `⏱ *Bestätigungszeit:* 5–15 Minuten.\n\n` +
      `🌐 *Einzahlungsseite:* ${SITE_URL}/dashboard/deposit`,

    trade:
      `📊 *Tägliche Trading-Runden auf XSPY Trader*\n\n` +
      `Garantierte tägliche Admin-Trades (Montag bis Freitag) mit attraktiven Renditen:\n\n` +
      `⏱️ *30-Sekunden-Trade:* *2 % Gewinn*\n` +
      `⏱️ *45-Sekunden-Trade:* *2,5 % Gewinn*\n` +
      `⏱️ *60-Sekunden-Trade:* *3 % Gewinn*\n\n` +
      `📋 *So nehmen Sie teil:*\n` +
      `1️⃣ Wenn die Runde angekündigt wird, öffnen Sie *Dashboard › Trading*\n` +
      `2️⃣ Einsatz wählen und der Live-Runde beitreten\n` +
      `3️⃣ Gewinne werden sofort nach Ablauf der Runde gutgeschrieben!\n\n` +
      `💡 *Beispiel:* 100 $ Einsatz im 60s-Trade = *3 $ Reingewinn* (Gesamt: 103 $).\n\n` +
      `🌐 *Trading-Seite:* ${SITE_URL}/dashboard/trading`,

    package:
      `⛏️ *Mining- & Anlagepakete auf XSPY Trader*\n\n` +
      `Wählen Sie Ihr Paket für automatische tägliche Erträge (Gutschrift alle 24 Std.):\n\n` +
      `1️⃣ *Beginner-Paket:*\n` +
      `💵 Anlage: 51 $ bis 100 $ | 🔹 Tägliche Rendite: *1,5 %* | ⏳ Laufzeit: *7 Tage*\n\n` +
      `2️⃣ *Professional-Paket:*\n` +
      `💵 Anlage: 101 $ bis 150 $ | 🔹 Tägliche Rendite: *1,8 %* | ⏳ Laufzeit: *18 Tage*\n\n` +
      `3️⃣ *VIP-Paket:*\n` +
      `💵 Anlage: 151 $ bis 200 $ | 🔹 Tägliche Rendite: *2,0 %* | ⏳ Laufzeit: *30 Tage*\n\n` +
      `🔹 *Auszahlungssystem:* Erträge werden alle 24 Stunden gutgeschrieben. Nach Ablauf der Laufzeit erhalten Sie Ihr investiertes Grundkapital vollständig zurück!\n\n` +
      `🌐 *Pakete-Seite:* ${SITE_URL}/dashboard/packages`,

    referral:
      `🤝 *Partnerprogramm auf XSPY Trader*\n\n` +
      `Verdienen Sie Provisionen über 3 Ebenen und 3 Einnahmequellen:\n\n` +
      `🎁 *1. Basis-Partnerprovisionen (aus Einzahlungen):*\n` +
      `🥇 Ebene 1: *7 %* | 🥈 Ebene 2: *4 %* | 🥉 Ebene 3: *2 %*\n\n` +
      `📈 *2. Trading-Partnerprovisionen (aus Gewinnen):*\n` +
      `🥇 Ebene 1: *7 %* | 🥈 Ebene 2: *4 %* | 🥉 Ebene 3: *2 %*\n\n` +
      `📦 *3. Mining-Paket-Provisionen:*\n` +
      `🥇 Ebene 1: *7 %* | 🥈 Ebene 2: *4 %* | 🥉 Ebene 3: *2 %*\n\n` +
      `🔗 *Ihr Partnerlink:* ${SITE_URL}/dashboard/referrals`,

    register:
      `🚀 *Jetzt bei XSPY Trader starten*\n\n` +
      `Ihr Zugang zu täglichen Gewinnen durch Trading und Mining!\n\n` +
      `🌐 *Offizieller Registrierungslink:* 👉 ${OFFICIAL_REF_LINK} 👈\n\n` +
      `💵 *Mindesteinzahlung:* 51 $\n` +
      `💸 *Mindestauszahlung:* 21 $ (nur 8 % Gebühr)\n` +
      `📊 *Tägliches Trading:* 2 % bis 3 % Gewinn in Sekunden\n` +
      `⛏️ *Mining-Pakete:* 1,5 % bis 2 % täglich + Kapitalrückzahlung\n\n` +
      `🔗 *Hier registrieren:* ${OFFICIAL_REF_LINK}`,

    verify:
      `🔐 *Sicherheit & Verifizierung auf XSPY Trader*\n\n` +
      `🛡️ *Auszahlungssicherheit:* Jede Auszahlung wird **ausschließlich per Gmail OTP** über Ihre registrierte E-Mail-Adresse autorisiert.\n\n` +
      `💬 *Telegram-Bot (Optional für Benachrichtigungen):*\n` +
      `Verknüpfen Sie [@XSpyTraderOtp_bot](https://t.me/XSpyTraderOtp_bot), um Trading-Runden und Plattform-Updates auf Telegram zu empfangen.\n` +
      `1️⃣ Bot öffnen und *START* drücken\n` +
      `2️⃣ Ihre *Chat-ID* kopieren\n` +
      `3️⃣ Im Profil eintragen: ${SITE_URL}/dashboard/profile und speichern.\n\n` +
      `⚠️ *Sicherheit:* Geben Sie niemals Ihre Sicherheitscodes an Dritte weiter!`,

    defaultSupport:
      `🤖 *Offizieller XSPY Trader AI-Support*\n\n` +
      `Willkommen! Ich helfe Ihnen bei allen Fragen zu:\n\n` +
      `📊 *Trading (2% - 3%)*\n` +
      `⛏️ *Mining-Pakete (1,5% - 2% täglich, 7-30 Tage)*\n` +
      `🤝 *Partnerprogramm (7% - 4% - 2%)*\n` +
      `💰 *Einzahlung (ab 51 $)* | 💸 *Auszahlung (ab 21 $, 8% Gebühr)*\n\n` +
      `🌐 *Registrierung:* ${OFFICIAL_REF_LINK}`,
  },

  ru: {
    withdraw:
      `💸 *Инструкция и правила вывода средств — XSPY Trader*\n\n` +
      `*Минимальный вывод:* $21 | *Комиссия:* всего 8% | *Срок обработки:* от 1 до 24 часов\n` +
      `⚠️ *Лимит:* разрешён только 1 вывод каждые 24 часа.\n\n` +
      `📋 *Шаги для вывода средств:*\n` +
      `1️⃣ *Заполните профиль:* Убедитесь, что данные вашего профиля сохранены.\n` +
      `2️⃣ *Добавьте кошелёк:* В разделе *Кошелёк › Управление кошельками* (24ч защитный период для новых кошельков).\n` +
      `3️⃣ *Подайте заявку:* В разделе *Кошелёк › Вывод*, выберите кошелёк и укажите сумму (от $21).\n` +
      `4️⃣ *Авторизация через Gmail OTP:* Секретный 6-значный код безопасности отправляется прямо на ваш зарегистрированный **Gmail**. Введите его для подтверждения.\n\n` +
      `🔒 *Безопасность:* Вывод защищён исключительно кодом через Gmail. Никогда не сообщайте коды третьим лицам!\n\n` +
      `🌐 *Страница вывода:* ${SITE_URL}/dashboard/withdraw`,

    deposit:
      `💰 *Как пополнить счёт на XSPY Trader*\n\n` +
      `*Минимальный депозит:* всего $51 для старта.\n\n` +
      `📋 *Шаги пополнения:*\n` +
      `1️⃣ Перейдите в *Панель управления › Кошелёк › Депозит*\n` +
      `2️⃣ Выберите сеть (USDT TRC20, BEP20, BTC и др.)\n` +
      `3️⃣ Скопируйте адрес кошелька и переведите средства со своего кошелька\n` +
      `4️⃣ Загрузите скриншот чека и TXID\n\n` +
      `⏱ *Время зачисления:* 5–15 минут.\n\n` +
      `🌐 *Страница депозита:* ${SITE_URL}/dashboard/deposit`,

    trade:
      `📊 *Ежедневный трейдинг на платформе XSPY Trader*\n\n` +
      `Гарантированные ежедневные торговые сделки от администрации (с понедельника по пятницу):\n\n` +
      `⏱️ *Сделка 30 сек:* *2% прибыли*\n` +
      `⏱️ *Сделка 45 сек:* *2.5% прибыли*\n` +
      `⏱️ *Сделка 60 сек:* *3% прибыли*\n\n` +
      `📋 *Как участвовать:*\n` +
      `1️⃣ После анонса сделки перейдите в *Панель › Трейдинг*\n` +
      `2️⃣ Укажите сумму и присоединитесь к раунду\n` +
      `3️⃣ Прибыль мгновенно поступает на ваш баланс сразу после завершения таймера!\n\n` +
      `💡 *Пример:* Вход на $100 в раунд 60 секунд приносит *$3 чистой прибыли* (Итого: $103).\n\n` +
      `🌐 *Страница трейдинга:* ${SITE_URL}/dashboard/trading`,

    package:
      `⛏️ *Пакеты майнинга на платформе XSPY Trader*\n\n` +
      `Выберите пакет и получайте пассивный доход каждые 24 часа:\n\n` +
      `1️⃣ *Пакет Beginner:*\n` +
      `💵 Инвестиция: $51 – $100 | 🔹 Доход в день: *1.5%* | ⏳ Срок: *7 дней*\n\n` +
      `2️⃣ *Пакет Professional:*\n` +
      `💵 Инвестиция: $101 – $150 | 🔹 Доход в день: *1.8%* | ⏳ Срок: *18 дней*\n\n` +
      `3️⃣ *Пакет VIP:*\n` +
      `💵 Инвестиция: $151 – $200 | 🔹 Доход в день: *2.0%* | ⏳ Срок: *30 дней*\n\n` +
      `🔹 *Система начислений:* Прибыль поступает каждые 24 часа. По завершении срока весь вложенный депозит возвращается на ваш счёт!\n\n` +
      `🌐 *Страница пакетов:* ${SITE_URL}/dashboard/packages`,

    referral:
      `🤝 *Партнёрская программа XSPY Trader*\n\n` +
      `Получайте доход по 3 направлениям и 3 уровням команды:\n\n` +
      `🎁 *1. Партнёрка с депозитов:*\n` +
      `🥇 Уровень 1: *7%* | 🥈 Уровень 2: *4%* | 🥉 Уровень 3: *2%*\n\n` +
      `📈 *2. Партнёрка с дохода от трейдинга команды:*\n` +
      `🥇 Уровень 1: *7%* | 🥈 Уровень 2: *4%* | 🥉 Уровень 3: *2%*\n\n` +
      `📦 *3. Партнёрка с пакетов майнинга:*\n` +
      `🥇 Уровень 1: *7%* | 🥈 Уровень 2: *4%* | 🥉 Уровень 3: *2%*\n\n` +
      `🔗 *Ваша партнёрская ссылка:* ${SITE_URL}/dashboard/referrals`,

    register:
      `🚀 *Регистрация на XSPY Trader*\n\n` +
      `Ваш путь к ежедневному доходу на трейдинге и майнинге!\n\n` +
      `🌐 *Официальная ссылка:* 👉 ${OFFICIAL_REF_LINK} 👈\n\n` +
      `💵 *Минимальный депозит:* $51\n` +
      `💸 *Минимальный вывод:* $21 (комиссия всего 8%)\n` +
      `📊 *Трейдинг:* от 2% до 3% за секунды\n` +
      `⛏️ *Майнинг:* 1.5% - 2% в день + возврат депозита\n\n` +
      `🔗 *Регистрация:* ${OFFICIAL_REF_LINK}`,

    verify:
      `🔐 *Безопасность и верификация на XSPY Trader*\n\n` +
      `🛡️ *Подтверждение вывода:* Все операции вывода подтверждаются **исключительно кодом через Gmail OTP**.\n\n` +
      `💬 *Привязка Telegram (Опционально для уведомлений):*\n` +
      `Подключите бота [@XSpyTraderOtp_bot](https://t.me/XSpyTraderOtp_bot) для получения анонсов сделок и важных оповещений в Telegram.\n` +
      `1️⃣ Нажмите *START* в боте\n` +
      `2️⃣ Скопируйте свой *Chat ID*\n` +
      `3️⃣ Вставьте в профиле: ${SITE_URL}/dashboard/profile и сохраните.\n\n` +
      `⚠️ *Внимание:* Никогда не передавайте коды третьим лицам!`,

    defaultSupport:
      `🤖 *Официальная поддержка XSPY Trader*\n\n` +
      `Приветствую! Я отвечу на любые вопросы по следующим темам:\n\n` +
      `📊 *Трейдинг (2% - 3%)*\n` +
      `⛏️ *Пакеты майнинга (1.5% - 2% в день, 7-30 дней)*\n` +
      `🤝 *Партнёрская программа (7% - 4% - 2%)*\n` +
      `💰 *Депозит (от $51)* | 💸 *Вывод (от $21, комиссия 8%)*\n\n` +
      `🌐 *Регистрация:* ${OFFICIAL_REF_LINK}`,
  },
};

// ─── Keyword Fallback Answers ─────────────────────────────────────────────────
function getKeywordFallback(
  userMessage: string,
  lang: SupportedLang = "en"
): BotResponse {
  const lower = userMessage.toLowerCase();
  const c = FALLBACK_CONTENT[lang] || FALLBACK_CONTENT.en;

  // 1. Withdrawal (Highest priority & includes OTP Bot link)
  if (
    lower.includes("withdraw") ||
    lower.includes("سحب") ||
    lower.includes("السحب") ||
    lower.includes("اسحب") ||
    lower.includes("طريق السحب") ||
    lower.includes("retrait") ||
    lower.includes("retirer") ||
    lower.includes("auszahlung") ||
    lower.includes("auszahlen") ||
    lower.includes("abheben") ||
    lower.includes("вывод") ||
    lower.includes("вывести")
  ) {
    return {
      text: c.withdraw,
      replyMarkup: buildWithdrawalInlineKeyboard(lang),
    };
  }

  // 2. Deposit
  if (
    lower.includes("deposit") ||
    lower.includes("إيداع") ||
    lower.includes("ايداع") ||
    lower.includes("شحن") ||
    lower.includes("fund") ||
    lower.includes("dépôt") ||
    lower.includes("depot") ||
    lower.includes("déposer") ||
    lower.includes("deposer") ||
    lower.includes("einzahlung") ||
    lower.includes("einzahlen") ||
    lower.includes("депозит") ||
    lower.includes("пополнить")
  ) {
    return {
      text: c.deposit,
      replyMarkup: buildDepositInlineKeyboard(lang),
    };
  }

  // 3. Trading
  if (
    lower.includes("trade") ||
    lower.includes("trading") ||
    lower.includes("تداول") ||
    lower.includes("التداول") ||
    lower.includes("صفقة") ||
    lower.includes("صفقات") ||
    lower.includes("trader") ||
    lower.includes("handeln") ||
    lower.includes("handel") ||
    lower.includes("трейдинг") ||
    lower.includes("торговля")
  ) {
    return {
      text: c.trade,
      replyMarkup: buildTradingInlineKeyboard(lang),
    };
  }

  // 4. Mining Packages
  if (
    lower.includes("package") ||
    lower.includes("mining") ||
    lower.includes("باقة") ||
    lower.includes("باقات") ||
    lower.includes("تعدين") ||
    lower.includes("استثمار") ||
    lower.includes("forfait") ||
    lower.includes("pack") ||
    lower.includes("paket") ||
    lower.includes("пакет") ||
    lower.includes("майнинг")
  ) {
    return {
      text: c.package,
      replyMarkup: buildPackagesInlineKeyboard(lang),
    };
  }

  // 5. Referrals
  if (
    lower.includes("referral") ||
    lower.includes("refer") ||
    lower.includes("invite") ||
    lower.includes("إحالة") ||
    lower.includes("احالة") ||
    lower.includes("احالات") ||
    lower.includes("فريق") ||
    lower.includes("عمولة") ||
    lower.includes("parrainage") ||
    lower.includes("parrain") ||
    lower.includes("empfehlung") ||
    lower.includes("реферал") ||
    lower.includes("партнерка")
  ) {
    return {
      text: c.referral,
      replyMarkup: buildReferralsInlineKeyboard(lang),
    };
  }

  // 6. Registration & Account
  if (
    lower.includes("register") ||
    lower.includes("sign up") ||
    lower.includes("signup") ||
    lower.includes("تسجيل") ||
    lower.includes("حساب جديد") ||
    lower.includes("انشاء حساب") ||
    lower.includes("inscription") ||
    lower.includes("registrierung") ||
    lower.includes("регистрация")
  ) {
    return {
      text: c.register,
      replyMarkup: buildRegisterInlineKeyboard(lang),
    };
  }

  // 7. Security / 2FA / OTP Verification Bot
  if (
    lower.includes("2fa") ||
    lower.includes("otp") ||
    lower.includes("verify") ||
    lower.includes("security") ||
    lower.includes("أمان") ||
    lower.includes("امان") ||
    lower.includes("توثيق") ||
    lower.includes("تحقق") ||
    lower.includes("ربط تيليجرام") ||
    lower.includes("sécurité") ||
    lower.includes("securite") ||
    lower.includes("sicherheit") ||
    lower.includes("верификация") ||
    lower.includes("безопасность")
  ) {
    return {
      text: c.verify,
      replyMarkup: buildVerificationInlineKeyboard(lang),
    };
  }

  // Default support overview
  return {
    text: c.defaultSupport,
  };
}

// ─── AI Answer via Gemini ─────────────────────────────────────────────────────
async function getAIAnswer(
  userMessage: string,
  userName: string,
  userId: number,
  lang: SupportedLang = "en"
): Promise<BotResponse> {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === "NOT SET") {
    return getKeywordFallback(userMessage, lang);
  }

  let userInfoStr =
    "Status: Unlinked/Unknown — User has not linked their Telegram to the platform.";
  try {
    const { data: profile } = await adminClient
      .from("user_profiles")
      .select("full_name, status, uid, balance")
      .eq("telegram_chat_id", String(userId))
      .single();

    if (profile) {
      userInfoStr =
        `Linked Account Found!\n` +
        `- Name: ${profile.full_name || userName}\n` +
        `- Verification Status: ${profile.status}\n` +
        `- Account UID: ${profile.uid}\n` +
        `(You can address them by their verified name. Do NOT share balance information.)`;
    }
  } catch {
    // ignore — user may not be linked
  }

  const langNames: Record<SupportedLang, string> = {
    ar: "Arabic (العربية)",
    en: "English",
    fr: "French (Français)",
    de: "German (Deutsch)",
    ru: "Russian (Русский)",
  };

  // Real-time synchronization with platform database
  const liveKnowledge = await getLivePlatformKnowledge();

  const prompt =
    `${liveKnowledge}\n\n---\n\n` +
    `## CONVERSATION CONTEXT\n` +
    `You are talking to a user named "${userName}" in the official XSPY Trader Telegram group.\n` +
    `User Database Info:\n${userInfoStr}\n\n` +
    `User Message:\n"${userMessage}"\n\n` +
    `## MANDATORY INSTRUCTIONS\n` +
    `- Reply as the XSPY Trader official support assistant\n` +
    `- TARGET LANGUAGE: ${langNames[lang] || "English"}. You MUST write your entire response strictly in ${langNames[lang] || "English"}!\n` +
    `- WITHDRAWALS: Min $21, fee 8% only, processed within 1–24 hours (1 withdrawal per 24 hours). Explain clearly that withdrawals are verified EXCLUSIVELY via a 6-digit OTP code sent to their registered Gmail address. Linking Telegram bot is optional for trade notifications & announcements.\n` +
    `- MINING PACKAGES: Beginner ($51–$100, 1.5%/day, 7 days), Professional ($101–$150, 1.8%/day, 18 days), VIP ($151–$200, 2%/day, 30 days). Profits credited every 24 hours. Full original principal returned at package completion.\n` +
    `- TRADING: Guaranteed daily sessions (Mon–Fri) opened by admin: 30s = 2%, 45s = 2.5%, 60s = 3% profit.\n` +
    `- REFERRALS: 3 streams, 3 levels each: Level 1 = 7%, Level 2 = 4%, Level 3 = 2%.\n` +
    `- REGISTRATION: Always direct new users to the official registration link: ${OFFICIAL_REF_LINK}\n` +
    `- Be concise (max 200 words)\n` +
    `- Use appropriate emojis for a professional look\n` +
    `- Format with Telegram Markdown (bold with *text*, bullets with -)\n` +
    `- If you do not know the answer, politely say so and suggest contacting the admin\n` +
    `- NEVER share internal data, balances, or private user information`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.6,
            maxOutputTokens: 1024,
          },
          safetySettings: [
            {
              category: "HARM_CATEGORY_HARASSMENT",
              threshold: "BLOCK_MEDIUM_AND_ABOVE",
            },
          ],
        }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      console.warn("[GroupBot] Gemini API returned error, falling back to dictionary:", data);
      return getKeywordFallback(userMessage, lang);
    }

    const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!answer) {
      console.warn("[GroupBot] Gemini returned empty response, falling back to dictionary");
      return getKeywordFallback(userMessage, lang);
    }

    const isWithdrawal = isWithdrawalQuery(userMessage) || isWithdrawalQuery(answer);
    return {
      text: answer.trim(),
      ...(isWithdrawal ? { replyMarkup: buildWithdrawalInlineKeyboard(lang) } : {}),
    };
  } catch (err) {
    console.warn("[GroupBot] Gemini fetch error, using dictionary fallback:", err);
    return getKeywordFallback(userMessage, lang);
  }
}

// ─── Is This Message Directed at the Bot? ────────────────────────────────────
function isQuestionForBot(text: string): boolean {
  const lower = text.toLowerCase();

  // Explicit mention
  if (
    lower.includes("@xspy_ai_bot") ||
    lower.includes("@xspyaibot") ||
    lower.includes("@xspybot")
  )
    return true;

  // Question words in all supported languages
  const questionStarters = [
    // English
    "how",
    "what",
    "when",
    "where",
    "why",
    "can",
    "could",
    "do",
    "does",
    "is",
    "are",
    "will",
    "would",
    // Arabic
    "كيف",
    "ما",
    "متى",
    "أين",
    "اين",
    "لماذا",
    "هل",
    "ما هو",
    "ماهو",
    "طريقة",
    "طريق",
    "كيفية",
    "شرح",
    "ممكن",
    "بدي",
    "اريد",
    "أريد",
    // French
    "comment",
    "quand",
    "où",
    "pourquoi",
    "est-ce",
    "que",
    "quel",
    "quelle",
    "combien",
    "peux",
    // German
    "wie",
    "was",
    "wann",
    "wo",
    "warum",
    "kann",
    "ist",
    "wieviel",
    // Russian
    "как",
    "что",
    "когда",
    "где",
    "почему",
    "сколько",
    "можно",
  ];

  const keywords = [
    // English
    "deposit",
    "withdraw",
    "trade",
    "package",
    "referral",
    "otp",
    "verify",
    "2fa",
    "mining",
    "profit",
    "wallet",
    // Arabic
    "إيداع",
    "ايداع",
    "شحن",
    "سحب",
    "السحب",
    "اسحب",
    "طريق",
    "تداول",
    "التداول",
    "صفقة",
    "باقة",
    "باقات",
    "إحالة",
    "احالة",
    "فريق",
    "ارباح",
    "أرباح",
    "توثيق",
    "تحقق",
    "محفظة",
    "كود",
    // French
    "dépôt",
    "depot",
    "retrait",
    "retirer",
    "trading",
    "forfait",
    "pack",
    "parrainage",
    "sécurité",
    "securite",
    "portefeuille",
    // German
    "einzahlung",
    "auszahlung",
    "auszahlen",
    "handeln",
    "paket",
    "empfehlung",
    "sicherheit",
    "brieftasche",
    // Russian
    "депозит",
    "вывод",
    "вывести",
    "трейдинг",
    "пакет",
    "реферал",
    "безопасность",
    "верификация",
    "кошелек",
  ];

  if (questionStarters.some((w) => lower.startsWith(w))) return true;
  if (lower.includes("?") || lower.includes("؟")) return true;
  if (keywords.some((k) => lower.includes(k))) return true;

  return false;
}

// ─── Build Welcome Message ────────────────────────────────────────────────────
function buildWelcomeMessage(memberName: string, lang: SupportedLang = "en"): string {
  if (lang === "ar") {
    return (
      `🎉 *مرحباً بك في المجموعة الرسمية لمنصة XSPY Trader، ${memberName}!* 🚀\n\n` +
      `يسعدنا انضمامك إلى مجتمعنا الاستثماري الذكي. تقدم المنصة:\n\n` +
      `📊 *تداول الخيارات الثنائية:* صفقات يومية مضمونة (الاثنين–الجمعة) بربح *2% إلى 3%* خلال ثوانٍ معدودة\n` +
      `⛏️ *باقات التعدين اليومية:* عوائد يومية *1.5% حتى 2.0%* تُضاف كل 24 ساعة مع استرداد رأس المال بالكامل\n` +
      `🤝 *برنامج الإحالات (3 مستويات):* عمولات *7%، 4%، و2%* عبر 3 مسارات (الإيداعات، التداول، والتعدين)\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💵 *السياسة المالية والأمان:*\n` +
      `- الحد الأدنى للإيداع: *$51* | الحد الأدنى للسحب: *$21* (برسوم 8% فقط)\n` +
      `- جميع طلبات السحب مؤمنة ومعتمدة حصرياً عبر كود سري (OTP) يُرسل إلى بريدك الإلكتروني (Gmail).\n` +
      `- لربط إشعارات التداول وتنبيهات الحساب على تيليجرام: [@XSpyTraderOtp_bot](https://t.me/XSpyTraderOtp_bot)\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🌐 *رابط التسجيل الرسمي المباشر:* ${OFFICIAL_REF_LINK}\n` +
      `💡 *اسألني أي شيء هنا في المجموعة — المساعد الذكي يعمل على مدار الساعة!*`
    );
  }

  if (lang === "fr") {
    return (
      `🎉 *Bienvenue dans le groupe officiel XSPY Trader, ${memberName} !* 🚀\n\n` +
      `Ravi de vous accueillir dans notre communauté d'investisseurs. XSPY Trader propose :\n\n` +
      `📊 *Trading Quotidien :* Sessions garanties (lundi-vendredi) avec *2 % à 3 % de profit* en quelques secondes\n` +
      `⛏️ *Packs de Minage :* Revenus quotidiens de *1,5 % à 2,0 %* versés chaque 24h avec retour intégral du capital\n` +
      `🤝 *Parrainage (3 niveaux) :* *7 %, 4 % et 2 %* de commissions sur les dépôts, trading et packs\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💵 *Politique Financière & Sécurité :*\n` +
      `- Dépôt minimum : *51 $* | Retrait minimum : *21 $* (frais 8 %)\n` +
      `- Tous les retraits sont sécurisés exclusivement par code OTP envoyé sur votre adresse Gmail.\n` +
      `- Alertes trading Telegram : [@XSpyTraderOtp_bot](https://t.me/XSpyTraderOtp_bot)\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🌐 *Inscription Officielle :* ${OFFICIAL_REF_LINK}\n` +
      `💡 *Posez votre question à tout moment dans le groupe !*`
    );
  }

  if (lang === "de") {
    return (
      `🎉 *Willkommen in der offiziellen XSPY Trader Gruppe, ${memberName}!* 🚀\n\n` +
      `Schön, dass Sie Teil unserer Community sind. XSPY Trader bietet Ihnen:\n\n` +
      `📊 *Tägliches Trading:* Garantierte Admin-Runden (Mo–Fr) mit *2 % bis 3 % Gewinn* in Sekunden\n` +
      `⛏️ *Mining-Pakete:* *1,5 % bis 2,0 %* tägliche Gutschriften alle 24h + 100 % Kapitalrückzahlung\n` +
      `🤝 *Partnerprogramm (3 Stufen):* *7 %, 4 % und 2 %* Provisionen auf Einzahlungen, Trades & Pakete\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💵 *Finanzrichtlinien & Sicherheit:*\n` +
      `- Mindesteinzahlung: *51 $* | Mindestauszahlung: *21 $* (nur 8 % Gebühr)\n` +
      `- Auszahlungen werden exklusiv per Gmail-OTP-Code autorisiert.\n` +
      `- Telegram-Benachrichtigungen: [@XSpyTraderOtp_bot](https://t.me/XSpyTraderOtp_bot)\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🌐 *Offizielle Registrierung:* ${OFFICIAL_REF_LINK}\n` +
      `💡 *Fragen Sie mich alles hier in der Gruppe — 24/7 aktiv!*`
    );
  }

  if (lang === "ru") {
    return (
      `🎉 *Добро пожаловать в официальную группу XSPY Trader, ${memberName}!* 🚀\n\n` +
      `Рады приветствовать вас в нашем сообществе инвесторов. XSPY Trader предлагает:\n\n` +
      `📊 *Ежедневный трейдинг:* гарантированные раунды от админа (пн-пт) с прибылью *2%–3%* за секунды\n` +
      `⛏️ *Пакеты майнинга:* начисления *1.5%–2.0%* каждые 24ч + 100% возврат депозита по завершении\n` +
      `🤝 *Партнёрская программа (3 уровня):* *7%, 4% и 2%* комиссионных со всей команды\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💵 *Финансовые условия и безопасность:*\n` +
      `- Мин. депозит: *$51* | Мин. вывод: *$21* (комиссия всего 8%)\n` +
      `- Все выплаты подтверждаются исключительно защитным кодом Gmail OTP.\n` +
      `- Оповещения в Telegram: [@XSpyTraderOtp_bot](https://t.me/XSpyTraderOtp_bot)\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🌐 *Официальная регистрация:* ${OFFICIAL_REF_LINK}\n` +
      `💡 *Задавайте любые вопросы в группе — бот отвечает круглосуточно!*`
    );
  }

  // Default English
  return (
    `🎉 *Welcome to the Official XSPY Trader Group, ${memberName}!* 🚀\n\n` +
    `We're thrilled to welcome you to our investment community. XSPY Trader offers:\n\n` +
    `📊 *Daily Binary Options Trading:* Guaranteed admin rounds (Mon–Fri) earning *2% to 3% profit* in seconds\n` +
    `⛏️ *Daily Mining Packages:* *1.5% to 2.0%* passive returns credited every 24h + 100% principal back\n` +
    `🤝 *3-Tier Referral Rewards:* *7%, 4%, and 2%* across deposits, trading profits, and mining plans\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💵 *Financial Policy & Account Security:*\n` +
    `- Minimum Deposit: *$51* | Minimum Withdrawal: *$21* (8% fee)\n` +
    `- All withdrawals are verified exclusively via a secure 6-digit OTP sent to your registered Gmail.\n` +
    `- For live Telegram announcements & alerts: [@XSpyTraderOtp_bot](https://t.me/XSpyTraderOtp_bot)\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🌐 *Official Registration Link:* ${OFFICIAL_REF_LINK}\n` +
    `💡 *Ask me anything right here in the group — I'm available 24/7!*`
  );
}

function buildWelcomeInlineKeyboard(lang: SupportedLang = "en") {
  const labels: Record<
    SupportedLang,
    { register: string; open: string; profile: string }
  > = {
    ar: {
      register: "🚀 التسجيل الرسمي المباشر",
      open: "🌐 فتح المنصة",
      profile: "👤 الملف الشخصي",
    },
    en: {
      register: "🚀 Register Official Account",
      open: "🌐 Open Platform",
      profile: "👤 My Profile",
    },
    fr: {
      register: "🚀 Inscription Officielle",
      open: "🌐 Visiter la Plateforme",
      profile: "👤 Mon Profil",
    },
    de: {
      register: "🚀 Jetzt Registrieren",
      open: "🌐 Plattform öffnen",
      profile: "👤 Mein Profil",
    },
    ru: {
      register: "🚀 Регистрация на платформе",
      open: "🌐 Открыть платформу",
      profile: "👤 Мой профиль",
    },
  };
  const l = labels[lang] || labels.en;
  return {
    inline_keyboard: [
      [{ text: l.register, url: OFFICIAL_REF_LINK }],
      [
        { text: l.open, url: SITE_URL },
        { text: l.profile, url: `${SITE_URL}/dashboard/profile` },
      ],
    ],
  };
}

// ─── Main Webhook Handler ─────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // ── Handle callback queries (inline button presses) ──
    if (body.callback_query) {
      const cb = body.callback_query;
      await callTelegram("answerCallbackQuery", { callback_query_id: cb.id });
      return NextResponse.json({ ok: true });
    }

    // ── Handle my_chat_member updates (bot added to group or promoted to admin) ──
    if (body.my_chat_member) {
      const memberUpdate = body.my_chat_member;
      const chat = memberUpdate.chat;
      if (chat && (chat.type === "group" || chat.type === "supergroup" || chat.type === "channel")) {
        try {
          const { data: currentSetting } = await adminClient
            .from("system_settings")
            .select("value")
            .eq("key", "telegram_group_chat_id")
            .maybeSingle();

          const existing = String(currentSetting?.value || "")
            .split(/[,;\n]+/)
            .map((s) => s.trim())
            .filter(Boolean);

          const newId = String(chat.id);
          if (!existing.includes(newId)) {
            existing.push(newId);
            await adminClient
              .from("system_settings")
              .upsert({ key: "telegram_group_chat_id", value: existing.join(", ") }, { onConflict: "key" });
          }
        } catch {}
      }
      return NextResponse.json({ ok: true });
    }

    const message = body.message;
    if (!message) return NextResponse.json({ ok: true });

    const chatId = message.chat.id;
    const chatType = message.chat.type; // "group" | "supergroup" | "private"
    const userId = message.from?.id;
    const userName = message.from?.first_name || "Member";
    const userLang = message.from?.language_code;
    const messageId = message.message_id;

    // ── 0. NEW MEMBER WELCOME ──────────────────────────────────────────────────
    if (message.new_chat_members && message.new_chat_members.length > 0) {
      for (const member of message.new_chat_members) {
        if (member.is_bot) continue;

        const memberLang = detectLanguage("", member.language_code);
        await sendMessage(
          chatId,
          buildWelcomeMessage(member.first_name, memberLang),
          {
            replyMarkup: buildWelcomeInlineKeyboard(memberLang),
          }
        );
      }
      return NextResponse.json({ ok: true });
    }

    // ── Member left (clean acknowledgement, optional) ──────────────────────────
    if (message.left_chat_member) {
      return NextResponse.json({ ok: true });
    }

    const text = message.text || message.caption || "";
    if (!text || !userId) return NextResponse.json({ ok: true });

    const detectedLang = detectLanguage(text, userLang);

    // ── 0. GROUP PERSISTENCE: Auto-save Group Chat ID for broadcasts (append without overwriting) ──
    if (chatType === "group" || chatType === "supergroup") {
      try {
        const { data: currentSetting } = await adminClient
          .from("system_settings")
          .select("value")
          .eq("key", "telegram_group_chat_id")
          .maybeSingle();

        const existing = String(currentSetting?.value || "")
          .split(/[,;\n]+/)
          .map((s) => s.trim())
          .filter(Boolean);

        const newId = String(chatId);
        if (!existing.includes(newId)) {
          existing.push(newId);
          await adminClient
            .from("system_settings")
            .upsert(
              { key: "telegram_group_chat_id", value: existing.join(", ") },
              { onConflict: "key" }
            );
        }
      } catch {}
    }

    // ── 1. ANTI-FRAUD & IMPERSONATION GUARD (Groups) ──────────────────────────
    if (
      (chatType === "group" || chatType === "supergroup") &&
      containsImpersonationAttempt(text)
    ) {
      await deleteMessage(chatId, messageId);
      await muteUser(chatId, userId);
      const siteBanned = await banUserOnSite(userId);

      const warningText =
        detectedLang === "ar"
          ? `🛡️ *تحذير أمني: محاولة انتحال صفة أو احتيال مالي*\n\n` +
            `تم حذف الرسالة وكتم العضو @${message.from?.username || userName} لمدة *24 ساعة* لمحاولة انتحال صفة الدعم أو طلب التواصل الخاص.\n\n` +
            `${siteBanned ? "🔒 تم أيضاً تعليق حسابه على المنصة مؤقتاً.\n\n" : ""}` +
            `⚠️ *تنبيه حاسم لجميع أعضاء مجتمع XSPY Trader:*\n` +
            `• إدارة وموظفو المنصة *لن يراسلوك في الخاص أولاً* بأي شكل.\n` +
            `• لا تشارك أبداً رمز السحب (Gmail OTP) أو كلمات المرور مع أي شخص يدعي المساعدة.\n` +
            `• الدعم الرسمي متاح فقط داخل الموقع وعبر البوت الموثق.`
          : `🛡️ *Security Alert: Impersonation / Scam Attempt Blocked*\n\n` +
            `Message deleted and @${message.from?.username || userName} has been muted for *24 hours* for impersonating platform staff or soliciting private contact.\n\n` +
            `${siteBanned ? "🔒 Platform account temporarily suspended.\n\n" : ""}` +
            `⚠️ *Critical Security Reminder:*\n` +
            `• Official XSPY Trader staff will *NEVER direct message you first*.\n` +
            `• NEVER share your Gmail OTP withdrawal code, passwords, or seed phrase with anyone.\n` +
            `• Official support is provided strictly through verified platform channels.`;

      await sendMessage(chatId, warningText);

      await logAdminNotification(
        "fraud_detected",
        "🛡️ Staff Impersonation / Phishing Blocked in Telegram Group",
        `User @${message.from?.username || userName} (ID: ${userId}) triggered anti-fraud guard and was muted for 24h. Text: "${text.substring(0, 100)}"`,
        { telegramUserId: userId, username: message.from?.username, chatId, textSample: text }
      );

      return NextResponse.json({ ok: true });
    }

    // ── 2. SPAM MODERATION: Detect external links in groups ───────────────────
    if (
      (chatType === "group" || chatType === "supergroup") &&
      containsExternalLink(text)
    ) {
      await deleteMessage(chatId, messageId);
      await muteUser(chatId, userId);
      const siteBanned = await banUserOnSite(userId);

      const warningText =
        detectedLang === "ar"
          ? `⚠️ *مخالفة لسياسة المجموعة*\n\n` +
            `تم كتم العضو @${message.from?.username || userName} لمدة *24 ساعة* بسبب نشر رابط خارجي.\n\n` +
            `${siteBanned ? "🔒 تم أيضاً تعليق حسابه على المنصة مؤقتاً.\n\n" : ""}` +
            `_يُسمح فقط بنشر الروابط التابعة لمنصة XSPY Trader._`
          : `⚠️ *Group Policy Violation*\n\n` +
            `@${message.from?.username || userName} has been muted for *24 hours* for posting an external link.\n\n` +
            `${siteBanned ? "🔒 Their platform account has also been temporarily suspended.\n\n" : ""}` +
            `_Only links related to XSPY Trader are permitted in this group._`;

      await sendMessage(chatId, warningText);

      await logAdminNotification(
        "spam_detected",
        "🚨 Spam Detected in Telegram Group",
        `User @${message.from?.username || userName} (Telegram ID: ${userId}) posted an external link and was muted for 24h.${siteBanned ? " Platform account suspended." : ""}`,
        { telegramUserId: userId, username: message.from?.username, chatId }
      );

      return NextResponse.json({ ok: true });
    }

    // ── 3. QUICK-ACTION SHORTCUTS (Buttons & Commands) ────────────────────────
    if (isDealsButton(text)) {
      await sendMessage(chatId, FALLBACK_CONTENT[detectedLang].trade, {
        replyMarkup: buildTradingInlineKeyboard(detectedLang),
      });
      return NextResponse.json({ ok: true });
    }

    if (isPackagesButton(text)) {
      await sendMessage(chatId, FALLBACK_CONTENT[detectedLang].package, {
        replyMarkup: buildPackagesInlineKeyboard(detectedLang),
      });
      return NextResponse.json({ ok: true });
    }

    if (isReferralButton(text)) {
      await sendMessage(chatId, FALLBACK_CONTENT[detectedLang].referral, {
        replyMarkup: buildReferralsInlineKeyboard(detectedLang),
      });
      return NextResponse.json({ ok: true });
    }

    if (isRegisterButton(text)) {
      await sendMessage(chatId, FALLBACK_CONTENT[detectedLang].register, {
        replyMarkup: buildRegisterInlineKeyboard(detectedLang),
      });
      return NextResponse.json({ ok: true });
    }

    // ── 4. PRIVATE MESSAGES: Always respond ───────────────────────────────────
    if (chatType === "private") {
      if (text.trim() === "/start") {
        const welcomeTexts: Record<SupportedLang, string> = {
          ar:
            `👋 *مرحباً بك في المساعد الذكي الرسمي لمنصة XSPY Trader، ${userName}!* 🚀\n\n` +
            `أنا المساعد الرسمي المتاح 24/7 لخدمتك والإجابة على كافة أسئلتك:\n\n` +
            `📥 *الإيداع* — طريقة شحن حسابك بالعملات الرقمية\n` +
            `📤 *السحب* — خطوات سحب الأرباح وربط بوت التحقق\n` +
            `📈 *التداول* — كيفية الانضمام لصفقات الإدارة اليومية\n` +
            `⛏️ *باقات التعدين* — تفاصيل الباقات الاستثمارية ذات العائد اليومي\n` +
            `👥 *الإحالات* — نظام العمولات على 3 مستويات\n` +
            `🔐 *الأمان والتحقق* — حماية حسابك عبر [@XSpyTraderOtp_bot](https://t.me/XSpyTraderOtp_bot)\n` +
            `👤 *الملف الشخصي* — توثيق الحساب وإعدادات المحفظة\n\n` +
            `💡 اطرح سؤالك مباشرةً وسأجيبك فوراً!\n\n` +
            `🌐 *المنصة:* ${SITE_URL}`,

          fr:
            `👋 *Bienvenue sur l'assistance officielle XSPY Trader, ${userName} !* 🚀\n\n` +
            `Je suis votre assistant IA disponible 24h/24 et 7j/7. Voici comment je peux vous aider :\n\n` +
            `📥 *Dépôts* — Comment recharger votre compte\n` +
            `📤 *Retraits* — Démarches et activation du bot de vérification\n` +
            `📈 *Trading* — Participer aux sessions quotidiennes\n` +
            `⛏️ *Packs d'investissement* — Revenus passifs quotidiens\n` +
            `👥 *Parrainage* — Commissions sur 3 niveaux\n` +
            `🔐 *Sécurité (2FA)* — Protection via [@XSpyTraderOtp_bot](https://t.me/XSpyTraderOtp_bot)\n` +
            `👤 *Profil & Compte* — Finaliser votre vérification\n\n` +
            `💡 Posez votre question et je vous répondrai instantanément !\n\n` +
            `🌐 *Plateforme :* ${SITE_URL}`,

          de:
            `👋 *Willkommen beim offiziellen XSPY Trader Support, ${userName}!* 🚀\n\n` +
            `Ich bin Ihr 24/7 KI-Assistent. Hierbei kann ich Ihnen helfen:\n\n` +
            `📥 *Einzahlungen* — Guthaben aufladen\n` +
            `📤 *Auszahlungen* — Ablauf & Verifizierungs-Bot\n` +
            `📈 *Trading* — Teilnahme an täglichen Admin-Trades\n` +
            `⛏️ *Mining-Pakete* — Tägliche passive Erträge\n` +
            `👥 *Partnerprogramm* — Provisionen auf 3 Ebenen\n` +
            `🔐 *Sicherheit & 2FA* — Schutz über [@XSpyTraderOtp_bot](https://t.me/XSpyTraderOtp_bot)\n` +
            `👤 *Profil & Konto* — Verifizierung & Einstellungen\n\n` +
            `💡 Stellen Sie einfach Ihre Frage, ich antworte sofort!\n\n` +
            `🌐 *Plattform:* ${SITE_URL}`,

          ru:
            `👋 *Добро пожаловать в официальную поддержку XSPY Trader, ${userName}!* 🚀\n\n` +
            `Я ваш персональный ассистент, доступный 24/7. Чем я могу помочь:\n\n` +
            `📥 *Депозиты* — Пополнение баланса\n` +
            `📤 *Вывод средств* — Инструкция и привязка бота верификации\n` +
            `📈 *Трейдинг* — Участие в ежедневных торговых раундах\n` +
            `⛏️ *Пакеты майнинга* — Ежедневный пассивный доход\n` +
            `👥 *Рефералы* — Трёхуровневая партнёрская программа\n` +
            `🔐 *Безопасность (2FA)* — Защита через [@XSpyTraderOtp_bot](https://t.me/XSpyTraderOtp_bot)\n` +
            `👤 *Профиль и аккаунт* — Верификация и настройки\n\n` +
            `💡 Просто напишите свой вопрос, и я отвечу сразу!\n\n` +
            `🌐 *Платформа:* ${SITE_URL}`,

          en:
            `👋 *Welcome to XSPY Trader AI Support, ${userName}!* 🚀\n\n` +
            `I'm the official 24/7 support assistant for *XSPY Trader*. Here's what I can help you with:\n\n` +
            `📥 *Deposits* — How to fund your account\n` +
            `📤 *Withdrawals* — How to withdraw your earnings\n` +
            `📈 *Trading* — How binary options trading works\n` +
            `⛏️ *Mining Packages* — Daily ROI investment packages\n` +
            `👥 *Referrals* — Earn commissions by inviting friends\n` +
            `🔐 *Security & 2FA* — Keep your account safe with [@XSpyTraderOtp_bot](https://t.me/XSpyTraderOtp_bot)\n` +
            `👤 *Account & Profile* — Registration, KYC, and profile setup\n\n` +
            `Just type your question and I'll answer immediately! 💡\n\n` +
            `🌐 *Platform:* ${SITE_URL}`,
        };

        await sendMessage(chatId, welcomeTexts[detectedLang] || welcomeTexts.en, {
          replyMarkup: buildPersistentReplyKeyboard(detectedLang),
        });

        const quickNavText: Record<SupportedLang, string> = {
          ar: "👇 *روابط الوصول السريع للمنصة (أو اختر من الأزرار بالأسفل):*",
          en: "👇 *Quick Navigation Links (or select an option below):*",
          fr: "👇 *Liens d'accès rapide (ou choisissez ci-dessous) :*",
          de: "👇 *Schnellzugriff-Links (oder wählen Sie unten) :*",
          ru: "👇 *Быстрые ссылки на платформу (или выберите внизу):*",
        };

        await sendMessage(chatId, quickNavText[detectedLang] || quickNavText.en, {
          replyMarkup: buildWelcomeInlineKeyboard(detectedLang),
        });
        return NextResponse.json({ ok: true });
      }

      if (text.trim() === "/help") {
        const helpTexts: Record<SupportedLang, string> = {
          ar:
            `🆘 *الأوامر المتاحة والمساعدة*\n\n` +
            `/start — رسالة الترحيب ونظرة عامة\n` +
            `/help — عرض قائمة المساعدة هذه\n\n` +
            `أو ببساطة اطرح سؤالك بأي لغة!\n\n` +
            `أمثلة:\n` +
            `• "كيف يتم السحب؟"\n` +
            `• "طريقة شحن الرصيد"\n` +
            `• "ما هي أرباح التداول؟"\n` +
            `• "كيف أفعل بوت التحقق؟"`,

          fr:
            `🆘 *Commandes disponibles et aide*\n\n` +
            `/start — Message de bienvenue et aperçu\n` +
            `/help — Afficher ce menu d'aide\n\n` +
            `Ou posez directement votre question dans votre langue !\n\n` +
            `Exemples :\n` +
            `• "Comment faire un retrait ?"\n` +
            `• "Comment fonctionne le trading ?"\n` +
            `• "Activer le bot de vérification"`,

          de:
            `🆘 *Verfügbare Befehle & Hilfe*\n\n` +
            `/start — Willkommensnachricht & Übersicht\n` +
            `/help — Dieses Hilfemenü anzeigen\n\n` +
            `Oder stellen Sie einfach Ihre Frage in Ihrer Sprache!\n\n` +
            `Beispiele:\n` +
            `• "Wie kann ich auszahlen?"\n` +
            `• "Wie funktioniert das Trading?"\n` +
            `• "Verifizierungs-Bot einrichten"`,

          ru:
            `🆘 *Доступные команды и помощь*\n\n` +
            `/start — Приветственное сообщение и обзор\n` +
            `/help — Меню помощи\n\n` +
            `Или просто задайте вопрос своими словами!\n\n` +
            `Примеры:\n` +
            `• "Как вывести деньги?"\n` +
            `• "Как пополнить баланс?"\n` +
            `• "Как работает трейдинг?"`,

          en:
            `🆘 *Available Commands*\n\n` +
            `/start — Welcome message & overview\n` +
            `/help — Show this help menu\n\n` +
            `Or simply ask me any question in plain language!\n\n` +
            `Examples:\n` +
            `• "How do I withdraw?"\n` +
            `• "How to deposit crypto?"\n` +
            `• "How does trading work?"\n` +
            `• "How to link verification bot?"`,
        };

        await sendMessage(chatId, helpTexts[detectedLang] || helpTexts.en);
        return NextResponse.json({ ok: true });
      }

      // Rate limit check
      if (isRateLimited(userId)) {
        const rateLimitTexts: Record<SupportedLang, string> = {
          ar: `⏳ يرجى الانتظار لحظات قبل إرسال رسالة أخرى.`,
          en: `⏳ Please wait a moment before sending another message.`,
          fr: `⏳ Veuillez patienter un instant avant d'envoyer un autre message.`,
          de: `⏳ Bitte warten Sie einen Moment, bevor Sie eine weitere Nachricht senden.`,
          ru: `⏳ Пожалуйста, подождите немного перед отправкой следующего сообщения.`,
        };
        await sendMessage(
          chatId,
          rateLimitTexts[detectedLang] || rateLimitTexts.en
        );
        return NextResponse.json({ ok: true });
      }

      const response = await getAIAnswer(text, userName, userId, detectedLang);
      await sendMessage(chatId, response.text, {
        replyMarkup: response.replyMarkup,
      });
      return NextResponse.json({ ok: true });
    }

    // ── 3. GROUP MESSAGES: Respond to questions & mentions ────────────────────
    if (chatType === "group" || chatType === "supergroup") {
      if (!isQuestionForBot(text)) return NextResponse.json({ ok: true });

      // Rate limit per user in groups
      if (isRateLimited(userId)) {
        return NextResponse.json({ ok: true });
      }

      // Strip bot mention from question text
      const cleanText = text
        .replace(/@xspy_ai_bot/gi, "")
        .replace(/@xspyaibot/gi, "")
        .replace(/@xspybot/gi, "")
        .trim();

      const response = await getAIAnswer(
        cleanText || text,
        userName,
        userId,
        detectedLang
      );
      await sendMessage(chatId, response.text, {
        replyToMessageId: messageId,
        replyMarkup: response.replyMarkup,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[GroupBot Webhook Error]", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

