"use client";

import type { StockReport } from "@/lib/types";
import KeywordBadge from "./KeywordBadge";

interface ReportCardProps {
  report: StockReport;
}

function formatFileSize(size: string) {
  return size.replace(/(\d+)/g, (n) => Number(n).toLocaleString());
}

export default function ReportCard({ report }: ReportCardProps) {
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

  return (
    <article className="bg-white rounded-xl border border-slate-200 px-5 py-5 hover:shadow-md transition-all">
      <span className="text-xs text-slate-400 mb-2 block">{formattedDate}</span>

      <h3 className="font-semibold text-slate-800 mb-2 leading-snug text-sm sm:text-base">
        {report.title}
      </h3>
      {report.one_line_summary && (
        <p className="text-xs sm:text-sm text-slate-600 leading-relaxed mb-2 font-medium">
          💡 {report.one_line_summary}
        </p>
      )}
      {report.summary && (
        <p className="text-xs sm:text-sm text-slate-500 leading-relaxed whitespace-pre-line mb-3">
          {report.summary}
        </p>
      )}
      {keywords.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-4">
          {keywords.slice(0, 3).map((kw) => (
            <KeywordBadge key={kw} keyword={kw} />
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <a
          href={report.link}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors shrink-0"
        >
          <span>📄</span><span>다운로드</span>
        </a>
        {report.securities_firm && (
          <span className="text-xs font-semibold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-md">
            {report.securities_firm}
          </span>
        )}
        {report.file_size && (
          <span className="text-xs text-slate-400">{formatFileSize(report.file_size)}</span>
        )}
      </div>
    </article>
  );
}
