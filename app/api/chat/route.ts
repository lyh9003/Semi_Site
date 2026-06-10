import { NextRequest } from "next/server";
import OpenAI from "openai";

export const maxDuration = 30;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const HDR = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

const SYSTEM = `너는 한국 반도체·주식 시황 전문가 AI야.
제공된 최신 뉴스·증권리포트·텔레그램 정보를 바탕으로 질문에 답변해.

규칙:
- 반드시 한국어로 답변
- 핵심 결론을 먼저, 이후 근거와 맥락을 충분히 설명
- 출처는 [뉴스], [리포트], [텔레그램] 태그로 명시
- 제공된 자료에 없는 내용은 추측하지 말고 솔직하게 말해
- 구체적인 수치·기업명·날짜를 활용해 신뢰도 높은 답변 작성
- 8~12문장으로 충분히 답변`;

async function matchDocs(fn: string, embedding: number[], extra?: Record<string, unknown>): Promise<unknown[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { ...HDR, "Content-Type": "application/json" },
    body: JSON.stringify({ query_embedding: embedding, match_count: 5, ...extra }),
    cache: "no-store",
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`${fn} failed (${res.status}): ${errText}`);
  }
  return res.json();
}

interface QueryMeta { isRecent: boolean; entityNames: string[] }

async function classifyQuery(openai: OpenAI, question: string): Promise<QueryMeta> {
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `반도체 시황 질문을 분석해. 두 줄로만 응답해:
1번째 줄: 최신 정보가 중요하면 "recent", 아니면 "general"
2번째 줄: 질문에 나온 반도체 기업·제품·지표·이벤트 이름을 쉼표로 나열. 없으면 "none"`,
      },
      { role: "user", content: question },
    ],
    max_tokens: 60,
    temperature: 0,
  });
  const lines = (res.choices[0].message.content ?? "").trim().split("\n");
  const isRecent = lines[0]?.trim().toLowerCase().startsWith("recent") ?? true;
  const raw = lines[1]?.trim() ?? "none";
  const entityNames = raw === "none" ? [] : raw.split(",").map(s => s.trim()).filter(Boolean);
  return { isRecent, entityNames };
}

