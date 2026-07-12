import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "edge";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const HDR = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

const SECTION_STARTERS = ["📊", "📈", "🏭", "🌐", "⚠️", "💡"];

function toHtml(text: string, weatherTrend: string, weatherSummary: string, dateFrom: string, dateTo: string): string {
  const parts: string[] = [
    `<div style="margin-bottom:1.25rem;padding:0.75rem 1rem;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">`,
    `<p style="font-size:0.8rem;color:#64748b;margin-bottom:0.25rem">📅 ${dateFrom} ~ ${dateTo} · 주간 반도체 시황 종합 리포트</p>`,
    `<p style="font-size:1rem;font-weight:700;color:#0f172a">${weatherTrend}</p>`,
    `<p style="font-size:0.85rem;color:#475569;margin-top:0.2rem">${weatherSummary}</p>`,
    `</div>`,
  ];
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    if (!line) continue;
    if (SECTION_STARTERS.some(s => line.startsWith(s))) {
      parts.push(`<h2 style="font-size:1.1rem;font-weight:700;color:#0f172a;margin:2rem 0 0.6rem;padding-bottom:0.3rem;border-bottom:2px solid #e2e8f0">${line}</h2>`);
    } else if (line.startsWith("- ")) {
      parts.push(`<p style="margin:0.35rem 0 0.35rem 1.2rem;line-height:1.85">• ${line.slice(2)}</p>`);
    } else {
      parts.push(`<p style="margin:0.4rem 0;line-height:1.9;color:#1e293b">${line}</p>`);
    }
  }
  return parts.join("\n");
}

async function fetchRaw(url: string) {
  const res = await fetch(url, { headers: HDR, cache: "no-store" });
  return res.ok ? res.json() : [];
}

