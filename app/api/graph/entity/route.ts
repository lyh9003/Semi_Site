import { NextRequest, NextResponse } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const HDR = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const entityId = searchParams.get("id");
  if (!entityId) return NextResponse.json({ error: "id required" }, { status: 400 });

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/get_entity_docs`,
    {
      method: "POST",
      headers: { ...HDR, "Content-Type": "application/json" },
      body: JSON.stringify({ p_entity_id: parseInt(entityId) }),
      cache: "no-store",
    }
  );

  if (!res.ok) return NextResponse.json({ error: "fetch failed" }, { status: 500 });

  const data = await res.json();
  return NextResponse.json({
    news:      data.news      ?? [],
    reports:   data.reports   ?? [],
    telegrams: data.telegrams ?? [],
    total:     data.total     ?? 0,
  });
}
