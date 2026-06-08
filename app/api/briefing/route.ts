import { NextResponse } from "next/server";
import OpenAI from "openai";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const HDR = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

const SECTION_STARTERS = ["📌", "📈", "🔍", "💡"];

function toHtml(text: string, weatherEmoji: string, weatherLabel: string, weatherReason: string): string {
  const parts = [
    `<p style="font-size:1rem;font-weight:700;margin-bottom:1.5rem">${weatherEmoji} 오늘의 시황 날씨: <strong>${weatherLabel}</strong>${weatherReason ? " — " + weatherReason : ""}</p>`,
  ];
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    if (!line) continue;
    if (SECTION_STARTERS.some(s => line.startsWith(s))) {
      parts.push(`<h2 style="font-size:1.05rem;font-weight:700;color:#0f172a;margin:1.75rem 0 0.5rem;padding-bottom:0.25rem;border-bottom:1px solid #e2e8f0">${line}</h2>`);
    } else if (line.startsWith("- ")) {
      parts.push(`<p style="margin:0.3rem 0 0.3rem 1rem;line-height:1.75">• ${line.slice(2)}</p>`);
    } else {
      parts.push(`<p style="margin:0.3rem 0;line-height:1.75">${line}</p>`);
    }
  }
  return parts.join("\n");
}

async function upsertDailySituation(date: string, title: string, content: string, weatherEmoji: string, weatherLabel: string) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/daily_situation`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ date, title, content, weather_emoji: weatherEmoji, weather_label: weatherLabel }),
    });
  } catch {
    // upsert 실패해도 브리핑 응답은 정상 반환
  }
}

async function fetchUrl(url: string) {
  const res = await fetch(url, { headers: HDR, next: { revalidate: 3600 } });
  return res.ok ? res.json() : [];
}

async function fetchNews() {
  const opts = { headers: HDR, next: { revalidate: 3600 } };
  const base = `${SUPABASE_URL}/rest/v1/news?select=title,company,date,summary,keyword`;

  // 최신 날짜 확인
  const latestRes = await fetch(`${SUPABASE_URL}/rest/v1/news?select=date&order=date.desc&limit=1`, opts);
  if (!latestRes.ok) return [];
  const [latest] = await latestRes.json() as { date: string }[];
  if (!latest) return [];
  const d = latest.date;

  // 1순위: 최신일자 importance=3
  const r3 = await fetch(`${base}&importance=eq.3&date=eq.${d}&order=date.desc&limit=10`, opts);
  if (r3.ok) { const data = await r3.json(); if (data.length > 0) return data; }

  // 2순위: 최신일자 importance=2
  const r2 = await fetch(`${base}&importance=eq.2&date=eq.${d}&order=date.desc&limit=10`, opts);
  if (r2.ok) { const data = await r2.json(); if (data.length > 0) return data; }

  // 3순위: 전날 importance=3
  const prevRes = await fetch(`${SUPABASE_URL}/rest/v1/news?select=date&date=lt.${d}&order=date.desc&limit=1`, opts);
  if (!prevRes.ok) return [];
  const [prev] = await prevRes.json() as { date: string }[];
  if (!prev) return [];
  const r3prev = await fetch(`${base}&importance=eq.3&date=eq.${prev.date}&order=date.desc&limit=10`, opts);
  return r3prev.ok ? r3prev.json() : [];
}

export async function GET() {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

  const [news, reports, telegrams] = await Promise.all([
    fetchNews(),
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
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const date = kst.toISOString().slice(0, 10);
  const [y, m, d] = date.split("-");
  const title = `${y}년 ${m}월 ${d}일 시황`;

  const html = toHtml(briefing, weather.emoji, weather.label, weather.reason ?? "");
  await upsertDailySituation(date, title, html, weather.emoji, weather.label);

  return NextResponse.json({ briefing, date, weather }, {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200" },
  });
}
