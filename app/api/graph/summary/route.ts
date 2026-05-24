import { NextRequest } from "next/server";
import OpenAI from "openai";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const HDR = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

export async function POST(req: NextRequest) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const { entityId, entityName, entityType } = await req.json() as {
    entityId: number; entityName: string; entityType: string;
  };

  // 최신 문서 10건 수집
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_entity_docs`, {
    method: "POST",
    headers: { ...HDR, "Content-Type": "application/json" },
    body: JSON.stringify({ p_entity_id: entityId }),
    cache: "no-store",
  });
  if (!res.ok) return new Response("fetch failed", { status: 500 });
  const docs = await res.json();

  const ctx: string[] = [];
  (docs.news ?? []).slice(0, 5).forEach((n: {date:string;title:string;summary:string}) =>
    ctx.push(`[뉴스] (${n.date}) ${n.title}\n${n.summary}`)
  );
  (docs.reports ?? []).slice(0, 5).forEach((r: {date:string;title:string;securities_firm:string;summary:string}) =>
    ctx.push(`[리포트] (${r.date}) ${r.title} — ${r.securities_firm}\n${r.summary}`)
  );
  (docs.telegrams ?? []).slice(0, 5).forEach((t: {date_utc:string;channel:string;summary:string}) =>
    ctx.push(`[텔레그램] (${t.date_utc?.slice(0,10)}) ${t.channel}\n${t.summary}`)
  );

  if (ctx.length === 0) return new Response("no docs", { status: 404 });

  const typeLabel: Record<string, string> = {
    company: "기업", product: "제품/기술", metric: "지표",
    event: "이벤트", sector: "섹터",
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "너는 한국 반도체 시황 전문가야. 제공된 자료를 바탕으로 해당 항목의 최근 동향을 3~4문장으로 요약해. 한국어로, 핵심만 간결하게.",
          },
          {
            role: "user",
            content: `항목: ${entityName} (${typeLabel[entityType] ?? entityType})\n\n최근 자료:\n${ctx.join("\n\n")}\n\n위 자료를 바탕으로 "${entityName}"의 최근 시황을 요약해줘.`,
          },
        ],
        stream: true,
        max_tokens: 300,
        temperature: 0.3,
      });

      for await (const chunk of completion) {
        const text = chunk.choices[0]?.delta?.content ?? "";
        if (text) controller.enqueue(encoder.encode(text));
      }
      controller.close();
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
