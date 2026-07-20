import { NextResponse } from "next/server";
import { isKRMarketClosed } from "@/lib/holidays";

export const runtime = 'edge';

const TICKERS = { kospi: "^KS11", samsung: "005930.KS", hynix: "000660.KS" };
const VALID_RANGES = ["1mo", "1y", "2y"] as const;
type Range = typeof VALID_RANGES[number];

// v7 Quote API: 현재가 + 전일 종가(공식값) → 변동률 계산 오류 없음
async function fetchQuotes(symbols: string[]) {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(","))}`,
    { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 60 } }
  );
  const map = new Map<string, { currentPrice: number; change: number }>();
  if (!res.ok) return map;
  const json = await res.json();
  for (const q of (json.quoteResponse?.result ?? [])) {
    const rawPrice: number = q.regularMarketPrice ?? 0;
    const prevClose: number = q.regularMarketPreviousClose ?? 0;
    const isIdx: boolean = q.quoteType === "INDEX";
    const currentPrice = isIdx ? parseFloat(rawPrice.toFixed(2)) : Math.round(rawPrice);
    const change = prevClose && rawPrice
      ? parseFloat(((rawPrice - prevClose) / prevClose * 100).toFixed(2))
      : 0;
    map.set(q.symbol, { currentPrice, change });
  }
  return map;
}

// v8 Chart API: 히스토리 (선 그래프용)
async function fetchChart(ticker: string, range: Range, isIndex = false) {
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

  const dateOptions: Intl.DateTimeFormatOptions = range === "2y"
    ? { year: "2-digit", month: "numeric", day: "numeric" }
    : { month: "numeric", day: "numeric" };
  const history = timestamps
    .map((ts, i) => ({
      date: new Date(ts * 1000).toLocaleDateString("ko-KR", { ...dateOptions, timeZone: "Asia/Seoul" }),
      price: closes[i] ? (isIndex ? parseFloat(closes[i]!.toFixed(2)) : Math.round(closes[i]!)) : null,
    }))
    .filter((d) => d.price !== null);

  const validPoints = timestamps
    .map((ts, i) => ({ ts, close: closes[i] }))
    .filter((p): p is { ts: number; close: number } => p.close != null && p.close > 0);
  const lastValidTs = validPoints.length > 0 ? validPoints[validPoints.length - 1].ts : null;
  const priceDate = lastValidTs
    ? new Date(lastValidTs * 1000).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" })
    : null;

  // v7 fetch 실패 시 fallback용
  const rawPrice: number = meta.regularMarketPrice ?? 0;
  const fallbackPrice = isIndex ? parseFloat(rawPrice.toFixed(2)) : Math.round(rawPrice);

  return { history, priceDate, isIndex, fallbackPrice };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rangeParam = searchParams.get("range") ?? "1mo";
  const range: Range = VALID_RANGES.includes(rangeParam as Range) ? (rangeParam as Range) : "1mo";

  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayKST = kstNow.toISOString().slice(0, 10);
  const isMarketClosed = isKRMarketClosed(todayKST);

  try {
    const [quotes, kospiChart, samsungChart, hynixChart] = await Promise.all([
      fetchQuotes([TICKERS.kospi, TICKERS.samsung, TICKERS.hynix]),
      fetchChart(TICKERS.kospi, range, true),
      fetchChart(TICKERS.samsung, range),
      fetchChart(TICKERS.hynix, range),
    ]);

    const build = (ticker: string, chart: Awaited<ReturnType<typeof fetchChart>>) => {
      const q = quotes.get(ticker);
      return {
        history: chart.history,
        currentPrice: q?.currentPrice ?? chart.fallbackPrice,
        change: q?.change ?? 0,
        priceDate: chart.priceDate,
        isIndex: chart.isIndex,
        isMarketClosed,
      };
    };

    return NextResponse.json({
      kospi:   build(TICKERS.kospi,   kospiChart),
      samsung: build(TICKERS.samsung, samsungChart),
      hynix:   build(TICKERS.hynix,   hynixChart),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
