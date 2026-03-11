import type { News } from "@/lib/types";
import KeywordBadge from "./KeywordBadge";

interface NewsCardProps {
  news: News;
  compact?: boolean;
}

const IMPORTANCE_CONFIG = {
  3: { label: "상", className: "bg-red-50 text-red-600 border border-red-200" },
  2: { label: "중", className: "bg-amber-50 text-amber-600 border border-amber-200" },
  1: { label: "하", className: "bg-slate-100 text-slate-400 border border-slate-200" },
} as const;

export default function NewsCard({ news, compact }: NewsCardProps) {
  const keywords = news.keyword
    ? news.keyword.split(/[,，\s]+/).filter(Boolean)
    : [];

  const formattedDate = news.date
    ? new Date(news.date).toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  const importance = (news.importance ?? 1) as 1 | 2 | 3;
  const imp = IMPORTANCE_CONFIG[importance] ?? IMPORTANCE_CONFIG[1];

  return (
    <article className="bg-white rounded-xl border border-slate-200 px-4 py-4 hover:shadow-md hover:border-blue-200 transition-all group">
      {/* 상단: 중요도 + 출처 + 날짜 */}
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${imp.className}`}>
          {imp.label}
        </span>
        {news.company && news.company !== "정보 없음" && (
          <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md truncate max-w-[8rem]">
            {news.company}
          </span>
        )}
        <span className="text-xs text-slate-400">{formattedDate}</span>
      </div>

      {/* 제목 + 요약 + 키워드 */}
      <a href={news.link} target="_blank" rel="noopener noreferrer" className="block">
        <h3 className="font-semibold text-slate-800 mb-1.5 leading-snug group-hover:text-blue-600 transition-colors text-sm sm:text-base">
          {news.title}
        </h3>
      </a>
      {!compact && news.summary && (
        <p className="text-xs sm:text-sm text-slate-500 leading-relaxed line-clamp-2 mb-2">
          {news.summary}
        </p>
      )}
      {keywords.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {keywords.slice(0, 3).map((kw) => (
            <KeywordBadge key={kw} keyword={kw} />
          ))}
        </div>
      )}
    </article>
  );
}
