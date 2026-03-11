import { NextResponse } from "next/server";

const TICKERS = {
  samsung: "005930.KS",
  hynix: "000660.KS",
};

async function fetchStock(ticker: string) {
  const headers = { "User-Agent": "Mozilla/5.0" };

  // 차트 히스토리(1개월)와 당일 시세(v7 quote)를 병렬 요청
  const [chartRes, quoteRes] = await Promise.all([
    fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1mo`,
      { headers, next: { revalidate: 1800 } }
    ),
    fetch(
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}`,
      { headers, next: { revalidate: 300 } } // 5분 캐시 (당일 시세)
    ),
  ]);

  if (!chartRes.ok) throw new Error(`Failed to fetch chart for ${ticker}`);
  const chartJson = await chartRes.json();
  const result = chartJson.chart?.result?.[0];
  if (!result) throw new Error(`No chart data for ${ticker}`);

  // 히스토리 구성
  const timestamps: number[] = result.timestamp ?? [];
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
  const history = timestamps
    .map((ts, i) => ({
      date: new Date(ts * 1000).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" }),
      price: closes[i] ? Math.round(closes[i]!) : null,
    }))
    .filter((d) => d.price !== null);

  // 당일 시세: v7 quote API → regularMarketPreviousClose(전일 종가) 사용
  let currentPrice: number;
  let change: number;
  const currency: string = result.meta.currency ?? "KRW";

  if (quoteRes.ok) {
    const quoteJson = await quoteRes.json();
    const q = quoteJson.quoteResponse?.result?.[0];
    if (q) {
      currentPrice = Math.round(q.regularMarketPrice ?? result.meta.regularMarketPrice ?? 0);
      const prevClose: number = q.regularMarketPreviousClose ?? 0;
      change = prevClose
        ? parseFloat(((q.regularMarketPrice - prevClose) / prevClose * 100).toFixed(2))
        : 0;
    } else {
      // fallback: chart meta
      currentPrice = Math.round(result.meta.regularMarketPrice ?? 0);
      change = 0;
    }
  } else {
    // fallback: chart meta
    currentPrice = Math.round(result.meta.regularMarketPrice ?? 0);
    change = 0;
  }

  return { history, currentPrice, change, currency };
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
