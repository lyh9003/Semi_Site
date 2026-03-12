import type { TelegramMessage } from "@/lib/types";

interface TelegramCardProps {
  msg: TelegramMessage;
}

const SENTIMENT_CONFIG = {
  "긍정": { label: "긍정", className: "bg-emerald-50 text-emerald-600 border border-emerald-200" },
  "긍정적": { label: "긍정", className: "bg-emerald-50 text-emerald-600 border border-emerald-200" },
  "부정": { label: "부정", className: "bg-red-50 text-red-500 border border-red-200" },
  "부정적": { label: "부정", className: "bg-red-50 text-red-500 border border-red-200" },
  "중립": { label: "중립", className: "bg-slate-100 text-slate-400 border border-slate-200" },
  "중립적": { label: "중립", className: "bg-slate-100 text-slate-400 border border-slate-200" },
  "positive": { label: "긍정", className: "bg-emerald-50 text-emerald-600 border border-emerald-200" },
  "negative": { label: "부정", className: "bg-red-50 text-red-500 border border-red-200" },
  "neutral":  { label: "중립", className: "bg-slate-100 text-slate-400 border border-slate-200" },
} as const;

export default function TelegramCard({ msg }: TelegramCardProps) {
  const keywords = msg.keywords
    ? msg.keywords.split(/[,，\s]+/).filter(Boolean)
    : [];

  const formattedDate = msg.date_local
    ? msg.date_local.slice(0, 10)
    : msg.date_utc
    ? new Date(msg.date_utc).toLocaleDateString("ko-KR")
    : "";

  const sentimentKey = msg.sentiment as keyof typeof SENTIMENT_CONFIG;
  const sent = SENTIMENT_CONFIG[sentimentKey] ?? SENTIMENT_CONFIG["중립"];

  return (
    <article className="bg-white rounded-xl border border-slate-200 px-4 py-4 hover:shadow-md hover:border-blue-200 transition-all">
      {/* 상단: 감성 + 채널 + 날짜 */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${sent.className}`}>
          {sent.label}
        </span>
        {msg.channel && (
          <span className="text-xs font-semibold text-violet-600 bg-violet-50 px-2 py-0.5 rounded-md truncate max-w-[10rem]">
            {msg.channel}
          </span>
        )}
        <span className="text-xs text-slate-400">{formattedDate}</span>
      </div>

      {/* 요약 */}
      {msg.summary && (
        <div className="text-sm text-slate-700 leading-relaxed mb-2 font-medium">
          {msg.summary
            .split(/(?=\d+[.)]\s)/)
            .map((line, i) => line.trim())
            .filter(Boolean)
            .map((line, i) => (
              <p key={i} className={i > 0 ? "mt-1" : ""}>{line}</p>
            ))}
        </div>
      )}

      {/* 원문 (접기) */}
      <details className="mb-3">
        <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600 select-none">
          원문 보기
        </summary>
        <p className="mt-2 text-xs text-slate-500 leading-relaxed whitespace-pre-wrap border-l-2 border-slate-200 pl-3">
          {msg.message}
        </p>
      </details>

      {/* 키워드 */}
      {keywords.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {keywords.slice(0, 4).map((kw) => (
            <span key={kw} className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
              {kw}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
