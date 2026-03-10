import { NextResponse } from "next/server";

const TICKERS = {
  samsung: "000660.KS",
  hynix: "005930.KS",
};

async function fetchStock(ticker: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1mo`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    next: { revalidate: 1800 }, // 30분 캐시
  });
  if (!res.ok) throw new Error(`Failed to fetch ${ticker}`);
  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result) throw new Error(`No data for ${ticker}`);

  const meta = result.meta;
  const timestamps: number[] = result.timestamp ?? [];
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];

  const history = timestamps
    .map((ts, i) => ({
      date: new Date(ts * 1000).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" }),
      price: closes[i] ? Math.round(closes[i]!) : null,
    }))
    .filter((d) => d.price !== null);

  const currentPrice: number = Math.round(meta.regularMarketPrice ?? 0);
  const prevClose: number = Math.round(meta.chartPreviousClose ?? meta.previousClose ?? 0);
  const change = prevClose ? ((currentPrice - prevClose) / prevClose) * 100 : 0;

  return { history, currentPrice, change: parseFloat(change.toFixed(2)), currency: meta.currency };
}

export async function GET() {
  try {
    const [samsung, hynix] = await Promise.all([
      fetchStock(TICKERS.samsung),
      fetchStock(TICKERS.hynix),
    ]);
    return NextResponse.json({ samsung, hynix });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
