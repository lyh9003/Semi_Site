"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import TelegramCard from "@/components/TelegramCard";
import type { TelegramMessage } from "@/lib/types";

const PAGE_SIZE = 15;

const SENTIMENT_FILTERS = [
  { value: "긍정", label: "🟢 긍정" },
  { value: "중립", label: "⚪ 중립" },
  { value: "부정", label: "🔴 부정" },
] as const;

const ALL_SENTIMENTS = SENTIMENT_FILTERS.map((f) => f.value);

export default function TelegramPage() {
  const supabase = createClient();
  const [messages, setMessages] = useState<TelegramMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedSentiments, setSelectedSentiments] = useState<string[]>([...ALL_SENTIMENTS]);
  const [selectedChannel, setSelectedChannel] = useState("");
  const [channels, setChannels] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [sortBy, setSortBy] = useState<"date" | "popular">("date");
  const [showAllChannels, setShowAllChannels] = useState(false);

  const CHANNELS_INITIAL_SHOW = 5;

  // 채널 목록 로드 (distinct 흉내: 채널별 1건씩 가져와 중복 제거)
  useEffect(() => {
    supabase
      .from("telegram_messages")
      .select("channel")
      .limit(5000)
      .then(({ data }) => {
        if (!data) return;
        const unique = [...new Set(data.map((r) => r.channel).filter(Boolean))].sort();
        setChannels(unique);
      });
  }, []);

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("telegram_messages")
      .select("*", { count: "exact" })
      .order(sortBy === "popular" ? "forward_count" : "date_day", { ascending: false })
      .order("forward_count", { ascending: false })
      .order("date_utc", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    if (search.trim()) {
      query = query.or(`summary.ilike.%${search}%,message.ilike.%${search}%,keywords.ilike.%${search}%`);
    }
    if (selectedSentiments.length > 0 && selectedSentiments.length < ALL_SENTIMENTS.length) {
      query = query.or(selectedSentiments.map((s) => `sentiment.ilike.%${s}%`).join(","));
    }
    if (selectedChannel) {
      query = query.eq("channel", selectedChannel);
    }

    const { data, count } = await query;
    setMessages(data ?? []);
    setTotalCount(count ?? 0);
    setLoading(false);
  }, [page, search, selectedSentiments, selectedChannel, sortBy]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const toggleSentiment = (val: string) => {
    setSelectedSentiments((prev) =>
      prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val]
    );
    setPage(1);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchMessages();
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-800 mb-2">텔레그램 채널</h1>
        <p className="text-slate-500">반도체 관련 텔레그램 채널의 주요 메시지를 AI로 요약해 제공합니다.</p>
      </div>

      {/* 검색 */}
      <form onSubmit={handleSearch} className="mb-5">
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="키워드, 요약 내용 검색..."
            className="w-full pl-12 pr-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
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

      {/* 감성 필터 */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-sm text-slate-400 mr-1">감성:</span>
        {SENTIMENT_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => toggleSentiment(f.value)}
            className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors border ${
              selectedSentiments.includes(f.value)
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 채널 필터 */}
      {channels.length > 0 && (
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          <span className="text-sm text-slate-400 mr-1">채널:</span>
          <button
            onClick={() => { setSelectedChannel(""); setPage(1); }}
            className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors border ${
              selectedChannel === ""
                ? "bg-violet-600 text-white border-violet-600"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            }`}
          >
            전체
          </button>
          {(showAllChannels ? channels : channels.slice(0, CHANNELS_INITIAL_SHOW)).map((ch) => (
            <button
              key={ch}
              onClick={() => { setSelectedChannel(ch); setPage(1); }}
              className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors border ${
                selectedChannel === ch
                  ? "bg-violet-600 text-white border-violet-600"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              {ch}
            </button>
          ))}
          {channels.length > CHANNELS_INITIAL_SHOW && (
            <button
              onClick={() => setShowAllChannels(v => !v)}
              className="text-xs text-slate-400 hover:text-slate-600 underline"
            >
              {showAllChannels ? "접기" : `+${channels.length - CHANNELS_INITIAL_SHOW} 더 보기`}
            </button>
          )}
        </div>
      )}

      {/* 정렬 + 결과 수 */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500">
          총 <span className="font-semibold text-slate-700">{totalCount.toLocaleString()}</span>건
        </p>
        <div className="flex gap-1">
          {(["date", "popular"] as const).map((s) => (
            <button
              key={s}
              onClick={() => { setSortBy(s); setPage(1); }}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors border ${
                sortBy === s
                  ? "bg-slate-700 text-white border-slate-700"
                  : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
              }`}
            >
              {s === "date" ? "최신순" : "🔁 인기순"}
            </button>
          ))}
        </div>
      </div>

      {/* 메시지 목록 */}
      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: PAGE_SIZE }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 px-5 py-4 animate-pulse h-24" />
          ))}
        </div>
      ) : messages.length > 0 ? (
        <div className="flex flex-col gap-3">
          {messages.map((msg) => (
            <TelegramCard key={msg.id} msg={msg} />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 text-slate-400">
          <p className="text-4xl mb-3">📭</p>
          <p>메시지가 없습니다.</p>
        </div>
      )}

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-10">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
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
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
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
