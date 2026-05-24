import { NextResponse } from "next/server";
import OpenAI from "openai";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const HDR = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

async function fetchUrl(url: string) {
  const res = await fetch(url, { headers: HDR, next: { revalidate: 3600 } });
  return res.ok ? res.json() : [];
}

export async function GET() {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

  const [news, reports, telegrams] = await Promise.all([
    // 최신 날짜 + 중요도 높은 뉴스 (importance=3 우선, 날짜 내림차순)
    fetchUrl(`${SUPABASE_URL}/rest/v1/news?select=title,company,date,summary,keyword&importance=eq.3&order=date.desc&limit=10`),
    // 리포트: summary 필드 사용
    fetchUrl(`${SUPABASE_URL}/rest/v1/stock_reports?select=title,securities_firm,date,summary,keyword&order=date.desc&limit=5`),
    // 최신 날짜 + 포워드 수 높은 텔레그램
    fetchUrl(`${SUPABASE_URL}/rest/v1/telegram_messages?select=channel,summary,date_utc,sentiment,keywords&order=date_utc.desc,forward_count.desc&limit=10`),
  ]);

  const ctx: string[] = [];
  (news as {date:string;title:string;company:string;summary:string}[]).forEach(n =>
    ctx.push(`[뉴스] (${n.date}) ${n.title}${n.company ? ` — ${n.company}` : ""}\n${n.summary}`)
  );
  (reports as {date:string;title:string;securities_firm:string;summary:string}[]).forEach(r =>
    ctx.push(`[리포트] (${r.date}) ${r.title} — ${r.securities_firm}\n${r.summary}`)
  );
  (telegrams as {date_utc:string;channel:string;summary:string;sentiment:string}[]).forEach(t =>
    ctx.push(`[텔레그램] (${t.date_utc?.slice(0,10)}) ${t.channel} [${t.sentiment ?? "중립"}]\n${t.summary}`)
  );

  const today = new Date().toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric", weekday: "short",
  });

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `너는 한국 반도체·주식 시황 브리핑 전문가야.
오늘(${today}) 최신 뉴스·리포트·텔레그램을 분석해서 시황 브리핑을 작성해.

형식:
📌 **핵심 요약** (2~3문장으로 오늘 시장의 핵심)
📈 **주목 이슈** (중요한 이슈 3가지, 각 1~2문장)
🔍 **주목 키워드** (쉼표 구분, 5~8개)

간결하고 핵심만 담아.`,
      },
      {
        role: "user",
        content: `오늘(${today}) 자료:\n\n${ctx.join("\n\n")}`,
      },
    ],
    max_tokens: 500,
    temperature: 0.3,
  });

  const briefing = completion.choices[0].message.content ?? "";
  const date = new Date().toISOString().slice(0, 10);

  return NextResponse.json({ briefing, date }, {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200" },
  });
}