async function generate(dateFrom: string, dateTo: string): Promise<string> {
  const [dailyWeather, news, reports, telegrams] = await Promise.all([
    fetchRaw(`${SUPABASE_URL}/rest/v1/daily_situation?select=date,weather_emoji,weather_label&date=gte.${dateFrom}&date=lte.${dateTo}&order=date.asc`),
    fetchRaw(`${SUPABASE_URL}/rest/v1/news?select=title,company,date,summary,importance&date=gte.${dateFrom}&date=lte.${dateTo}&importance=gte.2&order=date.desc,importance.desc&limit=50`),
    fetchRaw(`${SUPABASE_URL}/rest/v1/stock_reports?select=title,securities_firm,date,summary&date=gte.${dateFrom}&date=lte.${dateTo}&order=date.desc&limit=20`),
    fetchRaw(`${SUPABASE_URL}/rest/v1/telegram_messages?select=channel,summary,date_utc,sentiment,forward_count&date_utc=gte.${dateFrom}T00:00:00&order=forward_count.desc,date_utc.desc&limit=40`),
  ]);

  const weatherFlow = (dailyWeather as {date:string;weather_emoji:string;weather_label:string}[])
    .map(r => `${r.date.slice(5)}(${r.weather_emoji}${r.weather_label})`).join(" → ");

  const ctxParts: string[] = [];

  if ((dailyWeather as []).length > 0) {
    ctxParts.push("[이번 주 일별 날씨 흐름]\n" +
      (dailyWeather as {date:string;weather_emoji:string;weather_label:string}[])
        .map(r => `${r.date} ${r.weather_emoji} ${r.weather_label}`).join("\n"));
  }

  if ((telegrams as []).length > 0) {
    ctxParts.push("[텔레그램 주요 메시지 — 업계 반응 (공유수 높은 순)]\n" +
      (telegrams as {date_utc:string;channel:string;sentiment:string;summary:string}[])
        .map(t => `(${t.date_utc?.slice(0,10)}) [${t.channel}] [${t.sentiment??'중립'}] ${t.summary}`).join("\n"));
  }

  if ((reports as []).length > 0) {
    ctxParts.push("[증권사 리포트]\n" +
      (reports as {date:string;title:string;securities_firm:string;summary:string}[])
        .map(r => `(${r.date}) ${r.title} — ${r.securities_firm}\n  ${r.summary}`).join("\n"));
  }

  if ((news as []).length > 0) {
    ctxParts.push("[뉴스 — 중요도·날짜순]\n" +
      (news as {date:string;importance:number;title:string;company:string;summary:string}[])
        .map(n => `(${n.date}) [중요도${n.importance}] ${n.title}${n.company ? ` — ${n.company}` : ""}\n  ${n.summary}`).join("\n"));
  }

  const ctx = ctxParts.join("\n\n");

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const completion = await openai.chat.completions.create({
    model: "gpt-4.1",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `너는 한국 반도체 시황 전문 주간 리포트 작성자야.
${dateFrom} ~ ${dateTo} 원본 데이터(뉴스·증권사 리포트·텔레그램)를 바탕으로 깊이 있는 주간 종합 리포트를 작성해.
일별 브리핑보다 훨씬 상세하고 길어야 하며, 구체적 기업명·수치·날짜를 적극 활용해.

JSON 형식:
{
  "weather_trend": "날짜별 날씨 이모지 흐름 (예: 07/06(⛅흐림) → 07/07(🌧️비) → 07/08(🌤️구름조금))",
  "weather_summary": "주간 날씨 트렌드 한 줄 해석",
  "summary": "주간 리포트 전문 (아래 형식 준수, 전체 2500자 이상)"
}

summary 형식 (각 섹션 충분히 서술):

📊 **주간 종합 평가**
(5~7문장. 이번 주 반도체 시장 전체를 관통하는 핵심 메시지, 시장 온도, 전주 대비 변화)

📈 **이번 주 Top 5 이슈**
(각 이슈마다 소제목 + 3~5문장. 구체적 날짜·기업·수치 포함. 초반→후반 전개 과정 서술)

🏭 **섹터별 동향**
(HBM, DRAM, NAND, 파운드리, 시스템반도체 각각 2~3문장. 공급·수요·가격 현황 포함)

🌐 **지정학·매크로 영향**
(미중 무역·관세, 환율, 글로벌 수요·재고 사이클 3~5문장)

⚠️ **리스크 요인 종합**
(이번 주 부각·지속된 리스크 3~4가지. 각 2문장씩. 하방 리스크 중심)

💡 **다음 주 핵심 체크포인트**
(구체적 일정·이벤트·실적 발표·정책 일정 포함. 3~4가지)

리스크 민감도 원칙: 부정적 신호(수요 둔화·재고·가격 하락·지정학 리스크)는 낙관론보다 무게있게 다뤄.`,
      },
      {
        role: "user",
        content: `${dateFrom} ~ ${dateTo} 원본 데이터:\n\n${ctx}`,
      },
    ],
    max_tokens: 3500,
    temperature: 0.3,
  });

  const raw = JSON.parse(completion.choices[0].message.content ?? "{}");
  const html = toHtml(
    raw.summary ?? "",
    raw.weather_trend ?? weatherFlow,
    raw.weather_summary ?? "",
    dateFrom,
    dateTo
  );

  await fetch(`${SUPABASE_URL}/rest/v1/weekly_summary`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ date_from: dateFrom, date_to: dateTo, content: html }),
  });

  return html;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const regenerate = searchParams.has("regenerate");

  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const dateTo   = kst.toISOString().slice(0, 10);
  const dateFrom = new Date(Date.now() + 9 * 60 * 60 * 1000 - 6 * 86400_000).toISOString().slice(0, 10);

  if (!regenerate) {
    const cached = await fetch(
      `${SUPABASE_URL}/rest/v1/weekly_summary?select=content,date_from,date_to,created_at&order=created_at.desc&limit=1`,
      { headers: HDR, cache: "no-store" }
    );
    if (cached.ok) {
      const rows = await cached.json() as { content: string; date_from: string; date_to: string }[];
      if (rows[0]?.content) {
        return NextResponse.json(
          { content: rows[0].content, dateFrom: rows[0].date_from, dateTo: rows[0].date_to, cached: true },
          { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" } }
        );
      }
    }
  }

  try {
    const content = await generate(dateFrom, dateTo);
    return NextResponse.json(
      { content, dateFrom, dateTo, cached: false },
      { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" } }
    );
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
