"use client";

import { useEffect, useState } from "react";
import type { WeekPoint } from "@/app/api/graph/hot-context/route";

const TYPE_KO: Record<string, string> = {
  event: "이벤트", sector: "섹터", product: "제품", company: "기업", metric: "지표",
};
const TYPE_COLOR: Record<string, string> = {
  event: "bg-red-400",  sector: "bg-purple-400",
  product: "bg-green-400", company: "bg-blue-400", metric: "bg-amber-400",
};
const TYPE_TEXT: Record<string, string> = {
  event: "text-red-500",  sector: "text-purple-500",
  product: "text-green-500", company: "text-blue-500", metric: "text-amber-500",
};

export default function SituationTimeline() {
  const [timeline, setTimeline] = useState<WeekPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/graph/hot-context")
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.weeklyTimeline) setTimeline(data.weeklyTimeline); })
      .finally(() => setLoading(false));
  }, []);

  if (loading || timeline.length === 0) return null;

  const types = ["event", "sector", "product", "company", "metric"];
  const allValues = timeline.flatMap(w => types.map(t => w.counts[t] ?? 0));
  const maxVal = Math.max(...allValues, 1);

  // 어떤 타입이 주도했는지 파악 — 인과 전파 신호 감지
  const spikeSummary = (() => {
    if (timeline.length < 4) return null;
    const typeSpike: Record<string, number> = {};
    for (const type of types) {
      const counts = timeline.map(w => w.counts[type] ?? 0);
      const peakWeek = counts.indexOf(Math.max(...counts));
      typeSpike[type] = peakWeek; // 0=4주전, 3=최근
    }
    const order = types.slice().sort((a, b) => typeSpike[a] - typeSpike[b]);
    const dominated = order.filter(t => typeSpike[t] === 3); // 최근 주 피크
    if (dominated.length > 0) {
      return `최근 주: ${dominated.map(t => TYPE_KO[t]).join("·")} 활발`;
    }
    return null;
  })();

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5 mb-6">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-base">📈</span>
          <h2 className="text-sm font-bold text-slate-700">4주 시황 흐름</h2>
        </div>
        {spikeSummary && (
          <span className="text-xs text-slate-500 bg-slate-50 px-2 py-0.5 rounded-full border border-slate-200">
            {spikeSummary}
          </span>
        )}
      </div>
      <p className="text-[11px] text-slate-400 mb-4">엔티티 유형별 주간 언급량 — 이벤트 선행 후 기업·지표 반응 패턴 확인</p>

      {/* 범례 */}
      <div className="flex flex-wrap gap-3 mb-3">
        {types.map(t => (
          <div key={t} className="flex items-center gap-1">
            <div className={`w-2.5 h-2.5 rounded-sm ${TYPE_COLOR[t]}`} />
            <span className="text-[11px] text-slate-500">{TYPE_KO[t]}</span>
          </div>
        ))}
      </div>

      {/* 주간 바 차트 */}
      <div className="space-y-3">
        {timeline.map((week, wi) => (
          <div key={wi} className="flex items-center gap-3">
            <span className="text-[11px] text-slate-500 w-20 flex-shrink-0 text-right">
              {wi === timeline.length - 1 ? `이번 주` : `${timeline.length - wi - 1}주 전`}
              <br />
              <span className="text-[10px] text-slate-400">{week.label}</span>
            </span>
            <div className="flex-1 flex gap-0.5 h-5 items-end">
              {types.map(t => {
                const cnt = week.counts[t] ?? 0;
                const h = Math.round((cnt / maxVal) * 100);
                return (
                  <div key={t} className="flex-1 flex flex-col items-center justify-end">
                    <div
                      title={`${TYPE_KO[t]}: ${cnt}`}
                      className={`w-full rounded-t transition-all ${TYPE_COLOR[t]} ${cnt === 0 ? "opacity-10" : "opacity-90"}`}
                      style={{ height: `${Math.max(h, cnt > 0 ? 8 : 0)}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <span className="text-[11px] text-slate-400 w-10 flex-shrink-0">
              {Object.values(week.counts).reduce((a, b) => a + b, 0)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
