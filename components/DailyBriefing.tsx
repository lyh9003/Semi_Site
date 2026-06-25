"use client";

import { useEffect, useState } from "react";

interface Weather { emoji: string; label: string; reason: string }
interface StockSnapshot { name: string; price: string; change: number; }

function adaptForDark(html: string): string {
  return html
    .replace(/color:#0f172a/g, "color:#e2e8f0")
    .replace(/color:#334155/g, "color:#94a3b8")
    .replace(/color:#0369a1/g, "color:#7dd3fc")
    .replace(/color:#0c4a6e/g, "color:#bae6fd")
    .replace(/color:#92400e/g, "color:#fde68a")
    .replace(/background:#f0f9ff/g, "background:rgba(30,58,138,0.35)")
    .replace(/background:#fef3c7/g, "background:rgba(251,191,36,0.15)")
    .replace(/border:1px solid #fcd34d/g, "border:1px solid rgba(251,191,36,0.4)")
    .replace(/border-bottom:1px solid #e2e8f0/g, "border-bottom:1px solid #475569")
    .replace(/border-left:3px solid #38bdf8/g, "border-left:3px solid #38bdf8");
}

const WEATHER_STYLE: Record<string, string> = {
  "맑음":      "bg-amber-400/20 text-amber-300 border-amber-400/30",
  "구름 조금": "bg-sky-400/20 text-sky-300 border-sky-400/30",
  "흐림":      "bg-slate-400/20 text-slate-300 border-slate-400/30",
  "비":        "bg-blue-500/20 text-blue-300 border-blue-500/30",
  "폭풍":      "bg-red-500/20 text-red-300 border-red-500/30",
  "안개":      "bg-purple-400/20 text-purple-300 border-purple-400/30",
};

export default function DailyBriefing() {
  const [briefing, setBriefing]         = useState("");
  const [date, setDate]                 = useState("");
  const [weather, setWeather]           = useState<Weather | null>(null);
  const [causalChains, setCausalChains] = useState<string[]>([]);
  const [newAlerts, setNewAlerts]       = useState<string[]>([]);
  const [stocks, setStocks]             = useState<(StockSnapshot | null)[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]       = useState(false);

  const [isHtml, setIsHtml] = useState(false);

  const loadBriefing = async (bust = false) => {
    const url = bust ? `/api/briefing?regenerate=1&t=${Date.now()}` : "/api/briefing";
    const res = await fetch(url, bust ? { cache: "no-store" } : undefined);
    if (!res.ok) throw new Error();
    return res.json();
  };

  const applyData = (data: { briefing: string; htmlContent?: string; date: string; weather: Weather; causalChains?: string[]; newAlerts?: string[]; stocks?: (StockSnapshot | null)[] }) => {
    setIsHtml(!!data.htmlContent);
    setBriefing(data.htmlContent ?? data.briefing);
    setDate(data.date);
    setWeather(data.weather ?? null);
    setCausalChains(data.causalChains ?? []);
    setNewAlerts(data.newAlerts ?? []);
    setStocks(data.stocks ?? []);
  };

  useEffect(() => {
    loadBriefing()
      .then(applyData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try { applyData(await loadBriefing(true)); setError(false); }
    catch { setError(true); }
    finally { setRefreshing(false); }
  };

  if (error && !briefing) return null;

  const weatherStyle = weather ? (WEATHER_STYLE[weather.label] ?? WEATHER_STYLE["흐림"]) : "";

  return (
    <section className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-6 text-white mb-8">
      {/* 헤더 */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-lg">📊</span>
        <h2 className="text-base font-bold">오늘의 반도체 시황 브리핑</h2>
        {weather && !loading && (
          <span title={weather.reason}
            className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${weatherStyle} cursor-default`}>
            {weather.emoji} {weather.label}
          </span>
        )}
        {date && <span className="ml-auto text-xs text-slate-400">{date}</span>}
      </div>

      {/* 주가 요약 — htmlContent에 이미 포함된 경우 중복 방지 */}
      {!isHtml && stocks.filter(Boolean).length > 0 && (
        <div className="flex flex-wrap gap-4 mb-4 text-xs text-slate-300">
          {stocks.filter((s): s is StockSnapshot => s !== null).map(s => {
            const up = s.change > 0;
            const dn = s.change < 0;
            return (
              <span key={s.name} className="flex items-center gap-1">
                <span className="text-slate-400">{s.name}</span>
                <span className="font-semibold">{s.price}</span>
                <span className={up ? "text-red-400" : dn ? "text-blue-400" : "text-slate-400"}>
                  {up ? "▲" : dn ? "▼" : "─"}{Math.abs(s.change)}%
                </span>
              </span>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm">
          <span className="animate-spin inline-block">⚙️</span>
          AI가 오늘 시황을 분석 중입니다...
        </div>
      ) : refreshing ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm opacity-60">
          <span className="animate-spin inline-block">⚙️</span>
          브리핑을 새로 생성 중입니다...
        </div>
      ) : (
        <>
          {/* 최근 이슈 알림 */}
          {newAlerts.length > 0 && (
            <div className="mb-4 p-3 rounded-xl bg-amber-400/10 border border-amber-400/20">
              <p className="text-[11px] font-bold text-amber-300 mb-1.5 uppercase tracking-wider">⚡ 최근 이슈</p>
              <div className="space-y-1">
                {newAlerts.map((a, i) => (
                  <p key={i} className="text-xs text-amber-100 leading-relaxed">{a}</p>
                ))}
              </div>
            </div>
          )}

          {/* 인과 흐름 (아이디어 2) */}
          {causalChains.length > 0 && (
            <div className="mb-4 p-3 rounded-xl bg-blue-900/30 border border-blue-500/20">
              <p className="text-[11px] font-bold text-blue-300 mb-2 uppercase tracking-wider">🔗 거시적 흐름</p>
              <div className="space-y-1">
                {causalChains.map((c, i) => (
                  <p key={i} className="text-xs text-blue-100 leading-relaxed">{c}</p>
                ))}
              </div>
            </div>
          )}

          {/* 브리핑 본문 */}
          {isHtml ? (
            <div className="text-sm text-slate-200 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: adaptForDark(briefing) }} />
          ) : (
            <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
              {briefing}
            </div>
          )}
        </>
      )}

      <div className="mt-4 pt-4 border-t border-slate-700 flex items-center gap-3 flex-wrap">
        <a href="/ask"
          className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg transition-colors font-medium">
          더 자세히 물어보기
        </a>
        <button onClick={handleRefresh} disabled={refreshing || loading}
          className="text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 px-3 py-1.5 rounded-lg transition-colors font-medium">
          {refreshing ? "⚙️ 생성 중..." : "브리핑 새로고침"}
        </button>
        <span className="text-xs text-slate-500">최신 뉴스·리포트·텔레그램 기반 · AI 요약은 참고용</span>
      </div>
    </section>
  );
}
