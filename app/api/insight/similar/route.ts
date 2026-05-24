import { NextRequest, NextResponse } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const TABLE_MAP: Record<string, string> = {
  news: "news",
  report: "stock_reports",
  telegram: "telegram_messages",
};

async function fetchEmbedding(table: string, id: number): Promise<number[] | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}&select=embedding`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      cache: "no-store",
    }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  const raw = rows[0]?.embedding;
  if (!raw) return null;
  // pgvector가 문자열 "[0.1,0.2,...]" 또는 배열로 반환할 수 있음
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function rpc(fn: string, embedding: number[], threshold: number, count: number) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query_embedding: embedding,
      match_threshold: threshold,
      match_count: count,
    }),
    cache: "no-store",
  });
  if (!res.ok) return [];
  return res.json();
}

export async function POST(req: NextRequest) {
  const { source, id } = await req.json() as { source: string; id: number };

  const table = TABLE_MAP[source];
  if (!table) return NextResponse.json({ error: "unknown source" }, { status: 400 });

  const embedding = await fetchEmbedding(table, id);
  if (!embedding) {
    return NextResponse.json(
      { error: "이 항목의 임베딩이 아직 생성되지 않았습니다. generate_embeddings.py를 실행해주세요." },
      { status: 404 }
    );
  }

  const THRESHOLD = 0.3;
  const COUNT = 6;

  const [news, reports, telegrams] = await Promise.all([
    rpc("match_news", embedding, THRESHOLD, COUNT),
    rpc("match_reports", embedding, THRESHOLD, COUNT),
    rpc("match_telegrams", embedding, THRESHOLD, COUNT),
  ]);

  return NextResponse.json({
    news: (news as { id: number }[]).filter(i => !(source === "news" && i.id === id)).slice(0, 5),
    reports: (reports as { id: number }[]).filter(i => !(source === "report" && i.id === id)).slice(0, 5),
    telegrams: (telegrams as { id: number }[]).filter(i => !(source === "telegram" && i.id === id)).slice(0, 5),
  });
}