async function fetchGraphContext(entityNames: string[]): Promise<string> {
  if (entityNames.length === 0) return "";
  try {
    // 엔티티 이름으로 ID 조회
    const entRes = await fetch(
      `${SUPABASE_URL}/rest/v1/entities?select=id,name,type&name=in.(${entityNames.slice(0,5).join(",")})&limit=10`,
      { headers: HDR, cache: "no-store" }
    );
    if (!entRes.ok) return "";
    const ents: { id: number; name: string; type: string }[] = await entRes.json();
    if (ents.length === 0) return "";
    const ids = ents.map(e => e.id);

    // 해당 엔티티의 relations 조회
    const relRes = await fetch(
      `${SUPABASE_URL}/rest/v1/entity_relations?select=from_entity_id,to_entity_id,weight,relation_type,relation_desc&or=(from_entity_id.in.(${ids.join(",")}),to_entity_id.in.(${ids.join(",")})&weight=gte.2&order=weight.desc&limit=30`,
      { headers: HDR, cache: "no-store" }
    );
    if (!relRes.ok) return "";
    const rels: { from_entity_id: number; to_entity_id: number; weight: number; relation_type?: string; relation_desc?: string }[] = await relRes.json();
    if (rels.length === 0) return "";

    // 이웃 엔티티 ID 수집
    const neighborIds = new Set<number>();
    rels.forEach(r => { neighborIds.add(r.from_entity_id); neighborIds.add(r.to_entity_id); });
    ids.forEach(id => neighborIds.delete(id));

    const nbRes = await fetch(
      `${SUPABASE_URL}/rest/v1/entities?select=id,name,type&id=in.(${[...neighborIds].slice(0,30).join(",")})`,
      { headers: HDR, cache: "no-store" }
    );
    const neighbors: { id: number; name: string; type: string }[] = nbRes.ok ? await nbRes.json() : [];
    const nbMap = new Map([...ents, ...neighbors].map(e => [e.id, e]));

    const TYPE_KO: Record<string, string> = { event:"이벤트", sector:"섹터", product:"제품/기술", company:"기업", metric:"지표" };

    const lines = ["[지식 그래프 연관 정보]"];
    for (const e of ents) {
      const connected = rels
        .filter(r => r.from_entity_id === e.id || r.to_entity_id === e.id)
        .slice(0, 8)
        .map(r => {
          const nbId = r.from_entity_id === e.id ? r.to_entity_id : r.from_entity_id;
          const nb = nbMap.get(nbId);
          const rel = r.relation_desc ?? r.relation_type ?? "연관";
          return nb ? `${nb.name}(${TYPE_KO[nb.type] ?? nb.type}) [${rel}]` : null;
        })
        .filter(Boolean);
      if (connected.length > 0) {
        lines.push(`${e.name}(${TYPE_KO[e.type] ?? e.type})의 연관: ${connected.join(", ")}`);
      }
    }
    return lines.length > 1 ? lines.join("\n") : "";
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  const { question } = await req.json() as { question: string };
  if (!question?.trim()) return new Response("question required", { status: 400 });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // 1. 질문 분류 + 임베딩 병렬 실행
  const [queryMeta, embRes] = await Promise.all([
    classifyQuery(openai, question),
    openai.embeddings.create({ model: "text-embedding-3-small", input: question }),
  ]);
  const { isRecent, entityNames } = queryMeta;
  const embedding = embRes.data[0].embedding;

  // 2. 검색 전략 분기
  const searchFns = isRecent
    ? [
        matchDocs("match_news_recent",     embedding, { since_days: 14 }),
        matchDocs("match_reports_recent",  embedding, { since_days: 14 }),
        matchDocs("match_telegrams_recent",embedding, { since_days: 14 }),
      ]
    : [
        matchDocs("match_news",     embedding),
        matchDocs("match_reports",  embedding),
        matchDocs("match_telegrams",embedding),
      ];

  const searchResults = await Promise.allSettled(searchFns);
  const [newsResult, reportsResult, telegramsResult] = searchResults;

  const news      = newsResult.status      === "fulfilled" ? newsResult.value      : [];
  const reports   = reportsResult.status   === "fulfilled" ? reportsResult.value   : [];
  const telegrams = telegramsResult.status === "fulfilled" ? telegramsResult.value : [];

  // 실패한 소스 에러 수집 (디버그용)
  const searchErrors = searchResults
    .map((r, i) => r.status === "rejected" ? `[${["news","reports","telegrams"][i]}] ${r.reason}` : null)
    .filter(Boolean);

  // 3. 컨텍스트 구성 (RAG + 그래프)
  const [graphCtx] = await Promise.all([fetchGraphContext(entityNames)]);

  const ctx: string[] = [];
  if (graphCtx) ctx.push(graphCtx);
  (news as {date:string;title:string;company:string;summary:string}[]).forEach((n, i) =>
    ctx.push(`[뉴스${i+1}] (${n.date}) ${n.title}${n.company ? ` — ${n.company}` : ""}\n${n.summary}`)
  );
  (reports as {date:string;title:string;securities_firm:string;summary:string}[]).forEach((r, i) =>
    ctx.push(`[리포트${i+1}] (${r.date}) ${r.title} — ${r.securities_firm}\n${r.summary}`)
  );
  (telegrams as {date_utc:string;channel:string;summary:string}[]).forEach((t, i) =>
    ctx.push(`[텔레그램${i+1}] (${t.date_utc?.slice(0,10)}) ${t.channel}\n${t.summary}`)
  );

  // 4. gpt-4.1-mini 스트리밍
  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: ctx.length > 0
          ? `참고 자료:\n${ctx.join("\n\n")}\n\n질문: ${question}`
          : `질문: ${question}`,
      },
    ],
    stream: true,
    max_tokens: 1200,
    temperature: 0.3,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(
          JSON.stringify({ type: "sources", news, reports, telegrams, isRecent, searchErrors }) + "\n"
        ));
        for await (const chunk of completion) {
          const text = chunk.choices[0]?.delta?.content ?? "";
          if (text) {
            controller.enqueue(encoder.encode(
              JSON.stringify({ type: "text", data: text }) + "\n"
            ));
          }
        }
      } catch (e) {
        controller.enqueue(encoder.encode(
          JSON.stringify({ type: "error", message: String(e) }) + "\n"
        ));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}
