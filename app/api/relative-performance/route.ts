import { NextRequest, NextResponse } from "next/server";

const PERIOD_CONFIG: Record<string, { range: string; interval: string }> = {
  "1mo": { range: "1mo", interval: "1d" },
  "1y":  { range: "1y",  interval: "1wk" },
  "2y":  { range: "2y",  interval: "1wk" },
};

/** 타임스탬프를 정렬/병합 키로 변환 (daily: YYYY-MM-DD, weekly: 해당 주 월요일) */
function toKey(ts: number, interval: string): string {
  const d = new Date(ts * 1000);
  if (interval === "1d") {
    return d.toISOString().slice(0, 10);
  }
  // weekly → 해당 주의 월요일로 정규화
  const day = d.getUTCDay();
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
  monday.setUTCHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

function formatDate(isoKey: string, period: string): string {
  const d = new Date(isoKey + "T00:00:00Z");
  if (period === "2y") {
    return d.toLocaleDateString("ko-KR", { year: "2-digit", month: "numeric", day: "numeric", timeZone: "UTC" });
  }
  return d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", timeZone: "UTC" });
}

async function fetchNormalized(
  symbol: string,
  range: string,
  interval: string
): Promise<{ key: string; value: number }[] | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json.chart?.result?.[0];
    if (!result) return null;

    const timestamps: number[] = result.timestamp ?? [];
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];

    const points = timestamps
      .map((ts, i) => ({ ts, price: closes[i] }))
      .filter((d): d is { ts: number; price: number } => d.price != null && d.price > 0);

    if (points.length === 0) return null;

    const base = points[0].price;
    return points.map((p) => ({
      key: toKey(p.ts, interval),
      value: parseFloat(((p.price / base) * 100).toFixed(2)),
    }));
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbols = (searchParams.get("symbols") ?? "").split(",").filter(Boolean);
  const period = searchParams.get("period") ?? "1y";
  const { range, interval } = PERIOD_CONFIG[period] ?? PERIOD_CONFIG["1y"];

  if (symbols.length === 0) return NextResponse.json({ data: [] });

  const results = await Promise.all(
    symbols.map(async (symbol) => ({
      symbol,
      series: await fetchNormalized(symbol, range, interval),
    }))
  );

  // key(날짜) → { symbol: value } 맵 구축
  const keyMap = new Map<string, Record<string, number>>();
  for (const { symbol, series } of results) {
    if (!series) continue;
    for (const { key, value } of series) {
      if (!keyMap.has(key)) keyMap.set(key, {});
      keyMap.get(key)![symbol] = value;
    }
  }

  // 날짜 정렬 후 표시용 레이블로 변환
  const sortedKeys = [...keyMap.keys()].sort();
  const data = sortedKeys.map((key) => ({
    date: formatDate(key, period),
    ...keyMap.get(key),
  }));

  return NextResponse.json({ data });
}
