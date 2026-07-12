import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "edge";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const HDR = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

const SECTION_STARTERS = ["📌", "📈", "⚠️", "💡"];

function toHtml(text: string, weatherTrend: string, weatherSummary: string, dateFrom: string, dateTo: string): string {
  const parts: string[] = [
    `<div style="margin-bottom:1rem;padding:0.75rem 1rem;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">`,
    `<p style="font-size:0.8rem;color:#64748b;margin-bottom:0.3rem">📅 ${dateFrom} ~ ${dateTo} 주간 반도체 시황</p>`,
    `<p style="font-size:0.9rem;font-weight:600;color:#0f172a">${weatherTrend} ${weatherSummary}</p>`,
    `</div>`,
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

async function generate(dateFrom: string, dateTo: string): Promise<string> {
  // 최근 7일 daily_situation 가져오기
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/daily_situation?select=date,weather_emoji,weather_label,content&date=gte.${dateFrom}&date=lte.${dateTo}&order=date.asc`,
    { headers: HDR, cache: "no-store" }
  );
  const rows: { date: string; weather_emoji: string; weather_label: string; content: string }[] =
    res.ok ? await res.json() : [];
  if (rows.length === 0) throw new Error("no data");

  // HTML → 텍스트 변환 (태그 제거)
  const stripHtml = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  const weatherFlow = rows.map(r => r.weather_emoji).join("→");
  const ctx = rows.map(r =>
    `[${r.date} ${r.weather_emoji}${r.weather_label}]\n${stripHtml(r.content).slice(0, 800)}`
  ).join("\n\n");

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const completion = await openai.chat.completions.create({
    model: "gpt-4.1",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `너는 한국 반도체 시황 주간 분석가야. 최근 7일간의 일별 시황 브리핑을 종합해서 주간 요약을 작성해.

JSON 형식:
{
  "weather_trend": "날씨 이모지 흐름 (예: ⛅→🌧️→🌤️→☀️, rows에서 가져올것)",
  "weather_summary": "날씨 트렌드 한 줄 요약 (예: '초반 불확실 후 후반 회복세')",
  "summary": "주간 시황 전문"
}

summary 형식:
📌 **이번 주 핵심 메시지** (3~4문장, 한 주를 관통하는 메인 메시지)
📈 **주요 이슈 흐름** (3가지, 각 2~3문장, 초반→후반 변화 포함)
⚠️ **지속 리스크** (2~3가지 불릿, 해소되지 않은 리스크)
💡 **다음 주 주목 포인트** (2~3가지 불릿)

리스크 민감도 원칙: 부정적 신호를 낙관적 신호보다 무게있게 다뤄. 시사점에는 하방 리스크를 반드시 포함.`,
      },
      {
        role: "user",
        content: `${dateFrom} ~ ${dateTo} 7일 시황:\n\n${ctx}`,
      },
    ],
    max_tokens: 1200,
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

  // weekly_summary 테이블에 저장
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

  // 캐시: 오늘 기준 최신 weekly_summary 반환
  if (!regenerate) {
    const cached = await fetch(
      `${SUPABASE_URL}/rest/v1/weekly_summary?select=content,date_from,date_to,created_at&order=created_at.desc&limit=1`,
      { headers: HDR, cache: "no-store" }
    );
    if (cached.ok) {
      const rows = await cached.json() as { content: string; date_from: string; date_to: string; created_at: string }[];
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
