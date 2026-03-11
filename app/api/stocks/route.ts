import { NextResponse } from "next/server";

const TICKERS = {
  samsung: "005930.KS",
  hynix: "000660.KS",
};

async function fetchStock(ticker: string) {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1mo`,
    { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 300 } }
  );
  if (!res.ok) throw new Error(`Failed to fetch ${ticker}`);
  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result) throw new Error(`No data for ${ticker}`);

  const meta = result.meta;
  const timestamps: number[] = result.timestamp ?? [];
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];

  // 히스토리 구성
  const history = timestamps
    .map((ts, i) => ({
      date: new Date(ts * 1000).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" }),
      price: closes[i] ? Math.round(closes[i]!) : null,
    }))
    .filter((d) => d.price !== null);

  // 유효한 (timestamp, close) 쌍만 추출
  const validPoints = timestamps
    .map((ts, i) => ({ ts, close: closes[i] }))
    .filter((p): p is { ts: number; close: number } => p.close != null && p.close > 0);

  const rawPrice: number = meta.regularMarketPrice ?? 0;
  const currentPrice: number = Math.round(rawPrice);

  // 마지막 바가 오늘이면(장 마감) 두 번째 마지막을 전일 종가로 사용
  // 마지막 바가 어제면(장중) 마지막 바가 전일 종가
  let prevClose = 0;
  if (validPoints.length >= 1) {
    const lastTs = validPoints[validPoints.length - 1].ts;
    const lastDateUTC = new Date(lastTs * 1000).toISOString().slice(0, 10);
    const todayUTC = new Date().toISOString().slice(0, 10);
    if (lastDateUTC === todayUTC && validPoints.length >= 2) {
      prevClose = validPoints[validPoints.length - 2].close;
    } else {
      prevClose = validPoints[validPoints.length - 1].close;
    }
  }

  const change = prevClose
    ? parseFloat(((rawPrice - prevClose) / prevClose * 100).toFixed(2))
    : 0;

  return { history, currentPrice, change, currency: meta.currency ?? "KRW" };
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
