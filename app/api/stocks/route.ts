import { NextResponse } from "next/server";
import { isKRMarketClosed } from "@/lib/holidays";

export const runtime = 'edge';

const TICKERS = {
  kospi:   "^KS11",
  samsung: "005930.KS",
  hynix:   "000660.KS",
};

const VALID_RANGES = ["1mo", "1y", "2y"] as const;
type Range = typeof VALID_RANGES[number];

async function fetchStock(ticker: string, range: Range, isIndex = false) {
  const interval = range === "1mo" ? "1d" : "1wk";
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`,
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
      price: closes[i] ? (isIndex ? parseFloat(closes[i]!.toFixed(2)) : Math.round(closes[i]!)) : null,
    }))
    .filter((d) => d.price !== null);

  const rawPrice: number = meta.regularMarketPrice ?? 0;
  const currentPrice: number = isIndex ? parseFloat(rawPrice.toFixed(2)) : Math.round(rawPrice);

  const toKSTDate = (ts: number) =>
    new Date(ts * 1000).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 10);

  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayKST = kstNow.toISOString().slice(0, 10);
  const isMarketClosed = isKRMarketClosed(todayKST);

  const validPoints = timestamps
    .map((ts, i) => ({ ts, date: toKSTDate(ts), close: closes[i] }))
    .filter((p): p is { ts: number; date: string; close: number } => p.close != null && p.close > 0);

  // 전일 종가 = 오늘 날짜가 아닌 가장 최근 거래일 종가
  const prevClose = [...validPoints].reverse().find(p => p.date !== todayKST)?.close ?? 0;
  const change = prevClose && rawPrice
    ? parseFloat(((rawPrice - prevClose) / prevClose * 100).toFixed(2))
    : 0;

  const lastValidTs = validPoints.length > 0 ? validPoints[validPoints.length - 1].ts : null;
  const priceDate = lastValidTs
    ? new Date(lastValidTs * 1000).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" })
    : null;
  return { history, currentPrice, change, currency: meta.currency ?? "KRW", priceDate, isIndex, isMarketClosed };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rangeParam = searchParams.get("range") ?? "1mo";
  const range: Range = VALID_RANGES.includes(rangeParam as Range) ? (rangeParam as Range) : "1mo";
  try {
    const [kospi, samsung, hynix] = await Promise.all([
      fetchStock(TICKERS.kospi, range, true),
      fetchStock(TICKERS.samsung, range),
      fetchStock(TICKERS.hynix, range),
    ]);
    return NextResponse.json({ kospi, samsung, hynix });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
