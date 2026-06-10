import { NextResponse } from "next/server";
import OpenAI from "openai";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const HDR = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

const SECTION_STARTERS = ["📌", "📈", "🔍", "💡"];

function toHtml(text: string, weatherEmoji: string, weatherLabel: string, weatherReason: string, causalChains: string[] = [], newAlerts: string[] = []): string {
  const parts = [
    `<p style="font-size:1rem;font-weight:700;margin-bottom:0.75rem">${weatherEmoji} 오늘의 시황 날씨: <strong>${weatherLabel}</strong>${weatherReason ? " — " + weatherReason : ""}</p>`,
  ];
  if (newAlerts.length > 0) {
    parts.push(`<div style="margin-bottom:0.75rem;display:flex;flex-wrap:wrap;gap:0.4rem">${newAlerts.map(a => `<span style="display:inline-block;font-size:0.75rem;font-weight:600;padding:0.15rem 0.6rem;border-radius:9999px;background:#fef3c7;color:#92400e;border:1px solid #fcd34d">⚡ ${a}</span>`).join("")}</div>`);
  }
  if (causalChains.length > 0) {
    parts.push(`<div style="margin-bottom:1.25rem;padding:0.75rem 1rem;background:#f0f9ff;border-left:3px solid #38bdf8;border-radius:0 6px 6px 0">`);
    parts.push(`<p style="font-size:0.8rem;font-weight:700;color:#0369a1;margin-bottom:0.4rem">🔗 거시적 흐름</p>`);
    causalChains.forEach(c => parts.push(`<p style="font-size:0.8rem;color:#0c4a6e;margin:0.2rem 0;line-height:1.6">${c}</p>`));
    parts.push(`</div>`);
  }
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

  const origin = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  const [news, reports, telegrams, hotCtxRes] = await Promise.all([
    fetchNews(),
    fetchUrl(`${SUPABASE_URL}/rest/v1/stock_reports?select=title,securities_firm,date,summary,keyword&order=date.desc&limit=5`),
    fetchUrl(`${SUPABASE_URL}/rest/v1/telegram_messages?select=channel,summary,date_utc,sentiment,keywords&order=date_utc.desc,forward_count.desc&limit=10`),
    fetch(`${origin}/api/graph/hot-context`, { next: { revalidate: 1800 } }).then(r => r.ok ? r.json() : null).catch(() => null),
  ]);

  const hotCtx = hotCtxRes as { promptText?: string; newEntries?: { name: string; type: string }[] } | null;

  const ctx: string[] = [];
  (telegrams as {date_utc:string;channel:string;summary:string;sentiment:string}[]).forEach(t =>
    ctx.push(`[텔레그램] (${t.date_utc?.slice(0,10)}) ${t.channel} [${t.sentiment ?? "중립"}]\n${t.summary}`)
  );
  if (hotCtx?.promptText) ctx.push(hotCtx.promptText);
  (reports as {date:string;title:string;securities_firm:string;summary:string}[]).forEach(r =>
    ctx.push(`[리포트] (${r.date}) ${r.title} — ${r.securities_firm}\n${r.summary}`)
  );
  (news as {date:string;title:string;company:string;summary:string}[]).forEach(n =>
    ctx.push(`[뉴스] (${n.date}) ${n.title}${n.company ? ` — ${n.company}` : ""}\n${n.summary}`)
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
오늘(${today}) 최신 뉴스·리포트·텔레그램 + 지식 그래프 인과 구조를 분석해서 JSON으로 응답해.

JSON 형식:
{
  "weather": {"emoji":"<이모지>","label":"<이름>","reason":"<한 문장>"},
  "causal_chains": ["이벤트: A → 섹터: B → 기업: C, D → 지표: E 형태, 1~3개"],
  "new_alerts": ["최근 이슈: <엔티티명>(<타입>)" 형태, 있을 때만 포함],
  "briefing": "<브리핑 전문>"
}

날씨 기준 (6개 중 하나):
☀️맑음 / 🌤️구름조금 / ⛅흐림 / 🌧️비 / ⛈️폭풍 / 🌫️안개

causal_chains: 그래프 인과 클러스터 정보를 자연어로 정리. 지식 그래프에 없으면 [] 반환.
new_alerts: 최근 이슈 엔티티를 뉴스 맥락에서 해석해 주의 멘트 포함. 없으면 [] 반환.

briefing 형식:
📌 **핵심 요약** (4~5문장)
📈 **주목 이슈** (5가지, 각 2~3문장, 그래프 인과 구조 반영)
🔍 **주목 키워드** (8~12개)
💡 **시사점** (2~3문장)`,
      },
      {
        role: "user",
        content: `오늘(${today}) 자료:\n\n${ctx.join("\n\n")}`,
      },
    ],
    max_tokens: 1400,
    temperature: 0.3,
  });

  const raw = JSON.parse(completion.choices[0].message.content ?? "{}");
  const briefing: string = raw.briefing ?? "";
  const weather: { emoji: string; label: string; reason: string } = raw.weather ?? { emoji: "⛅", label: "흐림", reason: "" };
  const causalChains: string[] = Array.isArray(raw.causal_chains) ? raw.causal_chains : [];
  const newAlerts: string[] = Array.isArray(raw.new_alerts) ? raw.new_alerts : [];

  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const date = kst.toISOString().slice(0, 10);
  const [y, m, d] = date.split("-");
  const title = `${y}년 ${m}월 ${d}일 시황`;

  const html = toHtml(briefing, weather.emoji, weather.label, weather.reason ?? "", causalChains, newAlerts);
  await upsertDailySituation(date, title, html, weather.emoji, weather.label);

  return NextResponse.json({ briefing, date, weather, causalChains, newAlerts }, {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200" },
  });
}
