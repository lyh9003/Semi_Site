"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import NewsCard from "@/components/NewsCard";
import KeywordBadge from "@/components/KeywordBadge";
import type { News } from "@/lib/types";

const POPULAR_KEYWORDS = [
  "메모리", "파운드리", "HBM", "반도체", "AI", "삼성전자", "SK하이닉스", "TSMC",
  "마이크론", "엔비디아", "인텔", "퀄컴", "ASML", "DRAM", "NAND", "DDR5",
  "EUV", "CoWoS", "GAA", "전력반도체", "온디바이스", "자율주행",
];
const KEYWORDS_INITIAL_SHOW = 8;
const PAGE_SIZE = 12;

const IMPORTANCE_FILTERS = [
  { value: 3, label: "🔴 상" },
  { value: 2, label: "🟡 중" },
  { value: 1, label: "⚪ 하" },
] as const;

const ALL_IMPORTANCES = IMPORTANCE_FILTERS.map((f) => f.value);

export default function NewsPage() {
  const supabase = createClient();
  const [news, setNews] = useState<News[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedKeyword, setSelectedKeyword] = useState("");
  const [selectedImportances, setSelectedImportances] = useState<number[]>([...ALL_IMPORTANCES]);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [showAllKeywords, setShowAllKeywords] = useState(false);

  const fetchNews = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("news")
      .select("*", { count: "exact" })
      .order("date", { ascending: false })
      .order("importance", { ascending: false })
      .order("id", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    if (search.trim()) {
      query = query.or(`title.ilike.%${search}%,summary.ilike.%${search}%,company.ilike.%${search}%`);
    }
    if (selectedKeyword) {
      query = query.ilike("keyword", `%${selectedKeyword}%`);
    }
    if (selectedImportances.length > 0 && selectedImportances.length < ALL_IMPORTANCES.length) {
      query = query.in("importance", selectedImportances);
    }

    const { data, count } = await query;
    setNews(data ?? []);
    setTotalCount(count ?? 0);
    setLoading(false);
  }, [page, search, selectedKeyword, selectedImportances]);

  useEffect(() => {
    fetchNews();
  }, [fetchNews]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const toggleImportance = (val: number) => {
    setSelectedImportances((prev) =>
      prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val]
    );
    setPage(1);
  };

  const handleKeywordClick = (kw: string) => {
    setSelectedKeyword(prev => prev === kw ? "" : kw);
    setPage(1);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchNews();
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-800 mb-2">반도체 뉴스</h1>
        <p className="text-slate-500">국내외 반도체 산업의 최신 뉴스를 확인하세요.</p>
      </div>

      {/* 검색 */}
      <form onSubmit={handleSearch} className="mb-5">
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="기사 제목, 내용, 언론사 검색..."
            className="w-full pl-12 pr-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-lg">🔍</span>
          <button
            type="submit"
            className="absolute right-3 top-1/2 -translate-y-1/2 px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            검색
          </button>
        </div>
      </form>

      {/* 중요도 필터 */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm text-slate-400 mr-1">중요도:</span>
        {IMPORTANCE_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => toggleImportance(f.value)}
            className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors border ${
              selectedImportances.includes(f.value)
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 키워드 필터 */}
      <div className="flex flex-wrap gap-2 mb-8">
        <span className="text-sm text-slate-400 mr-1 self-center">필터:</span>
        {(showAllKeywords ? POPULAR_KEYWORDS : POPULAR_KEYWORDS.slice(0, KEYWORDS_INITIAL_SHOW)).map((kw) => (
          <KeywordBadge
            key={kw}
            keyword={kw}
            onClick={() => handleKeywordClick(kw)}
            active={selectedKeyword === kw}
          />
        ))}
        <button
          onClick={() => setShowAllKeywords(v => !v)}
          className="text-xs text-slate-400 hover:text-slate-600 underline self-center"
        >
          {showAllKeywords ? "접기" : `+${POPULAR_KEYWORDS.length - KEYWORDS_INITIAL_SHOW} 더 보기`}
        </button>
        {selectedKeyword && (
          <button
            onClick={() => { setSelectedKeyword(""); setPage(1); }}
            className="text-xs text-slate-400 hover:text-slate-600 underline self-center"
          >
            필터 해제
          </button>
        )}
      </div>

      {/* 결과 수 */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500">
          총 <span className="font-semibold text-slate-700">{totalCount.toLocaleString()}</span>건
        </p>
      </div>

      {/* 뉴스 그리드 */}
      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: PAGE_SIZE }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 px-5 py-4 animate-pulse flex gap-5">
              <div className="shrink-0 w-32">
                <div className="h-5 bg-slate-200 rounded mb-2" />
                <div className="h-3 bg-slate-200 rounded w-3/4" />
              </div>
              <div className="flex-1">
                <div className="h-4 bg-slate-200 rounded mb-2" />
                <div className="h-3 bg-slate-200 rounded mb-1" />
                <div className="h-3 bg-slate-200 rounded w-4/5" />
              </div>
            </div>
          ))}
        </div>
      ) : news.length > 0 ? (
        <div className="flex flex-col gap-3">
          {news.map((item) => (
            <NewsCard key={item.id} news={item} />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 text-slate-400">
          <p className="text-4xl mb-3">🔍</p>
          <p>검색 결과가 없습니다.</p>
        </div>
      )}

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-10">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← 이전
          </button>

          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            const start = Math.max(1, Math.min(page - 2, totalPages - 4));
            const pageNum = start + i;
            return (
              <button
                key={pageNum}
                onClick={() => setPage(pageNum)}
                className={`w-10 h-10 rounded-lg text-sm font-medium transition-colors ${
                  page === pageNum
                    ? "bg-blue-600 text-white"
                    : "border border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {pageNum}
              </button>
            );
          })}

          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            다음 →
          </button>
        </div>
      )}
    </div>
  );
}
