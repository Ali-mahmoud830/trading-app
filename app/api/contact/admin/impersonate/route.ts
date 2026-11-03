// app/api/contact/admin/impersonate/route.ts
import { NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

const adminClient = () =>
  createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

export async function POST(req: Request) {
  try {
    const { uid } = await req.json();

    if (!uid) {
      return NextResponse.json({ error: "Missing UID" }, { status: 400 });
    }

    // Verify the caller is an admin
    const supabase = createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = adminClient();
    const { data: callerProfile } = await db
      .from("user_profiles")
      .select("role")
      .eq("uid", user.id)
      .single();

    if (callerProfile?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden: Admins only" }, { status: 403 });
    }

    // Get the target user's email
    const { data: targetUser, error: userErr } = await db.auth.admin.getUserById(uid);
    if (userErr || !targetUser?.user) {
      return NextResponse.json({ error: "Target user not found" }, { status: 404 });
    }

    const targetEmail = targetUser.user.email;
    if (!targetEmail) {
      return NextResponse.json({ error: "Target user has no email" }, { status: 400 });
    }

    // Generate a magic link for the target user
    const { data: linkData, error: linkErr } = await db.auth.admin.generateLink({
      type: "magiclink",
      email: targetEmail,
    });

    if (linkErr || !linkData) {
      return NextResponse.json({ error: linkErr?.message ?? "Failed to generate link" }, { status: 500 });
    }

    // Return the magic link for the client to use
    return NextResponse.json({
      success: true,
      action_link: (linkData.properties as any)?.action_link ?? (linkData.properties as any)?.email_otp_link,
      hashed_token: (linkData.properties as any)?.hashed_token,
    });
  } catch (e: any) {
    console.error("[impersonate]", e);
    return NextResponse.json({ error: e.message ?? "Server error" }, { status: 500 });
  }
}
