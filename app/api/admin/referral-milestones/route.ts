import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

export const DEFAULT_MILESTONES: { count: number; reward: number }[] = [
  { count: 5, reward: 2.0 },
  { count: 10, reward: 5.0 },
  { count: 20, reward: 12.0 },
  { count: 50, reward: 35.0 },
  { count: 100, reward: 80.0 },
  { count: 200, reward: 200.0 },
];

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function checkAdmin() {
  const supabase = createServerClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return false;

  const { data: profile } = await adminClient
    .from("user_profiles")
    .select("role")
    .eq("uid", user.id)
    .single();

  return profile?.role === "admin";
}

// GET: Return current milestone rewards
export async function GET() {
  try {
    const { data: setting, error } = await adminClient
      .from("system_settings")
      .select("value")
      .eq("key", "referral_milestones")
      .maybeSingle();

    if (error) {
      console.error("[referral-milestones] GET DB error:", error);
    }

    let milestones = DEFAULT_MILESTONES;
    if (setting?.value && Array.isArray(setting.value)) {
      milestones = setting.value;
    }

    // Sort ascending by count
    milestones.sort((a, b) => a.count - b.count);

    return NextResponse.json({ milestones });
  } catch (err: any) {
    console.error("[referral-milestones] GET error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST: Add a new milestone reward tier
export async function POST(req: NextRequest) {
  try {
    const isAdmin = await checkAdmin();
    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden: Admin access required" }, { status: 403 });
    }

    const body = await req.json();
    const count = Number(body.count);
    const reward = Number(body.reward);

    if (!count || count <= 0) {
      return NextResponse.json({ error: "Invalid referral count. Must be a positive number." }, { status: 400 });
    }
    if (isNaN(reward) || reward <= 0) {
      return NextResponse.json({ error: "Invalid reward amount. Must be greater than 0." }, { status: 400 });
    }

    // Fetch existing milestones
    const { data: setting } = await adminClient
      .from("system_settings")
      .select("value")
      .eq("key", "referral_milestones")
      .maybeSingle();

    let list: { count: number; reward: number }[] = DEFAULT_MILESTONES;
    if (setting?.value && Array.isArray(setting.value)) {
      list = [...setting.value];
    }

    if (list.some((m) => m.count === count)) {
      return NextResponse.json(
        { error: `A milestone for ${count} referrals already exists. Please edit it instead.` },
        { status: 400 }
      );
    }

    list.push({ count, reward });
    list.sort((a, b) => a.count - b.count);

    // Save back to system_settings
    const { error: saveErr } = await adminClient
      .from("system_settings")
      .upsert(
        {
          key: "referral_milestones",
          value: list,
          description: "Referral milestone reward tiers (active referrals -> reward $)",
          category: "referrals",

          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" }
      );

    if (saveErr) throw saveErr;

    return NextResponse.json({ success: true, milestones: list });
  } catch (err: any) {
    console.error("[referral-milestones] POST error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT: Update an existing milestone tier OR replace full list
export async function PUT(req: NextRequest) {
  try {
    const isAdmin = await checkAdmin();
    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden: Admin access required" }, { status: 403 });
    }

    const body = await req.json();

    // Reset to defaults
    if (body.reset) {
      const { error: saveErr } = await adminClient
        .from("system_settings")
        .upsert(
          {
            key: "referral_milestones",
            value: DEFAULT_MILESTONES,
            description: "Referral milestone reward tiers (active referrals -> reward $)",
            category: "referrals",

            updated_at: new Date().toISOString(),
          },
          { onConflict: "key" }
        );
      if (saveErr) throw saveErr;
      return NextResponse.json({ success: true, milestones: DEFAULT_MILESTONES });
    }

    // Replace full array
    if (Array.isArray(body.milestones)) {
      const sorted = [...body.milestones].sort((a, b) => a.count - b.count);
      const { error: saveErr } = await adminClient
        .from("system_settings")
        .upsert(
          {
            key: "referral_milestones",
            value: sorted,
            description: "Referral milestone reward tiers (active referrals -> reward $)",
            category: "referrals",

            updated_at: new Date().toISOString(),
          },
          { onConflict: "key" }
        );
      if (saveErr) throw saveErr;
      return NextResponse.json({ success: true, milestones: sorted });
    }

    // Single item edit: { oldCount, count, reward }
    const oldCount = Number(body.oldCount);
    const count = Number(body.count);
    const reward = Number(body.reward);

    if (!oldCount || !count || count <= 0 || isNaN(reward) || reward <= 0) {
      return NextResponse.json({ error: "Invalid parameters." }, { status: 400 });
    }

    const { data: setting } = await adminClient
      .from("system_settings")
      .select("value")
      .eq("key", "referral_milestones")
      .maybeSingle();

    let list: { count: number; reward: number }[] = DEFAULT_MILESTONES;
    if (setting?.value && Array.isArray(setting.value)) {
      list = [...setting.value];
    }

    // Check conflict if changing count
    if (oldCount !== count && list.some((m) => m.count === count)) {
      return NextResponse.json({ error: `A milestone for ${count} referrals already exists.` }, { status: 400 });
    }

    const idx = list.findIndex((m) => m.count === oldCount);
    if (idx === -1) {
      return NextResponse.json({ error: "Milestone not found." }, { status: 404 });
    }

    list[idx] = { count, reward };
    list.sort((a, b) => a.count - b.count);

    const { error: saveErr } = await adminClient
      .from("system_settings")
      .upsert(
        {
          key: "referral_milestones",
          value: list,
          description: "Referral milestone reward tiers (active referrals -> reward $)",
          category: "referrals",

          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" }
      );

    if (saveErr) throw saveErr;

    return NextResponse.json({ success: true, milestones: list });
  } catch (err: any) {
    console.error("[referral-milestones] PUT error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE: Remove a milestone reward tier
export async function DELETE(req: NextRequest) {
  try {
    const isAdmin = await checkAdmin();
    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden: Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const count = Number(searchParams.get("count"));

    if (!count) {
      return NextResponse.json({ error: "Missing milestone count parameter." }, { status: 400 });
    }

    const { data: setting } = await adminClient
      .from("system_settings")
      .select("value")
      .eq("key", "referral_milestones")
      .maybeSingle();

    let list: { count: number; reward: number }[] = DEFAULT_MILESTONES;
    if (setting?.value && Array.isArray(setting.value)) {
      list = [...setting.value];
    }

    const filtered = list.filter((m) => m.count !== count);
    if (filtered.length === list.length) {
      return NextResponse.json({ error: "Milestone tier not found." }, { status: 404 });
    }

    const { error: saveErr } = await adminClient
      .from("system_settings")
      .upsert(
        {
          key: "referral_milestones",
          value: filtered,
          description: "Referral milestone reward tiers (active referrals -> reward $)",
          category: "referrals",

          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" }
      );

    if (saveErr) throw saveErr;

    return NextResponse.json({ success: true, milestones: filtered });
  } catch (err: any) {
    console.error("[referral-milestones] DELETE error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
