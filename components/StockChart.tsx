"use client";

import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";

interface StockData {
  history: { date: string; price: number }[];
  currentPrice: number;
  change: number;
}

interface StocksResponse {
  samsung: StockData;
  hynix: StockData;
}

function PriceBadge({ name, data }: { name: string; data: StockData }) {
  const up = data.change >= 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm font-semibold text-slate-700">{name}</span>
      <span className="text-base font-bold text-slate-900">
        {data.currentPrice.toLocaleString()}원
      </span>
      <span className={`text-sm font-semibold ${up ? "text-red-500" : "text-blue-500"}`}>
        {up ? "▲" : "▼"} {Math.abs(data.change)}%
      </span>
    </div>
  );
}

const formatPrice = (v: number) => `${(v / 1000).toFixed(0)}k`;

export default function StockChart() {
  const [data, setData] = useState<StocksResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/stocks")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(true);
        else setData(d);
      })
      .catch(() => setError(true));
  }, []);

  // samsung + hynix 히스토리 병합 (날짜 기준)
  const chartData = data
    ? data.samsung.history.map((s, i) => ({
        date: s.date,
        삼성전자: s.price,
        SK하이닉스: data.hynix.history[i]?.price ?? null,
      }))
    : [];

  if (error) return null;

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6 mb-12">
      <div className="flex flex-col gap-2 mb-4">
        <h2 className="text-lg font-bold text-slate-800">📈 주요 반도체 주가</h2>
        {data ? (
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <PriceBadge name="삼성전자" data={data.samsung} />
            <PriceBadge name="SK하이닉스" data={data.hynix} />
          </div>
        ) : (
          <div className="h-5 w-48 bg-slate-100 rounded animate-pulse" />
        )}
      </div>

      {data ? (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData} margin={{ top: 4, right: 44, left: 0, bottom: 0 }}>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "#94a3b8" }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              yAxisId="left"
              tickFormatter={formatPrice}
              tick={{ fontSize: 11, fill: "#2563eb" }}
              tickLine={false}
              axisLine={false}
              width={36}
              domain={["auto", "auto"]}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tickFormatter={formatPrice}
              tick={{ fontSize: 11, fill: "#16a34a" }}
              tickLine={false}
              axisLine={false}
              width={44}
              domain={["auto", "auto"]}
            />
            <Tooltip
              formatter={(v: unknown, name: unknown) => [`${Number(v).toLocaleString()}원`, String(name ?? "")]}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
            />
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="삼성전자"
              stroke="#2563eb"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="SK하이닉스"
              stroke="#16a34a"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-[220px] bg-slate-50 rounded-xl animate-pulse" />
      )}

      <p className="text-xs text-slate-400 mt-3 text-right">
        출처: Yahoo Finance · 최근 1개월 종가 기준
      </p>
    </section>
  );
}
