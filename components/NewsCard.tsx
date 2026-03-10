import type { News } from "@/lib/types";
import KeywordBadge from "./KeywordBadge";

interface NewsCardProps {
  news: News;
  compact?: boolean;
}

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

  return (
    <article className="bg-white rounded-xl border border-slate-200 px-4 py-4 hover:shadow-md hover:border-blue-200 transition-all group">
      {/* 상단: 출처 + 날짜 */}
      <div className="flex items-center gap-2 mb-2">
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
