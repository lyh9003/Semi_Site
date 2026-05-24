"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

// ─── Types ────────────────────────────────────────────────────────────────────
interface NewsRow {
  id: number; title: string; company: string; date: string;
  summary: string; keyword: string; importance: number; link: string;
}
interface ReportRow {
  id: number; title: string; securities_firm: string; date: string;
  one_line_summary: string; keyword: string; target_price: string | null;
  link: string; source: string;
}
interface TelegramRow {
  id: number; channel: string; message: string; summary: string;
  keywords: string; sentiment: string; forward_count: number; date_utc: string;
}

type SourceType = "news" | "report" | "telegram";

interface UnifiedItem {
  id: number;
  source: SourceType;
  title: string;
  body: string;
  keywords: string[];
  date: string;
  link?: string;
  badge?: string;
}

interface ScoredItem extends UnifiedItem {
  score: number;
}

type SearchMode = "keyword" | "semantic";

interface SemanticResult {
  news: UnifiedItem[];
  reports: UnifiedItem[];
  telegrams: UnifiedItem[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseKeywords(kw: string): string[] {
  if (!kw) return [];
  return [...new Set(
    kw.split(/[,，\s#·|]+/).map(k => k.trim().toLowerCase()).filter(k => k.length > 1)
  )];
}

function overlapScore(a: string[], b: string[]): number {
  const setA = new Set(a);
  return b.filter(k => setA.has(k)).length;
}

const SOURCE_LABEL: Record<SourceType, string> = {
  news: "뉴스", report: "증권리포트", telegram: "텔레그램",
};
const SOURCE_BADGE: Record<SourceType, string> = {
  news: "bg-blue-100 text-blue-700 border-blue-200",
  report: "bg-purple-100 text-purple-700 border-purple-200",
  telegram: "bg-teal-100 text-teal-700 border-teal-200",
};
const SOURCE_BORDER: Record<SourceType, string> = {
  news: "border-blue-400",
  report: "border-purple-400",
  telegram: "border-teal-400",
};
const SOURCE_HEADER: Record<SourceType, string> = {
  news: "bg-blue-50",
  report: "bg-purple-50",
  telegram: "bg-teal-50",
};

// ─── 공통 카드 렌더러 ──────────────────────────────────────────────────────────
function ItemCard({
  item,
  onSelect,
  badge,
}: {
  item: UnifiedItem & { score?: number; similarity?: number };
  onSelect: (i: UnifiedItem) => void;
  badge?: React.ReactNode;
}) {
  return (
    <button
      onClick={() => onSelect(item)}
      className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors"
    >
      <p className="text-xs font-medium text-slate-700 line-clamp-2 mb-1.5 leading-relaxed">
        {item.title}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        {badge}
        <span className="text-[10px] text-slate-300 ml-auto">{item.date}</span>
      </div>
    </button>
  );
}

function RelatedGrid({
  related,
  selected,
  onSelect,
  showScore,
}: {
  related: Record<SourceType, ScoredItem[]>;
  selected: UnifiedItem;
  onSelect: (i: UnifiedItem) => void;
  showScore?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      {(["news", "report", "telegram"] as SourceType[]).map(src => {
        const items = related[src];
        if (items.length === 0) return null;
        return (
          <div key={src} className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className={`px-4 py-2.5 border-b border-slate-100 flex items-center gap-2 ${SOURCE_HEADER[src]}`}>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${SOURCE_BADGE[src]}`}>
                {SOURCE_LABEL[src]}
              </span>
              <span className="text-xs text-slate-400">{items.length}건</span>
            </div>
            <div className="divide-y divide-slate-100">
              {items.map(item => {
                const commonKws = item.keywords.filter(k => selected.keywords.includes(k));
                return (
                  <ItemCard key={`${item.source}-${item.id}`} item={item} onSelect={onSelect}
                    badge={
                      <>
                        {commonKws.slice(0, 2).map(k => (
                          <span key={k} className="text-[10px] bg-yellow-50 text-yellow-700 border border-yellow-200 px-1.5 py-0.5 rounded">
                            {k}
                          </span>
                        ))}
                        {showScore && (
                          <span className="text-[10px] text-slate-400">공통 {item.score}개</span>
                        )}
                      </>
                    }
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SemanticGrid({
  semantic,
  onSelect,
}: {
  semantic: SemanticResult;
  onSelect: (i: UnifiedItem) => void;
}) {
  const totalSemantic =
    semantic.news.length + semantic.reports.length + semantic.telegrams.length;

  if (totalSemantic === 0) {
    return (
      <div className="bg-slate-50 rounded-xl border border-slate-200 border-dashed p-6 text-center text-slate-400 text-sm">
        <p className="text-2xl mb-2">🧠</p>
        의미적으로 유사한 항목이 없습니다
        <p className="text-xs mt-1 text-slate-300">임베딩 임계값: 0.4 이상</p>
      </div>
    );
  }

  const groups: [SourceType, UnifiedItem[]][] = [
    ["news", semantic.news],
    ["report", semantic.reports],
    ["telegram", semantic.telegrams],
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      {groups.map(([src, items]) => {
        if (items.length === 0) return null;
        return (
          <div key={src} className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className={`px-4 py-2.5 border-b border-slate-100 flex items-center gap-2 ${SOURCE_HEADER[src]}`}>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${SOURCE_BADGE[src]}`}>
                {SOURCE_LABEL[src]}
              </span>
              <span className="text-xs text-slate-400">{items.length}건</span>
            </div>
            <div className="divide-y divide-slate-100">
              {items.map(item => (
                <ItemCard key={`${item.source}-${item.id}`} item={item} onSelect={onSelect}
                  badge={
                    <span className="text-[10px] bg-indigo-50 text-indigo-600 border border-indigo-200 px-1.5 py-0.5 rounded">
                      의미 유사
                    </span>
                  }
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function InsightPage() {
  const supabase = createClient();
  const [allNews, setAllNews] = useState<UnifiedItem[]>([]);
  const [allReports, setAllReports] = useState<UnifiedItem[]>([]);
  const [allTelegrams, setAllTelegrams] = useState<UnifiedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<SourceType>("news");
  const [selected, setSelected] = useState<UnifiedItem | null>(null);
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<SearchMode>("keyword");
  const [semantic, setSemantic] = useState<SemanticResult | null>(null);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [semanticError, setSemanticError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [newsRes, reportRes, teleRes] = await Promise.all([
        supabase.from("news")
          .select("id,title,company,date,summary,keyword,importance,link")
          .order("date", { ascending: false }).limit(60),
        supabase.from("stock_reports")
          .select("id,title,securities_firm,date,one_line_summary,keyword,target_price,link,source")
          .order("date", { ascending: false }).limit(60),
        supabase.from("telegram_messages")
          .select("id,channel,message,summary,keywords,sentiment,forward_count,date_utc")
          .order("date_utc", { ascending: false }).limit(60),
      ]);

      setAllNews((newsRes.data ?? []).map((n: NewsRow): UnifiedItem => ({
        id: n.id, source: "news",
        title: n.title || "(제목 없음)",
        body: n.summary || "",
        keywords: parseKeywords(n.keyword),
        date: n.date?.slice(0, 10) ?? "",
        link: n.link,
        badge: n.company,
      })));

      setAllReports((reportRes.data ?? []).map((r: ReportRow): UnifiedItem => ({
        id: r.id, source: "report",
        title: r.title || "(제목 없음)",
        body: r.one_line_summary || "",
        keywords: parseKeywords(r.keyword),
        date: r.date?.slice(0, 10) ?? "",
        link: r.link,
        badge: r.securities_firm,
      })));

      setAllTelegrams((teleRes.data ?? []).map((t: TelegramRow): UnifiedItem => ({
        id: t.id, source: "telegram",
        title: t.summary || t.message?.slice(0, 80) || "(메시지)",
        body: t.message || "",
        keywords: parseKeywords(t.keywords),
        date: t.date_utc?.slice(0, 10) ?? "",
        badge: t.channel,
      })));

      setLoading(false);
    })();
  }, []);

  const allItems = useMemo(
    () => [...allNews, ...allReports, ...allTelegrams],
    [allNews, allReports, allTelegrams]
  );

  const fetchSemantic = useCallback(async (item: UnifiedItem) => {
    setSemanticLoading(true);
    setSemanticError(null);
    setSemantic(null);
    try {
      const res = await fetch("/api/insight/similar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: item.source, id: item.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSemanticError(data.error ?? "오류가 발생했습니다");
        return;
      }
      // API 결과를 UnifiedItem으로 변환
      const toItem = (src: SourceType) => (r: Record<string, unknown>): UnifiedItem => ({
        id: r.id as number,
        source: src,
        title: (r.title ?? r.summary ?? "(제목 없음)") as string,
        body: (r.summary ?? r.one_line_summary ?? "") as string,
        keywords: parseKeywords((r.keyword ?? r.keywords ?? "") as string),
        date: ((r.date ?? r.date_utc ?? "") as string).slice(0, 10),
        link: r.link as string | undefined,
        badge: (r.company ?? r.securities_firm ?? r.channel ?? "") as string,
      });
      setSemantic({
        news: (data.news ?? []).map(toItem("news")),
        reports: (data.reports ?? []).map(toItem("report")),
        telegrams: (data.telegrams ?? []).map(toItem("telegram")),
      });
    } catch {
      setSemanticError("네트워크 오류가 발생했습니다");
    } finally {
      setSemanticLoading(false);
    }
  }, []);

  const handleSelect = (item: UnifiedItem) => {
    setSelected(item);
    setSemantic(null);
    setSemanticError(null);
    setMode("keyword");
  };

  const tabItems = useMemo(() => {
    const items = tab === "news" ? allNews : tab === "report" ? allReports : allTelegrams;
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(i =>
      i.title.toLowerCase().includes(q) ||
      i.keywords.some(k => k.includes(q)) ||
      i.body.toLowerCase().includes(q)
    );
  }, [tab, allNews, allReports, allTelegrams, search]);

  const related = useMemo((): Record<SourceType, ScoredItem[]> => {
    if (!selected || selected.keywords.length === 0) {
      return { news: [], report: [], telegram: [] };
    }
    const scored = allItems
      .filter(i => !(i.source === selected.source && i.id === selected.id))
      .map(i => ({ ...i, score: overlapScore(selected.keywords, i.keywords) }))
      .filter(i => i.score > 0)
      .sort((a, b) => b.score - a.score);

    return {
      news: scored.filter(i => i.source === "news").slice(0, 5),
      report: scored.filter(i => i.source === "report").slice(0, 5),
      telegram: scored.filter(i => i.source === "telegram").slice(0, 5),
    };
  }, [selected, allItems]);

  const totalRelated = related.news.length + related.report.length + related.telegram.length;

  if (loading) return (
    <div className="flex items-center justify-center h-[60vh] text-slate-400">
      <div className="text-center">
        <div className="text-4xl mb-3 animate-spin">⚙️</div>
        <p className="text-sm">데이터 로딩 중...</p>
      </div>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* 헤더 */}
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">🔗 정보 연결 인사이트</h1>
        <p className="text-sm text-slate-500">
          뉴스·증권리포트·텔레그램에서 키워드가 겹치는 관련 정보를 교차 연결합니다.
          <span className="ml-2 text-xs text-slate-400">Phase 1 · 키워드 기반</span>
        </p>
      </div>

      <div className="flex gap-4" style={{ height: "calc(100vh - 200px)" }}>

        {/* ── 왼쪽: 탐색 패널 ── */}
        <div className="w-80 flex-shrink-0 flex flex-col bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          {/* 탭 */}
          <div className="flex border-b border-slate-200 flex-shrink-0">
            {(["news", "report", "telegram"] as SourceType[]).map(s => (
              <button key={s} onClick={() => setTab(s)}
                className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${
                  tab === s
                    ? "bg-white text-slate-900 border-b-2 border-blue-500"
                    : "text-slate-400 hover:text-slate-600 bg-slate-50"
                }`}>
                {SOURCE_LABEL[s]}
                <span className="ml-1 text-[10px] text-slate-400">
                  ({tab === s
                    ? tabItems.length
                    : s === "news" ? allNews.length
                    : s === "report" ? allReports.length
                    : allTelegrams.length})
                </span>
              </button>
            ))}
          </div>

          {/* 검색 */}
          <div className="px-3 py-2 border-b border-slate-100 flex-shrink-0">
            <input
              type="text"
              placeholder="제목·키워드 검색..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 outline-none focus:ring-1 focus:ring-blue-400 text-slate-700 placeholder-slate-400"
            />
          </div>

          {/* 목록 */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {tabItems.length === 0 ? (
              <p className="text-center text-slate-400 text-xs py-8">항목이 없습니다</p>
            ) : tabItems.map(item => {
              const isSelected = selected?.id === item.id && selected?.source === item.source;
              return (
                <button key={`${item.source}-${item.id}`} onClick={() => handleSelect(item)}
                  className={`w-full text-left px-3 py-3 hover:bg-slate-50 transition-colors ${
                    isSelected ? `bg-blue-50 border-l-2 ${SOURCE_BORDER[item.source]}` : ""
                  }`}>
                  <p className="text-xs font-semibold text-slate-800 line-clamp-2 mb-1 leading-relaxed">
                    {item.title}
                  </p>
                  <div className="flex items-center gap-1 flex-wrap">
                    {item.badge && (
                      <span className="text-[10px] text-slate-400">{item.badge}</span>
                    )}
                    {item.date && (
                      <span className="text-[10px] text-slate-300">· {item.date}</span>
                    )}
                  </div>
                  {item.keywords.slice(0, 3).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {item.keywords.slice(0, 3).map(k => (
                        <span key={k} className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                          {k}
                        </span>
                      ))}
                      {item.keywords.length > 3 && (
                        <span className="text-[10px] text-slate-400">+{item.keywords.length - 3}</span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── 오른쪽: 선택 항목 + 연관 정보 ── */}
        <div className="flex-1 flex flex-col gap-4 overflow-y-auto min-w-0">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-slate-400 bg-white rounded-xl border border-slate-200 border-dashed">
              <div className="text-center">
                <p className="text-3xl mb-3">🔍</p>
                <p className="text-sm font-medium text-slate-500">왼쪽에서 항목을 선택하세요</p>
                <p className="text-xs text-slate-400 mt-1">키워드가 겹치는 관련 정보를 자동으로 연결합니다</p>
              </div>
            </div>
          ) : (
            <>
              {/* 선택된 항목 */}
              <div className={`bg-white rounded-xl border-2 ${SOURCE_BORDER[selected.source]} p-5 shadow-sm flex-shrink-0`}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${SOURCE_BADGE[selected.source]}`}>
                    {SOURCE_LABEL[selected.source]}
                  </span>
                  {selected.badge && <span className="text-xs text-slate-500">{selected.badge}</span>}
                  {selected.date && <span className="text-xs text-slate-400 ml-auto">{selected.date}</span>}
                </div>

                <h2 className="text-base font-bold text-slate-800 mb-2 leading-snug">{selected.title}</h2>
                {selected.body && (
                  <p className="text-sm text-slate-600 leading-relaxed mb-3 line-clamp-3">{selected.body}</p>
                )}

                <div className="flex flex-wrap gap-1.5 mb-3">
                  {selected.keywords.length > 0
                    ? selected.keywords.map(k => (
                        <span key={k} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full border border-slate-200">
                          {k}
                        </span>
                      ))
                    : <span className="text-xs text-slate-400">키워드 없음</span>
                  }
                </div>

                {selected.link && (
                  <a href={selected.link} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline">
                    원문 보기 →
                  </a>
                )}
              </div>

              {/* 모드 전환 탭 */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5">
                  <button
                    onClick={() => setMode("keyword")}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                      mode === "keyword" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    🏷️ 키워드 매칭
                  </button>
                  <button
                    onClick={() => {
                      setMode("semantic");
                      if (!semantic && !semanticLoading) fetchSemantic(selected);
                    }}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                      mode === "semantic" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    🧠 의미 유사도
                  </button>
                </div>
                {mode === "semantic" && (
                  <span className="text-[10px] text-slate-400">pgvector · Phase 2</span>
                )}
              </div>

              {/* 연관 정보 */}
              <div className="flex-shrink-0">
                {mode === "keyword" ? (
                  <>
                    <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wider">
                      키워드 연관 정보 {totalRelated > 0 ? `(${totalRelated}건)` : ""}
                    </p>
                    {totalRelated === 0 ? (
                      <div className="bg-slate-50 rounded-xl border border-slate-200 border-dashed p-6 text-center text-slate-400 text-sm">
                        <p className="text-2xl mb-2">🔗</p>
                        키워드가 겹치는 연관 정보가 없습니다
                        {selected.keywords.length === 0 && (
                          <p className="text-xs mt-1">이 항목에 키워드가 등록되어 있지 않습니다</p>
                        )}
                      </div>
                    ) : (
                      <RelatedGrid
                        related={related}
                        selected={selected}
                        onSelect={handleSelect}
                        showScore
                      />
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wider">
                      의미 유사 정보
                    </p>
                    {semanticLoading && (
                      <div className="bg-slate-50 rounded-xl border border-slate-200 p-8 text-center text-slate-400">
                        <div className="text-2xl mb-2 animate-spin inline-block">⚙️</div>
                        <p className="text-sm">임베딩 기반 검색 중...</p>
                      </div>
                    )}
                    {semanticError && (
                      <div className="bg-red-50 rounded-xl border border-red-200 p-5 text-center">
                        <p className="text-sm text-red-600 font-medium mb-1">⚠️ {semanticError}</p>
                        {semanticError.includes("generate_embeddings") && (
                          <code className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded block mt-2">
                            python generate_embeddings.py
                          </code>
                        )}
                      </div>
                    )}
                    {semantic && !semanticLoading && (
                      <SemanticGrid semantic={semantic} onSelect={handleSelect} />
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
