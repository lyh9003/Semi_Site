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
      <div className="flex gap-3 items-start">
        {/* 왼쪽: 출처 + 날짜 */}
        <div className="shrink-0 w-20 sm:w-28 pt-0.5">
          <span className="block text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md mb-1 truncate">
            {news.company}
          </span>
          <span className="text-xs text-slate-400 whitespace-nowrap">{formattedDate}</span>
        </div>

        {/* 오른쪽: 제목 + 요약 + 키워드 */}
        <div className="flex-1 min-w-0">
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
        </div>
      </div>
    </article>
  );
}
