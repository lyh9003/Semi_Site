"use client";

import type { StockReport } from "@/lib/types";
import KeywordBadge from "./KeywordBadge";

interface ReportCardProps {
  report: StockReport;
  hasSubscription: boolean;
  onSubscribeClick: () => void;
}

export default function ReportCard({ report, hasSubscription, onSubscribeClick }: ReportCardProps) {
  const keywords = report.keyword
    ? report.keyword.split(/[,，\s]+/).filter(Boolean)
    : [];

  const formattedDate = report.date
    ? new Date(report.date).toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  const handleDownload = () => {
    if (!hasSubscription) {
      onSubscribeClick();
      return;
    }
    window.open(report.link, "_blank", "noopener,noreferrer");
  };

  return (
    <article className="bg-white rounded-xl border border-slate-200 px-5 py-4 hover:shadow-md transition-all flex gap-5 items-center">
      {/* 왼쪽: 증권사 + 날짜 */}
      <div className="shrink-0 w-32">
        <span className="block text-xs font-semibold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-md mb-1.5 truncate">
          {report.securities_firm}
        </span>
        <span className="text-xs text-slate-400">{formattedDate}</span>
        {report.file_size && (
          <span className="block text-xs text-slate-400 mt-0.5">{report.file_size}</span>
        )}
      </div>

      {/* 가운데: 제목 + 한줄요약 */}
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-slate-800 mb-1.5 leading-snug">
          {report.title}
        </h3>
        {report.one_line_summary && (
          <p className="text-sm text-slate-500 leading-relaxed line-clamp-2">
            💡 {report.one_line_summary}
          </p>
        )}
        {keywords.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {keywords.slice(0, 4).map((kw) => (
              <KeywordBadge key={kw} keyword={kw} />
            ))}
          </div>
        )}
      </div>

      {/* 오른쪽: 다운로드 버튼 */}
      <div className="shrink-0">
        <button
          onClick={handleDownload}
          className={`flex items-center gap-2 py-2 px-4 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
            hasSubscription
              ? "bg-blue-600 hover:bg-blue-700 text-white"
              : "bg-slate-100 hover:bg-slate-200 text-slate-500 border border-slate-200"
          }`}
        >
          {hasSubscription ? (
            <><span>📄</span><span>다운로드</span></>
          ) : (
            <><span>🔒</span><span>구독 후 다운로드</span></>
          )}
        </button>
      </div>
    </article>
  );
}
