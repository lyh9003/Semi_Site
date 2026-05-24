"use client";

import { useEffect, useState } from "react";

interface Weather { emoji: string; label: string; reason: string }

const WEATHER_STYLE: Record<string, string> = {
  "맑음":      "bg-amber-400/20 text-amber-300 border-amber-400/30",
  "구름 조금": "bg-sky-400/20 text-sky-300 border-sky-400/30",
  "흐림":      "bg-slate-400/20 text-slate-300 border-slate-400/30",
  "비":        "bg-blue-500/20 text-blue-300 border-blue-500/30",
  "폭풍":      "bg-red-500/20 text-red-300 border-red-500/30",
  "안개":      "bg-purple-400/20 text-purple-300 border-purple-400/30",
};

export default function DailyBriefing() {
  const [briefing, setBriefing] = useState("");
  const [date, setDate] = useState("");
  const [weather, setWeather] = useState<Weather | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const loadBriefing = async (bust = false) => {
    const url = bust ? `/api/briefing?t=${Date.now()}` : "/api/briefing";
    const res = await fetch(url, bust ? { cache: "no-store" } : undefined);
    if (!res.ok) throw new Error();
    return res.json();
  };

  useEffect(() => {
    loadBriefing()
      .then(data => { setBriefing(data.briefing); setDate(data.date); setWeather(data.weather ?? null); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const data = await loadBriefing(true);
      setBriefing(data.briefing);
      setDate(data.date);
      setWeather(data.weather ?? null);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setRefreshing(false);
    }
  };

  if (error && !briefing) return null;

  const weatherStyle = weather ? (WEATHER_STYLE[weather.label] ?? WEATHER_STYLE["흐림"]) : "";

  return (
    <section className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-6 text-white mb-8">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-lg">📊</span>
        <h2 className="text-base font-bold">오늘의 반도체 시황 브리핑</h2>

        {weather && !loading && (
          <span
            title={weather.reason}
            className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${weatherStyle} cursor-default`}
          >
            {weather.emoji} {weather.label}
          </span>
        )}

        {date && (
          <span className="ml-auto text-xs text-slate-400">{date}</span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm">
          <span className="animate-spin inline-block">⚙️</span>
          AI가 오늘 시황을 분석 중입니다...
        </div>
      ) : (
        <div className={`text-sm text-slate-200 leading-relaxed whitespace-pre-wrap transition-opacity ${refreshing ? "opacity-40" : "opacity-100"}`}>
          {refreshing ? (
            <div className="flex items-center gap-2 text-slate-400">
              <span className="animate-spin inline-block">⚙️</span>
              브리핑을 새로 생성 중입니다...
            </div>
          ) : briefing}
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-slate-700 flex items-center gap-3 flex-wrap">
        <a href="/ask"
          className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg transition-colors font-medium">
          🤖 더 자세히 물어보기
        </a>
        <button
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className="text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 px-3 py-1.5 rounded-lg transition-colors font-medium"
        >
          {refreshing ? "⚙️ 생성 중..." : "🔄 브리핑 새로고침"}
        </button>
        <span className="text-xs text-slate-500">최신 뉴스·리포트·텔레그램 기반 · AI 요약은 참고용</span>
      </div>
    </section>
  );
}
