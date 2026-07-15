import { NextResponse } from "next/server";

export const runtime = 'edge';

const TICKERS = {
  samsung: "005930.KS",
  hynix: "000660.KS",
};

const VALID_RANGES = ["1mo", "1y", "2y"] as const;
type Range = typeof VALID_RANGES[number];

async function fetchStock(ticker: string, range: Range) {
  const interval = range === "1mo" ? "1d" : "1wk";
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}`,
    { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 300 } }
  );
  if (!res.ok) throw new Error(`Failed to fetch ${ticker}`);
  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result) throw new Error(`No data for ${ticker}`);

  const meta = result.meta;
  const timestamps: number[] = result.timestamp ?? [];
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];

  // 히스토리 구성 (1년 이상은 연도 포함)
  const dateOptions: Intl.DateTimeFormatOptions = range === "2y"
    ? { year: "2-digit", month: "numeric", day: "numeric" }
    : { month: "numeric", day: "numeric" };
  const history = timestamps
    .map((ts, i) => ({
      date: new Date(ts * 1000).toLocaleDateString("ko-KR", { ...dateOptions, timeZone: "Asia/Seoul" }),
      price: closes[i] ? Math.round(closes[i]!) : null,
    }))
    .filter((d) => d.price !== null);

  const rawPrice: number = meta.regularMarketPrice ?? 0;
  const currentPrice: number = Math.round(rawPrice);

  // Yahoo Finance meta가 전일 종가를 직접 제공
  const prevClose: number = meta.chartPreviousClose ?? meta.regularMarketPreviousClose ?? 0;
  const change = prevClose
    ? parseFloat(((rawPrice - prevClose) / prevClose * 100).toFixed(2))
    : 0;

  // 유효한 close 포인트에서 마지막 날짜 추출
  const validPoints = timestamps
    .map((ts, i) => ({ ts, close: closes[i] }))
    .filter((p): p is { ts: number; close: number } => p.close != null && p.close > 0);
  const lastValidTs = validPoints.length > 0 ? validPoints[validPoints.length - 1].ts : null;
  const priceDate = lastValidTs
    ? new Date(lastValidTs * 1000).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" })
    : null;
  return { history, currentPrice, change, currency: meta.currency ?? "KRW", priceDate };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rangeParam = searchParams.get("range") ?? "1mo";
  const range: Range = VALID_RANGES.includes(rangeParam as Range) ? (rangeParam as Range) : "1mo";
  try {
    const [samsung, hynix] = await Promise.all([
      fetchStock(TICKERS.samsung, range),
      fetchStock(TICKERS.hynix, range),
    ]);
    return NextResponse.json({ samsung, hynix });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
