"use client";

import { useEffect, useState } from "react";
import type { SectorTemp } from "@/app/api/graph/hot-context/route";

export default function SectorHeatmap() {
  const [sectors, setSectors] = useState<SectorTemp[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/graph/hot-context")
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.sectorTemps) setSectors(data.sectorTemps); })
      .finally(() => setLoading(false));
  }, []);

  if (loading || sectors.length === 0) return null;

  const maxCurrent = Math.max(...sectors.map(s => s.current), 1);

  const heat = (delta: number) => {
    if (delta >= 50)  return { bar: "bg-red-500",    text: "text-red-400",    label: "급등" };
    if (delta >= 20)  return { bar: "bg-orange-400", text: "text-orange-400", label: "상승" };
    if (delta >= 0)   return { bar: "bg-blue-400",   text: "text-blue-400",   label: "보합" };
    if (delta >= -20) return { bar: "bg-slate-400",  text: "text-slate-400",  label: "약보합" };
    return              { bar: "bg-slate-600",  text: "text-slate-500",  label: "하락" };
  };

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-base">🌡️</span>
        <h2 className="text-sm font-bold text-slate-700">섹터 온도 <span className="font-normal text-slate-400 text-xs">— 최근 7일 언급 vs 직전 7일</span></h2>
      </div>
      <div className="space-y-2">
        {sectors.map(s => {
          const style = heat(s.deltaPercent);
          const barW = Math.round((s.current / maxCurrent) * 100);
          const sign = s.deltaPercent > 0 ? "+" : "";
          const arrow = s.deltaPercent >= 10 ? "↑" : s.deltaPercent <= -10 ? "↓" : "→";
          return (
            <div key={s.id} className="flex items-center gap-2">
              <span className="w-20 text-xs text-slate-600 truncate flex-shrink-0">{s.name}</span>
              <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                <div className={`h-full rounded-full transition-all ${style.bar}`} style={{ width: `${barW}%` }} />
              </div>
              <span className={`w-16 text-right text-xs font-semibold ${style.text} flex-shrink-0`}>
                {arrow} {sign}{s.deltaPercent}%
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-slate-400">섹터 엔티티 + 연결 기업·지표의 뉴스 언급량 기반</p>
    </section>
  );
}
