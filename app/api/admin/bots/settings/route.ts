import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getGroupBotToken } from "@/lib/telegram-tokens";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const GROUP_BOT_TOKEN = getGroupBotToken();

let cachedBotId: number | null = null;

async function getGroupBotId(): Promise<number | null> {
  if (cachedBotId) return cachedBotId;
  if (!GROUP_BOT_TOKEN) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${GROUP_BOT_TOKEN}/getMe`);
    const data = await res.json();
    if (data.ok && data.result?.id) {
      cachedBotId = data.result.id;
      return cachedBotId;
    }
  } catch {}
  return null;
}

export interface GroupInspection {
  chatId: string;
  title: string;
  type: string;
  botStatus: "administrator" | "creator" | "member" | "restricted" | "left" | "kicked" | "unknown";
  isAdmin: boolean;
  canSendMessages: boolean;
  error?: string;
}

async function inspectTelegramChat(chatId: string, botId: number | null): Promise<GroupInspection> {
  const result: GroupInspection = {
    chatId,
    title: `Chat ${chatId}`,
    type: "unknown",
    botStatus: "unknown",
    isAdmin: false,
    canSendMessages: true,
  };

  if (!GROUP_BOT_TOKEN) {
    result.error = "Bot token not configured";
    return result;
  }

  try {
    const chatRes = await fetch(
      `https://api.telegram.org/bot${GROUP_BOT_TOKEN}/getChat?chat_id=${encodeURIComponent(chatId)}`
    );
    const chatData = await chatRes.json();

    if (!chatData.ok) {
      result.error = chatData.description || "Failed to find chat";
      return result;
    }

    result.title = chatData.result?.title || chatData.result?.username || `Chat ${chatId}`;
    result.type = chatData.result?.type || "group";

    if (botId) {
      const memberRes = await fetch(
        `https://api.telegram.org/bot${GROUP_BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(
          chatId
        )}&user_id=${botId}`
      );
      const memberData = await memberRes.json();

      if (memberData.ok && memberData.result) {
        const status = memberData.result.status;
        result.botStatus = status;
        result.isAdmin = status === "administrator" || status === "creator";
        if (memberData.result.can_send_messages === false) {
          result.canSendMessages = false;
        }
      }
    }
  } catch (err: any) {
    result.error = err.message || "Network inspection error";
  }

  return result;
}

