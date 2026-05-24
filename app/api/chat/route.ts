import { NextRequest } from "next/server";
import OpenAI from "openai";

export const maxDuration = 30; // Vercel 함수 타임아웃 30초

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

async function matchDocs(fn: string, embedding: number[], threshold: number) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { ...HDR, "Content-Type": "application/json" },
      body: JSON.stringify({ query_embedding: embedding, match_threshold: threshold, match_count: 5 }),
      cache: "no-store",
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

// 임베딩 검색 결과가 비면 날짜순 최신 폴백
async function fetchRecent(table: string, select: string, dateCol: string, limit: number) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?select=${select}&order=${dateCol}.desc&limit=${limit}`,
      { headers: HDR, cache: "no-store" }
    );
    return res.ok ? res.json() : [];
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  const { question } = await req.json() as { question: string };
  if (!question?.trim()) return new Response("question required", { status: 400 });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // 1. 질문 임베딩
  const embRes = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: question,
  });
  const embedding = embRes.data[0].embedding;

  // 2. 관련 문서 검색 (뉴스·텔레그램은 낮은 threshold, 리포트는 정밀 매칭)
  let [news, reports, telegrams] = await Promise.all([
    matchDocs("match_news", embedding, 0.2),
    matchDocs("match_reports", embedding, 0.3),
    matchDocs("match_telegrams", embedding, 0.2),
  ]);

  // 결과 없으면 최신 날짜순 폴백
  if ((news as unknown[]).length === 0) {
    news = await fetchRecent("news", "id,title,company,date,summary,keyword,link", "date", 3);
  }
  if ((telegrams as unknown[]).length === 0) {
    telegrams = await fetchRecent(
      "telegram_messages",
      "id,channel,summary,keywords,sentiment,forward_count,date_utc",
      "date_utc",
      3
    );
  }

  // 3. 컨텍스트 구성
  const ctx: string[] = [];
  (news as {date:string;title:string;company:string;summary:string}[]).forEach((n, i) =>
    ctx.push(`[뉴스${i+1}] (${n.date}) ${n.title}${n.company ? ` — ${n.company}` : ""}\n${n.summary}`)
  );
  (reports as {date:string;title:string;securities_firm:string;one_line_summary:string}[]).forEach((r, i) =>
    ctx.push(`[리포트${i+1}] (${r.date}) ${r.title} — ${r.securities_firm}\n${r.one_line_summary}`)
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
        // 소스 먼저 전송
        controller.enqueue(encoder.encode(
          JSON.stringify({ type: "sources", news, reports, telegrams }) + "\n"
        ));
        // 텍스트 스트리밍
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
