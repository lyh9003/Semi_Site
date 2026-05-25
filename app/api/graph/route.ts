import { NextRequest, NextResponse } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const HDR = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type      = searchParams.get("type") || "";
  const limit     = parseInt(searchParams.get("limit") || "150");
  const minWeight = parseInt(searchParams.get("minWeight") || "2");

  const entitiesParams = new URLSearchParams({
    select: "id,name,type,mention_count",
    limit: String(limit * 3),
    order: "mention_count.desc",
  });
  if (type) entitiesParams.set("type", `eq.${type}`);

  // 최근 14일 핫 엔티티 (entity_mentions 집계)
  const since = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);

  const [entRes, relRes, hotRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/entities?${entitiesParams}`, {
      headers: HDR, cache: "no-store",
    }),
    fetch(
      `${SUPABASE_URL}/rest/v1/entity_relations` +
      `?select=from_entity_id,to_entity_id,weight,relation_type,relation_desc` +
      `&weight=gte.${minWeight}&order=weight.desc&limit=2000`,
      { headers: HDR, cache: "no-store" }
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/entity_mentions` +
      `?select=entity_id&date=gte.${since}&limit=5000`,
      { headers: HDR, cache: "no-store" }
    ),
  ]);

  if (!entRes.ok || !relRes.ok) {
    return NextResponse.json({ error: "fetch failed" }, { status: 500 });
  }

  const allEntities: { id: number; name: string; type: string; mention_count: number }[] = await entRes.json();
  const allRelations: { from_entity_id: number; to_entity_id: number; weight: number; relation_type?: string; relation_desc?: string }[] = await relRes.json();

  // 핫 엔티티 집계 (최근 14일 멘션 수 상위)
  let hotNodeIds = new Set<number>();
  if (hotRes.ok) {
    const hotMentions: { entity_id: number }[] = await hotRes.json();
    const countMap = new Map<number, number>();
    hotMentions.forEach(m => countMap.set(m.entity_id, (countMap.get(m.entity_id) ?? 0) + 1));
    const sorted = [...countMap.entries()].sort((a, b) => b[1] - a[1]);
    hotNodeIds = new Set(sorted.slice(0, 30).map(([id]) => id));
  }

  const connectedIds = new Set<number>();
  allRelations.forEach(r => {
    connectedIds.add(r.from_entity_id);
    connectedIds.add(r.to_entity_id);
  });

  const nodes = allEntities
    .filter(e => connectedIds.has(e.id))
    .slice(0, limit)
    .map(e => ({
      id: e.id,
      name: e.name,
      type: e.type,
      mentionCount: e.mention_count,
      isHot: hotNodeIds.has(e.id),
    }));

  const nodeIds = new Set(nodes.map(n => n.id));
  const edges = allRelations.filter(
    r => nodeIds.has(r.from_entity_id) && nodeIds.has(r.to_entity_id)
  );

  return NextResponse.json({ nodes, edges });
}
