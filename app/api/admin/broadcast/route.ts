// app/api/admin/broadcast/route.ts
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

import { translateMessagePair } from "@/lib/translator";

export async function POST(req: Request) {
  const supabase = createClient();
  const adminId = await verifyAdmin(supabase);
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const { title, message, target_type, target_user_id, notification_type } = body;
  let translations = body.translations;

  if (!title || !message) {
    return NextResponse.json({ error: "Title and message are required" }, { status: 400 });
  }

  // If translations not provided or incomplete, auto-translate into en, ar, fr, de
  if (!translations || !translations.en || !translations.ar || !translations.fr || !translations.de) {
    try {
      const generated = await translateMessagePair(title, message);
      translations = {
        ...generated,
        ...(translations || {}),
      };
    } catch (err) {
      console.warn("[Broadcast] Auto-translate failed, using fallback:", err);
      translations = {
        en: { title, message },
        ar: { title, message },
        fr: { title, message },
        de: { title, message },
      };
    }
  }

  const db = adminClient();

  // Log the broadcast
  await db.from("broadcasts").insert({
    admin_id: adminId,
    title,
    message,
    target_type: target_type ?? "all",
    target_user_id: target_user_id ?? null,
    notification_type: notification_type ?? "info",
  });

  // Get target user IDs
  let userIds: string[] = [];
  if (target_type === "user" && target_user_id) {
    userIds = [target_user_id];
  } else {
    // Send to all non-admin users
    const { data: allUsers } = await db
      .from("user_profiles")
      .select("uid")
      .neq("role", "admin");
    userIds = (allUsers ?? []).map((u: any) => u.uid);
  }

  // Insert notifications in batches of 100 with translations in metadata
  const batchSize = 100;
  let totalSent = 0;
  for (let i = 0; i < userIds.length; i += batchSize) {
    const batch = userIds.slice(i, i + batchSize);
    const notifications = batch.map((uid) => ({
      user_id: uid,
      type: notification_type ?? "broadcast",
      title,
      message,
      metadata: { from_admin: true, admin_id: adminId, translations },
    }));
    const { error } = await db.from("notifications").insert(notifications);
    if (!error) totalSent += batch.length;
  }

  return NextResponse.json({ success: true, sent_to: totalSent, translations });
}

// Update system settings (welcome message, trading alert)
export async function PATCH(req: Request) {
  const supabase = createClient();
  const adminId = await verifyAdmin(supabase);
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const { key, value } = body;

  if (!key || !value) {
    return NextResponse.json({ error: "key and value required" }, { status: 400 });
  }

  // Auto-translate welcome_message or trading_alert if translations not present
  if ((key === "welcome_message" || key === "trading_alert") && value.title && value.message) {
    if (!value.translations || !value.translations.en || !value.translations.ar) {
      try {
        const autoTrans = await translateMessagePair(value.title, value.message);
        value.translations = {
          ...autoTrans,
          ...(value.translations || {}),
        };
      } catch (err) {
        console.warn("[SystemSettings] Auto-translate failed:", err);
      }
    }
  }

  const db = adminClient();
  const { error } = await db
    .from("system_settings")
    .upsert({ key, value }, { onConflict: "key" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, value });
}

export async function GET() {
  const supabase = createClient();
  const adminId = await verifyAdmin(supabase);
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const db = adminClient();
  const { data: broadcasts } = await db
    .from("broadcasts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  const { data: settings } = await db
    .from("system_settings")
    .select("*")
    .in("key", ["welcome_message", "trading_alert"]);

  return NextResponse.json({ broadcasts: broadcasts ?? [], settings: settings ?? [] });
}
