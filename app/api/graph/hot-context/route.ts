import { NextResponse } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const HDR = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
const CACHE = { next: { revalidate: 1800 } } as const;

export interface CausalChain {
  events: string[];
  sectors: string[];
  products: string[];
  companies: string[];
  metrics: string[];
}
export interface SectorTemp {
  id: number;
  name: string;
  current: number;
  previous: number;
  deltaPercent: number;
}
export interface NewEntry {
  name: string;
  type: string;
  count: number;
}
export interface WeekPoint {
  label: string;
  counts: Record<string, number>;
}
export interface HotContext {
  causalChains: CausalChain[];
  sectorTemps: SectorTemp[];
  newEntries: NewEntry[];
  hotByType: Record<string, string[]>;
  weeklyTimeline: WeekPoint[];
  promptText: string;
}

function incMap(map: Map<number, number>, key: number) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function fmtWeekLabel(startMs: number, endMs: number) {
  const fmt = (ms: number) => { const d = new Date(ms); return `${d.getMonth()+1}/${d.getDate()}`; };
  return `${fmt(startMs)}~${fmt(endMs - 86400_000)}`;
}

export async function GET() {
  const now = Date.now();
  const d7  = new Date(now - 7  * 86400_000).toISOString();
  const d14 = new Date(now - 14 * 86400_000).toISOString();
  const d21 = new Date(now - 21 * 86400_000).toISOString();
  const d28 = new Date(now - 28 * 86400_000).toISOString();

  const [mentionsRes, entitiesRes, relationsRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/entity_mentions?select=entity_id,created_at&created_at=gte.${d28}&limit=20000`, { headers: HDR, ...CACHE }),
    fetch(`${SUPABASE_URL}/rest/v1/entities?select=id,name,type&limit=5000`, { headers: HDR, ...CACHE }),
    fetch(`${SUPABASE_URL}/rest/v1/entity_relations?select=from_entity_id,to_entity_id,weight&weight=gte.2&order=weight.desc&limit=3000`, { headers: HDR, ...CACHE }),
  ]);

  const mentions: { entity_id: number; created_at: string }[] = mentionsRes.ok ? await mentionsRes.json() : [];
  const entities: { id: number; name: string; type: string }[] = entitiesRes.ok ? await entitiesRes.json() : [];
  const relations: { from_entity_id: number; to_entity_id: number; weight: number }[] = relationsRes.ok ? await relationsRes.json() : [];

  const entityMap = new Map(entities.map(e => [e.id, e]));

  // ── 시간 윈도우별 분류 ────────────────────────────────────────────────────────
  const w4 = new Map<number, number>(); // 0~7d  (최근)
  const w3 = new Map<number, number>(); // 7~14d
  const w2 = new Map<number, number>(); // 14~21d
  const w1 = new Map<number, number>(); // 21~28d

  for (const m of mentions) {
    const t = m.created_at;
    if      (t >= d7)  incMap(w4, m.entity_id);
    else if (t >= d14) incMap(w3, m.entity_id);
    else if (t >= d21) incMap(w2, m.entity_id);
    else               incMap(w1, m.entity_id);
  }

  // ── 1. 타입별 hot 엔티티 (최근 7일 상위 6개) ──────────────────────────────────
  const typeGroups = new Map<string, [number, number][]>();
  for (const [id, cnt] of w4) {
    const e = entityMap.get(id);
    if (!e) continue;
    if (!typeGroups.has(e.type)) typeGroups.set(e.type, []);
    typeGroups.get(e.type)!.push([id, cnt]);
  }

  const hotByTypeIds = new Map<string, number[]>();
  const hotByType: Record<string, string[]> = {};
  for (const [type, arr] of typeGroups) {
    arr.sort((a, b) => b[1] - a[1]);
    const top = arr.slice(0, 6);
    hotByTypeIds.set(type, top.map(([id]) => id));
    hotByType[type] = top.map(([id]) => entityMap.get(id)?.name ?? "").filter(Boolean);
  }
  const allHotIds = new Set([...hotByTypeIds.values()].flat());

  // ── 2. 인과 클러스터 (hot 엔티티 간 연결 컴포넌트) ──────────────────────────────
  const adjList = new Map<number, number[]>();
  for (const rel of relations) {
    const { from_entity_id: f, to_entity_id: t } = rel;
    if (!allHotIds.has(f) || !allHotIds.has(t)) continue;
    if (!adjList.has(f)) adjList.set(f, []);
    if (!adjList.has(t)) adjList.set(t, []);
    adjList.get(f)!.push(t);
    adjList.get(t)!.push(f);
  }

  const visited = new Set<number>();
  const components: number[][] = [];
  for (const id of allHotIds) {
    if (visited.has(id)) continue;
    const comp: number[] = [];
    const queue = [id];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      comp.push(cur);
      for (const nb of (adjList.get(cur) ?? [])) {
        if (!visited.has(nb)) queue.push(nb);
      }
    }
    if (comp.length > 1) components.push(comp);
  }

  components.sort((a, b) => b.length - a.length);
  const causalChains: CausalChain[] = components.slice(0, 3).map(comp => {
    const chain: CausalChain = { events: [], sectors: [], products: [], companies: [], metrics: [] };
    for (const id of comp) {
      const e = entityMap.get(id);
      if (!e) continue;
      if (e.type in chain) (chain as unknown as Record<string, string[]>)[e.type].push(e.name);
    }
    return chain;
  }).filter(c => Object.values(c).some(arr => arr.length > 0));

  // ── 3. 섹터 온도 ─────────────────────────────────────────────────────────────
  const sectorEntities = entities.filter(e => e.type === "sector");
  const sectorIds = new Set(sectorEntities.map(e => e.id));
  const sectorConnected = new Map<number, Set<number>>();
  for (const se of sectorEntities) sectorConnected.set(se.id, new Set());

  for (const rel of relations) {
    const { from_entity_id: f, to_entity_id: t } = rel;
    if (sectorIds.has(f)) sectorConnected.get(f)!.add(t);
    if (sectorIds.has(t)) sectorConnected.get(t)!.add(f);
  }

  const sectorTemps: SectorTemp[] = sectorEntities.map(se => {
    let current = w4.get(se.id) ?? 0;
    let previous = w3.get(se.id) ?? 0;
    for (const id of (sectorConnected.get(se.id) ?? [])) {
      current  += w4.get(id) ?? 0;
      previous += w3.get(id) ?? 0;
    }
    const deltaPercent = previous === 0 ? (current > 0 ? 100 : 0) : Math.round((current - previous) / previous * 100);
    return { id: se.id, name: se.name, current, previous, deltaPercent };
  })
  .filter(s => s.current > 0 || s.previous > 0)
  .sort((a, b) => b.current - a.current)
  .slice(0, 10);

  // ── 4. 신규 진입 엔티티 ───────────────────────────────────────────────────────
  const newEntries: NewEntry[] = [];
  for (const [id, cnt] of w4) {
    const prev = w3.get(id) ?? 0;
    const e = entityMap.get(id);
    if (!e || cnt < 3) continue;
    if (cnt > prev * 3) {
      newEntries.push({ name: e.name, type: e.type, count: cnt });
    }
  }
  newEntries.sort((a, b) => b.count - a.count);
  const topNewEntries = newEntries.slice(0, 8);

  // ── 5. 주간 타임라인 ──────────────────────────────────────────────────────────
  const windows = [
    { label: fmtWeekLabel(now - 28*86400_000, now - 21*86400_000), countMap: w1 },
    { label: fmtWeekLabel(now - 21*86400_000, now - 14*86400_000), countMap: w2 },
    { label: fmtWeekLabel(now - 14*86400_000, now - 7*86400_000),  countMap: w3 },
    { label: fmtWeekLabel(now - 7*86400_000,  now),                countMap: w4 },
  ];
  const weeklyTimeline: WeekPoint[] = windows.map(({ label, countMap }) => {
    const counts: Record<string, number> = {};
    for (const [id, cnt] of countMap) {
      const type = entityMap.get(id)?.type;
      if (type) counts[type] = (counts[type] ?? 0) + cnt;
    }
    return { label, counts };
  });

  // ── 6. 브리핑 프롬프트 주입 텍스트 ─────────────────────────────────────────────
  const TYPE_KO: Record<string, string> = { event:"이벤트", sector:"섹터", product:"제품/기술", company:"기업", metric:"지표" };
  const lines: string[] = ["[지식 그래프 - 최근 7일 핫 엔티티]"];
  for (const [type, names] of Object.entries(hotByType)) {
    if (names.length === 0) continue;
    lines.push(`${TYPE_KO[type] ?? type}: ${names.join(", ")}`);
  }
  if (causalChains.length > 0) {
    lines.push("\n[인과 연결 클러스터]");
    for (const c of causalChains) {
      const parts: string[] = [];
      if (c.events.length)    parts.push(`이벤트: ${c.events.join(", ")}`);
      if (c.sectors.length)   parts.push(`섹터: ${c.sectors.join(", ")}`);
      if (c.products.length)  parts.push(`제품: ${c.products.join(", ")}`);
      if (c.companies.length) parts.push(`기업: ${c.companies.join(", ")}`);
      if (c.metrics.length)   parts.push(`지표: ${c.metrics.join(", ")}`);
      if (parts.length > 1) lines.push(parts.join(" → "));
    }
  }
  if (topNewEntries.length > 0) {
    lines.push(`\n[최근 이슈 (지난주 대비 3배+)]: ${topNewEntries.map(e => `${e.name}(${TYPE_KO[e.type] ?? e.type})`).join(", ")}`);
  }
  const promptText = lines.join("\n");

  return NextResponse.json(
    { causalChains, sectorTemps, newEntries: topNewEntries, hotByType, weeklyTimeline, promptText },
    { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" } }
  );
}
