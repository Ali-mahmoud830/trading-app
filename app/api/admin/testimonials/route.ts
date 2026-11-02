import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const defaultTestimonials = [
  {
    id: "testi-1",
    name: "Sarah Johnson",
    role: "Professional Trader",
    content: "Xspy-trader has completely transformed how I manage my investments. The automated daily returns and instant execution are unmatched.",
    rating: 5,
    active: true,
  },
  {
    id: "testi-2",
    name: "Marcus Vance",
    role: "Crypto Asset Manager",
    content: "Clean UI, high security, and exceptional reliability. The daily package profit distribution is the smoothest in the industry.",
    rating: 5,
    active: true,
  },
  {
    id: "testi-3",
    name: "Elena Rostova",
    role: "VIP Investor",
    content: "Outstanding customer service and ultra-fast crypto gateway deposits. Highly recommended for serious crypto traders.",
    rating: 5,
    active: true,
  },
];

async function getStoredTestimonials(): Promise<any[]> {
  const { data, error } = await adminClient
    .from("system_settings")
    .select("value")
    .eq("key", "homepage_testimonials")
    .single();

  if (error || !data?.value || !Array.isArray(data.value)) {
    return defaultTestimonials;
  }
  return data.value;
}

async function saveTestimonials(list: any[]) {
  const { error } = await adminClient.from("system_settings").upsert({
    key: "homepage_testimonials",
    value: list,
  });
  if (error) throw error;
}

// GET all testimonials (admin view)
export async function GET() {
  try {
    const list = await getStoredTestimonials();
    return NextResponse.json({ success: true, testimonials: list });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// POST create a new testimonial
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, role, content, rating, active } = body;

    if (!name || !content) {
      return NextResponse.json({ success: false, error: "Name and content are required." }, { status: 400 });
    }

    const current = await getStoredTestimonials();
    const newTestimonial = {
      id: `testi-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: name.trim(),
      role: (role || "Platform User").trim(),
      content: content.trim(),
      rating: Math.min(5, Math.max(1, Number(rating) || 5)),
      active: active !== false,
      created_at: new Date().toISOString(),
    };

    const updated = [newTestimonial, ...current];
    await saveTestimonials(updated);

    return NextResponse.json({ success: true, testimonial: newTestimonial });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// PUT update an existing testimonial or reorder
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();

    // If an entire array is provided, save it directly (e.g. reordering or reset)
    if (Array.isArray(body.testimonials)) {
      await saveTestimonials(body.testimonials);
      return NextResponse.json({ success: true, testimonials: body.testimonials });
    }

    const { id, name, role, content, rating, active } = body;
    if (!id) {
      return NextResponse.json({ success: false, error: "ID is required for update." }, { status: 400 });
    }

    const current = await getStoredTestimonials();
    const index = current.findIndex((t) => t.id === id);

    if (index === -1) {
      return NextResponse.json({ success: false, error: "Testimonial not found." }, { status: 404 });
    }

    current[index] = {
      ...current[index],
      ...(name !== undefined && { name: name.trim() }),
      ...(role !== undefined && { role: role.trim() }),
      ...(content !== undefined && { content: content.trim() }),
      ...(rating !== undefined && { rating: Math.min(5, Math.max(1, Number(rating) || 5)) }),
      ...(active !== undefined && { active: Boolean(active) }),
      updated_at: new Date().toISOString(),
    };

    await saveTestimonials(current);
    return NextResponse.json({ success: true, testimonial: current[index] });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// DELETE a testimonial by ID
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ success: false, error: "ID is required." }, { status: 400 });
    }

    const current = await getStoredTestimonials();
    const filtered = current.filter((t) => t.id !== id);

    await saveTestimonials(filtered);
    return NextResponse.json({ success: true, testimonials: filtered });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
