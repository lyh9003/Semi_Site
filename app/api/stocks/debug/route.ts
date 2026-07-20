import { NextResponse } from "next/server";

export const runtime = 'edge';

export async function GET() {
  const ticker = "000660.KS"; // SK하이닉스
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`,
    { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" }
  );
  if (!res.ok) return NextResponse.json({ error: `fetch failed: ${res.status}` });
  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result) return NextResponse.json({ error: "no result" });

  const meta = result.meta;
  const timestamps: number[] = result.timestamp ?? [];
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];

  const toKSTDate = (ts: number) =>
    new Date(ts * 1000).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 10);
  const todayKST = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

  const points = timestamps.map((ts, i) => ({
    ts,
    kstDate: toKSTDate(ts),
    close: closes[i],
  }));

  const validPoints = points.filter(
    (p): p is { ts: number; kstDate: string; close: number } => p.close != null && p.close > 0
  );
  const prevClose = [...validPoints].reverse().find(p => p.kstDate !== todayKST)?.close ?? 0;
  const rawPrice = meta.regularMarketPrice ?? 0;
  const change = prevClose && rawPrice ? ((rawPrice - prevClose) / prevClose * 100).toFixed(2) : "0";

  return NextResponse.json({
    todayKST,
    regularMarketPrice: meta.regularMarketPrice,
    regularMarketChangePercent: meta.regularMarketChangePercent,
    chartPreviousClose: meta.chartPreviousClose,
    points,
    validPoints,
    prevClose,
    calculatedChange: change,
  });
}
