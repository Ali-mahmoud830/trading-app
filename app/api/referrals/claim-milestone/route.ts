// app/api/referrals/claim-milestone/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

const DEFAULT_MILESTONES: { count: number; reward: number }[] = [
  { count: 5,   reward: 2.00  },
  { count: 10,  reward: 5.00  },
  { count: 20,  reward: 12.00 },
  { count: 50,  reward: 35.00 },
  { count: 100, reward: 80.00 },
  { count: 200, reward: 200.00 },
];

const adminClient = () =>
  createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

async function getDynamicMilestones(admin: any): Promise<{ count: number; reward: number }[]> {
  try {
    const { data } = await admin
      .from("system_settings")
      .select("value")
      .eq("key", "referral_milestones")
      .maybeSingle();

    if (data?.value && Array.isArray(data.value) && data.value.length > 0) {
      return [...data.value].sort((a, b) => a.count - b.count);
    }
  } catch (e) {
    console.error("[claim-milestone] failed to load dynamic milestones:", e);
  }
  return DEFAULT_MILESTONES;
}

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { milestone_count } = body;

  if (!milestone_count) {
    return NextResponse.json({ error: "Missing milestone_count" }, { status: 400 });
  }

  const admin = adminClient();
  const milestonesList = await getDynamicMilestones(admin);

  const milestone = milestonesList.find((m) => m.count === Number(milestone_count));
  if (!milestone) {
    return NextResponse.json({ error: "Invalid milestone" }, { status: 400 });
  }
  const userId = user.id;

  // 1. Count active referrals (referred users with at least one approved deposit)
  const { data: referrals } = await admin
    .from("referrals")
    .select("referred_id")
    .eq("referrer_id", userId)
    .eq("level", 1);

  const referredIds = (referrals ?? []).map((r: any) => r.referred_id).filter(Boolean);
  let activeCount = 0;
  if (referredIds.length > 0) {
    const { data: activeDeposits } = await admin
      .from("deposits")
      .select("user_id")
      .in("user_id", referredIds)
      .in("status", ["approved", "confirmed"]);

    const uniqueActive = new Set((activeDeposits ?? []).map((d: any) => d.user_id));
    activeCount = uniqueActive.size;
  }

  if (activeCount < milestone.count) {
    return NextResponse.json(
      { error: `You need ${milestone.count} active referrals. You have ${activeCount}.` },
      { status: 400 }
    );
  }

  // 2. Check if already claimed
  const { data: existingMilestone } = await admin
    .from("referral_milestones")
    .select("*")
    .eq("user_id", userId)
    .eq("milestone_count", milestone.count)
    .single();

  if (existingMilestone?.claimed) {
    return NextResponse.json({ error: "This milestone has already been claimed." }, { status: 400 });
  }

  // 3. Upsert milestone record (ensures it exists)
  const { error: upsertErr } = await admin
    .from("referral_milestones")
    .upsert(
      {
        user_id: userId,
        milestone_count: milestone.count,
        reward_amount: milestone.reward,
        claimed: true,
        claimed_at: new Date().toISOString(),
      },
      { onConflict: "user_id,milestone_count" }
    );

  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  // 4. Credit reward to user balance
  const { data: profile } = await admin
    .from("user_profiles")
    .select("balance")
    .eq("uid", userId)
    .single();

  const currentBalance = Number(profile?.balance ?? 0);
  const { error: balErr } = await admin
    .from("user_profiles")
    .update({ balance: currentBalance + milestone.reward })
    .eq("uid", userId);

  if (balErr) {
    // Rollback: un-claim the milestone
    await admin
      .from("referral_milestones")
      .update({ claimed: false, claimed_at: null })
      .eq("user_id", userId)
      .eq("milestone_count", milestone.count);
    return NextResponse.json({ error: "Failed to credit balance: " + balErr.message }, { status: 500 });
  }

  // 5. Send congratulations notification
  await admin.from("notifications").insert({
    user_id: userId,
    type: "success",
    title: "🎉 Milestone Reward Claimed!",
    message: `Congratulations! You've reached ${milestone.count} active referrals and earned $${milestone.reward.toFixed(2)}. The reward has been added to your balance.`,
    metadata: { milestone_count: milestone.count, reward: milestone.reward },
  });

  return NextResponse.json({
    success: true,
    reward: milestone.reward,
    message: `$${milestone.reward.toFixed(2)} added to your balance!`,
  });
}

// GET — returns milestone status for the current user
export async function GET() {
  const supabase = createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = adminClient();
  const userId = user.id;

  // Count active referrals
  const { data: referrals } = await admin
    .from("referrals")
    .select("referred_id")
    .eq("referrer_id", userId)
    .eq("level", 1);

  const referredIds = (referrals ?? []).map((r: any) => r.referred_id).filter(Boolean);
  let activeCount = 0;
  if (referredIds.length > 0) {
    const { data: activeDeposits } = await admin
      .from("deposits")
      .select("user_id")
      .in("user_id", referredIds)
      .in("status", ["approved", "confirmed"]);
    activeCount = new Set((activeDeposits ?? []).map((d: any) => d.user_id)).size;
  }

  // Fetch claimed milestones
  const { data: claimedRows } = await admin
    .from("referral_milestones")
    .select("milestone_count, reward_amount, claimed, claimed_at")
    .eq("user_id", userId);

  const claimedMap = new Map((claimedRows ?? []).map((r: any) => [r.milestone_count, r]));

  const milestonesList = await getDynamicMilestones(admin);

  const milestones = milestonesList.map((m) => {
    const existing = claimedMap.get(m.count);
    return {
      count: m.count,
      reward: m.reward,
      reached: activeCount >= m.count,
      claimed: existing?.claimed ?? false,
      claimed_at: existing?.claimed_at ?? null,
    };
  });

  return NextResponse.json({ activeCount, milestones });
}
