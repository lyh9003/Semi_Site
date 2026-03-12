"use client";

import { useEffect, useState, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";

const TICKERS = [
  { label: "코스피",       symbol: "^KS11",     color: "#6366f1" },
  { label: "코스닥",       symbol: "^KQ11",     color: "#a855f7" },
  { label: "나스닥",       symbol: "^IXIC",     color: "#f59e0b" },
  { label: "S&P500",       symbol: "^GSPC",     color: "#ef4444" },
  { label: "삼성전자",     symbol: "005930.KS", color: "#2563eb" },
  { label: "마이크론",     symbol: "MU",        color: "#0891b2" },
  { label: "SK하이닉스",   symbol: "000660.KS", color: "#16a34a" },
  { label: "필라델피아반도체", symbol: "^SOX",  color: "#ea580c" },
  { label: "엔비디아",     symbol: "NVDA",      color: "#d946ef" },
] as const;

type Symbol = (typeof TICKERS)[number]["symbol"];

const PERIODS = [
  { label: "1개월", value: "1mo" },
  { label: "1년",   value: "1y"  },
  { label: "2년",   value: "2y"  },
] as const;

type Period = (typeof PERIODS)[number]["value"];

const DEFAULT_SYMBOLS: Symbol[] = ["^KS11", "^IXIC", "005930.KS", "MU", "000660.KS"];

type ChartRow = { date: string; [symbol: string]: number | string };

const formatY = (v: number) => `${v.toFixed(0)}`;

function TooltipContent({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-md text-xs">
      <p className="font-semibold text-slate-700 mb-1.5">{label}</p>
      {payload
        .slice()
        .sort((a, b) => b.value - a.value)
        .map((entry) => {
          const diff = entry.value - 100;
          return (
            <div key={entry.name} className="flex items-center justify-between gap-4 py-0.5">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full inline-block" style={{ background: entry.color }} />
                <span className="text-slate-600">
                  {TICKERS.find((t) => t.symbol === entry.name)?.label ?? entry.name}
                </span>
              </span>
              <span className="font-semibold" style={{ color: entry.color }}>
                {entry.value.toFixed(1)}
                <span className={`ml-1 ${diff >= 0 ? "text-red-500" : "text-blue-500"}`}>
                  ({diff >= 0 ? "+" : ""}{diff.toFixed(1)}%)
                </span>
              </span>
            </div>
          );
        })}
    </div>
  );
}

export default function RelativeChart() {
  const [selected, setSelected] = useState<Set<Symbol>>(new Set(DEFAULT_SYMBOLS));
  const [period, setPeriod] = useState<Period>("1y");
  const [data, setData] = useState<ChartRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const fetchData = useCallback(async (symbols: Symbol[], p: Period) => {
    if (symbols.length === 0) { setData([]); return; }
    setLoading(true);
    setError(false);
    try {
      const q = symbols.map(encodeURIComponent).join(",");
      const res = await fetch(`/api/relative-performance?symbols=${q}&period=${p}`);
      const json = await res.json();
      setData(json.data ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData([...selected] as Symbol[], period);
  }, [selected, period, fetchData]);

  const toggleTicker = (symbol: Symbol) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) {
        if (next.size === 1) return prev; // 최소 1개 유지
        next.delete(symbol);
      } else {
        next.add(symbol);
      }
      return next;
    });
  };

  const periodLabel = PERIODS.find((p) => p.value === period)?.label ?? "";

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6 mb-12">
      {/* 헤더 */}
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-lg font-bold text-slate-800">
            📊 상대 수익률 비교
            <span className="ml-2 text-sm font-normal text-slate-400">기준={periodLabel} 전 = 100</span>
          </h2>
          {/* 기간 선택 */}
          <div className="flex gap-1">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  period === p.value
                    ? "bg-slate-800 text-white"
                    : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* 종목 선택 */}
        <div className="flex flex-wrap gap-1.5">
          {TICKERS.map((t) => {
            const active = selected.has(t.symbol);
            return (
              <button
                key={t.symbol}
                onClick={() => toggleTicker(t.symbol)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                  active
                    ? "text-white border-transparent"
                    : "bg-white text-slate-400 border-slate-200 hover:border-slate-300"
                }`}
                style={active ? { backgroundColor: t.color, borderColor: t.color } : {}}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full inline-block"
                  style={{ backgroundColor: active ? "rgba(255,255,255,0.7)" : t.color }}
                />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 차트 */}
      {loading ? (
        <div className="h-[260px] bg-slate-50 rounded-xl animate-pulse" />
      ) : error || !data ? (
        <div className="h-[260px] flex items-center justify-center text-slate-400 text-sm">
          데이터를 불러올 수 없습니다
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "#94a3b8" }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={formatY}
              tick={{ fontSize: 11, fill: "#94a3b8" }}
              tickLine={false}
              axisLine={false}
              width={36}
              domain={["auto", "auto"]}
            />
            <ReferenceLine y={100} stroke="#e2e8f0" strokeDasharray="4 3" />
            <Tooltip content={<TooltipContent />} />
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              formatter={(value) => TICKERS.find((t) => t.symbol === value)?.label ?? value}
            />
            {TICKERS.filter((t) => selected.has(t.symbol)).map((t) => (
              <Line
                key={t.symbol}
                type="monotone"
                dataKey={t.symbol}
                stroke={t.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}

      <p className="text-xs text-slate-400 mt-3 text-right">
        출처: Yahoo Finance · 기간 시작일 종가 = 100 기준 상대 수익률
      </p>
    </section>
  );
}
