import { NextResponse } from "next/server";
import { isKRMarketClosed } from "@/lib/holidays";

export const runtime = 'edge';

const TICKERS = { kospi: "^KS11", samsung: "005930.KS", hynix: "000660.KS" };
const VALID_RANGES = ["1mo", "1y", "2y"] as const;
type Range = typeof VALID_RANGES[number];

// 차트 히스토리 전용 (표시용 선 그래프)
async function fetchHistory(ticker: string, range: Range, isIndex = false) {
  const interval = range === "1mo" ? "1d" : "1wk";
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`,
    { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 300 } }
  );
  if (!res.ok) throw new Error(`history fetch failed: ${ticker}`);
  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result) throw new Error(`no history data: ${ticker}`);

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

  const validTs = timestamps
    .map((ts, i) => ({ ts, close: closes[i] }))
    .filter((p): p is { ts: number; close: number } => p.close != null && p.close > 0);
  const lastTs = validTs.length > 0 ? validTs[validTs.length - 1].ts : null;
  const priceDate = lastTs
    ? new Date(lastTs * 1000).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" })
    : null;

  return { history, priceDate, isIndex };
}

// 현재가 + 전일비 전용 — range=5d 사용
// Yahoo Finance의 1mo 엔드포인트는 일부 한국 종목(000660.KS 등)에서
// regularMarketPrice가 전일 종가로 고정되는 문제가 있음. 5d는 항상 최신.
async function fetchPrice(ticker: string, isIndex: boolean, todayKST: string) {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`,
    { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" }
  );
  if (!res.ok) return { currentPrice: 0, change: 0 };
  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result) return { currentPrice: 0, change: 0 };

  const meta = result.meta;
  const timestamps: number[] = result.timestamp ?? [];
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];

  const toKSTDate = (ts: number) =>
    new Date(ts * 1000).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 10);
  const validPoints = timestamps
    .map((ts, i) => ({ date: toKSTDate(ts), close: closes[i] }))
    .filter((p): p is { date: string; close: number } => p.close != null && p.close > 0);

  const rawPrice: number = meta.regularMarketPrice ?? 0;

  // 날짜 내림차순 정렬
  const sorted = [...validPoints].sort((a, b) => b.date.localeCompare(a.date));

  let currentPrice: number;
  let change: number;

  if (isIndex) {
    // 지수(^KS11): regularMarketPrice가 자정~개장 전 구간에서 전일 종가로 고정되는 stale 현상
    // → closes 배열의 최근 두 세션으로 직접 계산
    const latestClose = sorted[0]?.close ?? 0;
    const prevClose = sorted[1]?.close ?? 0;
    currentPrice = parseFloat(latestClose.toFixed(2));
    change = prevClose && latestClose
      ? parseFloat(((latestClose - prevClose) / prevClose * 100).toFixed(2))
      : 0;
  } else {
    // 종목: regularMarketPrice = 실시간 현재가
    // prevClose = 오늘 날짜가 아닌 가장 최근 거래일 종가
    const prevClose = sorted.find(p => p.date !== todayKST)?.close ?? 0;
    currentPrice = Math.round(rawPrice);
    change = prevClose && rawPrice
      ? parseFloat(((rawPrice - prevClose) / prevClose * 100).toFixed(2))
      : 0;
  }

  return { currentPrice, change };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rangeParam = searchParams.get("range") ?? "1mo";
  const range: Range = VALID_RANGES.includes(rangeParam as Range) ? (rangeParam as Range) : "1mo";

  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayKST = kstNow.toISOString().slice(0, 10);
  const isMarketClosed = isKRMarketClosed(todayKST);

  try {
    const [
      kospiHist, samsungHist, hynixHist,
      kospiPrice, samsungPrice, hynixPrice,
    ] = await Promise.all([
      fetchHistory(TICKERS.kospi,   range, true),
      fetchHistory(TICKERS.samsung, range),
      fetchHistory(TICKERS.hynix,   range),
      fetchPrice(TICKERS.kospi,   true,  todayKST),
      fetchPrice(TICKERS.samsung, false, todayKST),
      fetchPrice(TICKERS.hynix,   false, todayKST),
    ]);

    const build = (hist: typeof kospiHist, price: typeof kospiPrice) => ({
      history:      hist.history,
      priceDate:    hist.priceDate,
      isIndex:      hist.isIndex,
      currentPrice: price.currentPrice,
      change:       price.change,
      isMarketClosed,
    });

    return NextResponse.json(
      { kospi: build(kospiHist, kospiPrice), samsung: build(samsungHist, samsungPrice), hynix: build(hynixHist, hynixPrice) },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } }
    );
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
