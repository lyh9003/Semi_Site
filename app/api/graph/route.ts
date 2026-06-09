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
      `?select=entity_id&created_at=gte.${since}&limit=5000`,
      { headers: HDR, cache: "no-store" }
    ),
  ]);

  if (!entRes.ok || !relRes.ok) {
    return NextResponse.json({ error: "fetch failed" }, { status: 500 });
  }

  const allEntities: { id: number; name: string; type: string; mention_count: number }[] = await entRes.json();
  const allRelations: { from_entity_id: number; to_entity_id: number; weight: number; relation_type?: string; relation_desc?: string }[] = await relRes.json();

  // 핫 엔티티 집계 — 타입별 상위 6개씩 선정
  let hotNodeIds = new Set<number>();
  let hotEntityIds: number[] = [];
  if (hotRes.ok) {
    const hotMentions: { entity_id: number }[] = await hotRes.json();
    const countMap = new Map<number, number>();
    hotMentions.forEach(m => countMap.set(m.entity_id, (countMap.get(m.entity_id) ?? 0) + 1));

    // entity_id → type 매핑 (allEntities 에 없는 것도 있으므로 별도 조회)
    const hotIds = [...countMap.keys()];
    const typeMap = new Map<number, string>(allEntities.map(e => [e.id, e.type]));

    // allEntities에 없는 hot id는 Supabase에서 타입 조회
    const missing = hotIds.filter(id => !typeMap.has(id));
    if (missing.length > 0) {
      const missingRes = await fetch(
        `${SUPABASE_URL}/rest/v1/entities?select=id,name,type,mention_count&id=in.(${missing.join(",")})`,
        { headers: HDR, cache: "no-store" }
      );
      if (missingRes.ok) {
        const missingEntities: { id: number; name: string; type: string; mention_count: number }[] = await missingRes.json();
        missingEntities.forEach(e => {
          typeMap.set(e.id, e.type);
          allEntities.push(e); // 풀에 추가
        });
      }
    }

    // 타입별로 최근 멘션 수 상위 6개씩
    const perType = new Map<string, [number, number][]>();
    for (const [id, cnt] of countMap.entries()) {
      const t = typeMap.get(id) ?? "unknown";
      if (!perType.has(t)) perType.set(t, []);
      perType.get(t)!.push([id, cnt]);
    }
    for (const arr of perType.values()) {
      arr.sort((a, b) => b[1] - a[1]);
      arr.slice(0, 6).forEach(([id]) => hotNodeIds.add(id));
    }
    hotEntityIds = [...hotNodeIds];
  }

  const connectedIds = new Set<number>();
  allRelations.forEach(r => {
    connectedIds.add(r.from_entity_id);
    connectedIds.add(r.to_entity_id);
  });

  // hot 엔티티는 풀 상위 제한 밖이어도 포함, 나머지는 mention_count 상위 limit개
  const hotSet = new Set(hotEntityIds.filter(id => connectedIds.has(id)));
  const nonHotPool = allEntities
    .filter(e => connectedIds.has(e.id) && !hotSet.has(e.id))
    .slice(0, limit);
  const finalEntities = [
    ...allEntities.filter(e => hotSet.has(e.id)),
    ...nonHotPool,
  ];
  const nodes = finalEntities.map(e => ({
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
