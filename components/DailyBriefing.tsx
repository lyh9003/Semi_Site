"use client";

import { useEffect, useState } from "react";

export default function DailyBriefing() {
  const [briefing, setBriefing] = useState("");
  const [date, setDate] = useState("");
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
      .then(data => { setBriefing(data.briefing); setDate(data.date); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const data = await loadBriefing(true);
      setBriefing(data.briefing);
      setDate(data.date);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setRefreshing(false);
    }
  };

  if (error && !briefing) return null;

  return (
    <section className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-6 text-white mb-8">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">📊</span>
        <h2 className="text-base font-bold">오늘의 반도체 시황 브리핑</h2>
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
