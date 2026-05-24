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
    model: "gpt-4.1",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `너는 한국 반도체·주식 시황 브리핑 전문가야.
오늘(${today}) 최신 뉴스·리포트·텔레그램을 분석해서 JSON으로 응답해.

JSON 형식:
{
  "weather": {
    "emoji": "<날씨 이모지>",
    "label": "<날씨 이름>",
    "reason": "<한 문장으로 날씨를 선택한 이유>"
  },
  "briefing": "<브리핑 전문>"
}

날씨 기준 (반드시 아래 6개 중 하나):
- {"emoji":"☀️","label":"맑음"} — 전반적 강세, 긍정 뉴스 우세
- {"emoji":"🌤️","label":"구름 조금"} — 긍정적이나 일부 불확실성
- {"emoji":"⛅","label":"흐림"} — 혼조세, 방향 불분명
- {"emoji":"🌧️","label":"비"} — 약세, 부정적 뉴스 우세
- {"emoji":"⛈️","label":"폭풍"} — 급락·리스크 급등
- {"emoji":"🌫️","label":"안개"} — 극도의 불확실성

briefing 형식:
📌 **핵심 요약** (4~5문장으로 오늘 시장의 핵심 흐름과 배경)
📈 **주목 이슈** (중요한 이슈 5가지, 각 2~3문장으로 맥락과 의미 설명)
🔍 **주목 키워드** (쉼표 구분, 8~12개)
💡 **시사점** (2~3문장으로 투자자 관점의 시사점 또는 주의사항)

구체적인 수치·기업명·날짜를 포함해 신뢰도 높은 브리핑을 작성해.`,
      },
      {
        role: "user",
        content: `오늘(${today}) 자료:\n\n${ctx.join("\n\n")}`,
      },
    ],
    max_tokens: 1200,
    temperature: 0.3,
  });

  const raw = JSON.parse(completion.choices[0].message.content ?? "{}");
  const briefing: string = raw.briefing ?? "";
  const weather: { emoji: string; label: string; reason: string } = raw.weather ?? { emoji: "⛅", label: "흐림", reason: "" };
  const date = new Date().toISOString().slice(0, 10);

  return NextResponse.json({ briefing, date, weather }, {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200" },
  });
}