// ─── GET /api/admin/bots/settings ─────────────────────────────────────────────
export async function GET() {
  try {
    const { data: groupSetting } = await adminClient
      .from("system_settings")
      .select("value")
      .eq("key", "telegram_group_chat_id")
      .maybeSingle();

    const groupChatId = (groupSetting?.value as string) || process.env.TELEGRAM_GROUP_CHAT_ID || "";

    const rawIds = groupChatId
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const botId = await getGroupBotId();
    const groups: GroupInspection[] = [];

    for (const cid of rawIds) {
      const inspected = await inspectTelegramChat(cid, botId);
      groups.push(inspected);
    }

    return NextResponse.json({
      ok: true,
      telegramGroupChatId: groupChatId,
      groups,
      botId,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

// ─── POST /api/admin/bots/settings ────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, groupChatId, chatId } = body;

    // 1. Save Group Chat IDs (comma-separated or multiple)
    if (action === "save_group_id" || action === "save_group_ids") {
      const input = String(groupChatId || "").trim();
      if (!input) {
        return NextResponse.json(
          { ok: false, message: "معرف مجموعة تيليجرام لا يمكن أن يكون فارغاً" },
          { status: 400 }
        );
      }

      // Normalise list
      const ids = Array.from(
        new Set(
          input
            .split(/[,;\n]+/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        )
      );

      const cleanString = ids.join(", ");

      const { error } = await adminClient
        .from("system_settings")
        .upsert({ key: "telegram_group_chat_id", value: cleanString }, { onConflict: "key" });

      if (error) {
        return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
      }

      const botId = await getGroupBotId();
      const inspected = await Promise.all(ids.map((id) => inspectTelegramChat(id, botId)));

      return NextResponse.json({
        ok: true,
        message: "تم حفظ معرفات المجموعات بنجاح وتحديث حالتها",
        groupChatId: cleanString,
        groups: inspected,
      });
    }

    // 2. Remove a single group chat ID
    if (action === "remove_group_id") {
      const targetToRemove = String(chatId || "").trim();
      if (!targetToRemove) {
        return NextResponse.json({ ok: false, message: "معرف المجموعة غير محدد" }, { status: 400 });
      }

      const { data: groupSetting } = await adminClient
        .from("system_settings")
        .select("value")
        .eq("key", "telegram_group_chat_id")
        .maybeSingle();

      const existing = String(groupSetting?.value || "")
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s !== targetToRemove);

      const newString = existing.join(", ");

      await adminClient
        .from("system_settings")
        .upsert({ key: "telegram_group_chat_id", value: newString }, { onConflict: "key" });

      return NextResponse.json({
        ok: true,
        message: `تمت إزالة المجموعة (${targetToRemove}) بنجاح`,
        groupChatId: newString,
      });
    }

    // 3. Test sending message to a specific chat ID
    if (action === "test_group") {
      const targetChat = String(chatId || groupChatId || "").trim();
      if (!targetChat) {
        return NextResponse.json({ ok: false, message: "معرف المجموعة غير محدد" }, { status: 400 });
      }

      if (!GROUP_BOT_TOKEN) {
        return NextResponse.json({ ok: false, message: "رمز بوت المجموعة غير مهيأ" }, { status: 400 });
      }

      const testMsg =
        `🧪 *XSPY Trader Bot — Connection Test*\n\n` +
        `✅ Bot is connected successfully and ready to broadcast signals and daily reports.\n` +
        `⏱ Timestamp: \`${new Date().toISOString()}\``;

      const res = await fetch(`https://api.telegram.org/bot${GROUP_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: targetChat,
          text: testMsg,
          parse_mode: "Markdown",
        }),
      });

      const resJson = await res.json();
      if (!resJson.ok) {
        return NextResponse.json(
          {
            ok: false,
            message: `فشل إرسال رسالة الاختبار: ${resJson.description || "خطأ غير معروف"}`,
          },
          { status: 400 }
        );
      }

      return NextResponse.json({
        ok: true,
        message: "تم إرسال رسالة الاختبار بنجاح إلى المجموعة! ✅",
      });
    }

    // 4. Auto-detect Group ID
    if (action === "auto_detect") {
      if (!GROUP_BOT_TOKEN) {
        return NextResponse.json(
          { ok: false, message: "رمز بوت المجموعة غير مهيأ" },
          { status: 400 }
        );
      }

      // Check current setting
      const { data: groupSetting } = await adminClient
        .from("system_settings")
        .select("value")
        .eq("key", "telegram_group_chat_id")
        .maybeSingle();

      const existingIds = String(groupSetting?.value || "")
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      // Check admin_notifications logs safely if table exists
      try {
        const { data: logs } = await adminClient
          .from("admin_notifications")
          .select("data")
          .order("created_at", { ascending: false })
          .limit(20);

        if (logs) {
          for (const log of logs) {
            const cid = log.data?.chatId || log.data?.groupChatId;
            if (cid && (String(cid).startsWith("-") || Number(cid) < 0)) {
              const cleanId = String(cid);
              if (!existingIds.includes(cleanId)) {
                existingIds.push(cleanId);
              }
            }
          }
        }
      } catch {}

      const cleanString = existingIds.join(", ");
      if (cleanString) {
        await adminClient
          .from("system_settings")
          .upsert({ key: "telegram_group_chat_id", value: cleanString }, { onConflict: "key" });

        const botId = await getGroupBotId();
        const inspected = await Promise.all(existingIds.map((id) => inspectTelegramChat(id, botId)));

        return NextResponse.json({
          ok: true,
          detectedChatId: cleanString,
          groupChatId: cleanString,
          groups: inspected,
          message: `تم تحديث المجموعات المرصودة: ${cleanString}`,
        });
      }

      return NextResponse.json({
        ok: false,
        message: "لم يتم العثور على مجموعات جديدة. أضف @XSpyAIBot للمجموعة وأرسل رسالة داخلها، أو اكتب معرف المجموعة يدوياً.",
      });
    }

    return NextResponse.json({ ok: false, message: "إجراء غير معروف" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
