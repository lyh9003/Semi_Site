import { NextResponse } from "next/server";

export const runtime = 'edge';

async function probe(ticker: string) {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`,
    { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" }
  );
  if (!res.ok) return { ticker, error: res.status };
  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result) return { ticker, error: "no result" };

  const meta = result.meta;
  const timestamps: number[] = result.timestamp ?? [];
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];

  const toKST = (ts: number) =>
    new Date(ts * 1000).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 10);

  return {
    ticker,
    regularMarketPrice: meta.regularMarketPrice,
    regularMarketTime: meta.regularMarketTime,
    regularMarketTimeKST: meta.regularMarketTime ? toKST(meta.regularMarketTime) : null,
    regularMarketChangePercent: meta.regularMarketChangePercent,
    chartPreviousClose: meta.chartPreviousClose,
    recentBars: timestamps.slice(-5).map((ts, i) => ({
      kstDate: toKST(ts),
      close: closes[timestamps.length - 5 + i],
    })),
  };
}

export async function GET() {
  const todayKST = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const [samsung, hynix] = await Promise.all([
    probe("005930.KS"),
    probe("000660.KS"),
  ]);
  return NextResponse.json({ todayKST, samsung, hynix });
}
