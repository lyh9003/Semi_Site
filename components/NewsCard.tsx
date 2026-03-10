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
    <article className="bg-white rounded-xl border border-slate-200 px-5 py-4 hover:shadow-md hover:border-blue-200 transition-all group flex gap-5 items-start">
      {/* 왼쪽: 출처 + 날짜 */}
      <div className="shrink-0 w-32 pt-0.5">
        <span className="block text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md mb-1.5 truncate">
          {news.company}
        </span>
        <span className="text-xs text-slate-400">{formattedDate}</span>
      </div>

      {/* 가운데: 제목 + 요약 */}
      <div className="flex-1 min-w-0">
        <a
          href={news.link}
          target="_blank"
          rel="noopener noreferrer"
          className="block"
        >
          <h3 className="font-semibold text-slate-800 mb-1.5 leading-snug group-hover:text-blue-600 transition-colors">
            {news.title}
          </h3>
        </a>
        {!compact && news.summary && (
          <p className="text-sm text-slate-500 leading-relaxed line-clamp-2">
            {news.summary}
          </p>
        )}
      </div>

      {/* 오른쪽: 키워드 */}
      {keywords.length > 0 && (
        <div className="shrink-0 flex flex-wrap gap-1.5 justify-end max-w-[180px]">
          {keywords.slice(0, 4).map((kw) => (
            <KeywordBadge key={kw} keyword={kw} />
          ))}
        </div>
      )}
    </article>
  );
}
