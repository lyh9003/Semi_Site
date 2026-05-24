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
- 핵심 결론을 먼저, 근거는 간결하게
- 출처는 [뉴스], [리포트], [텔레그램] 태그로 명시
- 제공된 자료에 없는 내용은 추측하지 말고 솔직하게 말해
- 4~6문장으로 간결하게 답변`;

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

// 질문이 최신 시황 관련인지 판단 (true = 최근 14일 검색, false = 전체 시맨틱 검색)
async function isRecentQuery(openai: OpenAI, question: string): Promise<boolean> {
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `질문이 최신 시황/동향/가격/실적 등 '지금 현재' 정보가 중요한 질문이면 "recent", 기술 설명·역사·개념 등 시간에 덜 민감한 질문이면 "general"로만 답해.`,
      },
      { role: "user", content: question },
    ],
    max_tokens: 5,
    temperature: 0,
  });
  return res.choices[0].message.content?.trim().toLowerCase().startsWith("recent") ?? true;
}

export async function POST(req: NextRequest) {
  const { question } = await req.json() as { question: string };
  if (!question?.trim()) return new Response("question required", { status: 400 });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // 1. 질문 분류 + 임베딩 병렬 실행
  const [isRecent, embRes] = await Promise.all([
    isRecentQuery(openai, question),
    openai.embeddings.create({ model: "text-embedding-3-small", input: question }),
  ]);
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

  // 3. 컨텍스트 구성
  const ctx: string[] = [];
  (news as {date:string;title:string;company:string;summary:string}[]).forEach((n, i) =>
    ctx.push(`[뉴스${i+1}] (${n.date}) ${n.title}${n.company ? ` — ${n.company}` : ""}\n${n.summary}`)
  );
  (reports as {date:string;title:string;securities_firm:string;summary:string}[]).forEach((r, i) =>
    ctx.push(`[리포트${i+1}] (${r.date}) ${r.title} — ${r.securities_firm}\n${r.summary}`)
  );
  (telegrams as {date_utc:string;channel:string;summary:string}[]).forEach((t, i) =>
    ctx.push(`[텔레그램${i+1}] (${t.date_utc?.slice(0,10)}) ${t.channel}\n${t.summary}`)
  );

  // 4. gpt-4o-mini 스트리밍
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
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
    max_tokens: 600,
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
