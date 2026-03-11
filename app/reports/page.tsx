"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import ReportCard from "@/components/ReportCard";
import KeywordBadge from "@/components/KeywordBadge";
import type { StockReport } from "@/lib/types";

const POPULAR_KEYWORDS = ["메모리", "파운드리", "HBM", "반도체", "AI", "DRAM", "NAND"];
const PAGE_SIZE = 12;

function ReportsContent() {
  const supabase = createClient();

  const [reports, setReports] = useState<StockReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedKeyword, setSelectedKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("stock_reports")
      .select("*", { count: "exact" })
      .order("date", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    if (search.trim()) {
      query = query.or(`title.ilike.%${search}%,one_line_summary.ilike.%${search}%,securities_firm.ilike.%${search}%`);
    }
    if (selectedKeyword) {
      query = query.ilike("keyword", `%${selectedKeyword}%`);
    }

    const { data, count } = await query;
    setReports(data ?? []);
    setTotalCount(count ?? 0);
    setLoading(false);
  }, [page, search, selectedKeyword]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const handleKeywordClick = (kw: string) => {
    setSelectedKeyword(prev => prev === kw ? "" : kw);
    setPage(1);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-800 mb-2">증권 리포트</h1>
        <p className="text-slate-500">주요 증권사의 반도체 분석 리포트를 제공합니다.</p>
      </div>

      {/* 검색 */}
      <form onSubmit={(e) => { e.preventDefault(); setPage(1); fetchReports(); }} className="mb-5">
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="리포트 제목, 증권사, 키워드 검색..."
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

      {/* 키워드 필터 */}
      <div className="flex flex-wrap gap-2 mb-8">
        <span className="text-sm text-slate-400 mr-1 self-center">필터:</span>
        {POPULAR_KEYWORDS.map((kw) => (
          <KeywordBadge
            key={kw}
            keyword={kw}
            onClick={() => handleKeywordClick(kw)}
            active={selectedKeyword === kw}
          />
        ))}
        {selectedKeyword && (
          <button
            onClick={() => { setSelectedKeyword(""); setPage(1); }}
            className="text-xs text-slate-400 hover:text-slate-600 underline"
          >
            필터 해제
          </button>
        )}
      </div>

      <div className="mb-4">
        <p className="text-sm text-slate-500">
          총 <span className="font-semibold text-slate-700">{totalCount.toLocaleString()}</span>건
        </p>
      </div>

      {/* 리포트 목록 */}
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
                <div className="h-3 bg-slate-200 rounded w-4/5" />
              </div>
              <div className="shrink-0 w-28 h-9 bg-slate-200 rounded-lg" />
            </div>
          ))}
        </div>
      ) : reports.length > 0 ? (
        <div className="flex flex-col gap-3">
          {reports.map((report) => (
            <ReportCard key={report.id} report={report} />
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

export default function ReportsPage() {
  return (
    <Suspense fallback={<div className="max-w-6xl mx-auto px-4 py-10"><p className="text-slate-400">로딩 중...</p></div>}>
      <ReportsContent />
    </Suspense>
  );
}
