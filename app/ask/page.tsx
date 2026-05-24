"use client";

import { useRef, useState } from "react";

interface NewsDoc  { id:number; title:string; company:string; date:string; summary:string; link:string }
interface ReportDoc{ id:number; title:string; securities_firm:string; date:string; one_line_summary:string; link:string }
interface TeleDoc  { id:number; channel:string; summary:string; date_utc:string; sentiment:string }

interface Sources {
  news: NewsDoc[];
  reports: ReportDoc[];
  telegrams: TeleDoc[];
  isRecent?: boolean;
  searchErrors?: string[];
}

const EXAMPLES = [
  "HBM 시장 현황은 어때?",
  "삼성전자 반도체 최근 동향은?",
  "엔비디아 데이터센터 수요 전망은?",
  "NAND 가격 흐름이 어떻게 되고 있어?",
];

export default function AskPage() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<Sources | null>(null);
  const [loading, setLoading] = useState(false);
  const [asked, setAsked] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submit = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || loading) return;

    setAsked(trimmed);
    setAnswer("");
    setSources(null);
    setLoading(true);
    setQuestion("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      if (!res.ok || !res.body) throw new Error("요청 실패");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.type === "sources") {
              setSources({ news: obj.news, reports: obj.reports, telegrams: obj.telegrams, isRecent: obj.isRecent, searchErrors: obj.searchErrors });
            } else if (obj.type === "text") {
              setAnswer(prev => prev + obj.data);
            } else if (obj.type === "error") {
              setAnswer(`오류: ${obj.message}`);
            }
          } catch {}
        }
      }
    } catch (e) {
      setAnswer(`오류: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const totalSources = (sources?.news.length ?? 0) + (sources?.reports.length ?? 0) + (sources?.telegrams.length ?? 0);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 flex flex-col gap-6" style={{ minHeight: "calc(100vh - 64px)" }}>

      {/* 헤더 */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">🤖 반도체 시황 Q&A</h1>
        <p className="text-sm text-slate-500 mt-1">
          최신 뉴스·증권리포트·텔레그램을 기반으로 AI가 답변합니다
        </p>
      </div>

      {/* 답변 영역 */}
      {(answer || loading) && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* 질문 */}
          <div className="bg-slate-50 px-5 py-3 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-700">Q. {asked}</p>
          </div>

          {/* AI 답변 */}
          <div className="px-5 py-4">
            {loading && !answer && (
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <span className="animate-spin inline-block">⚙️</span> 자료 검색 및 답변 생성 중...
              </div>
            )}
            {answer && (
              <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
                {answer}
                {loading && <span className="animate-pulse">▌</span>}
              </p>
            )}
          </div>

          {/* 참고 자료 */}
          {sources && totalSources > 0 && (
            <div className="border-t border-slate-100 px-5 py-4">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  참고 자료 {totalSources}건
                </p>
                {sources.isRecent !== undefined && (
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${sources.isRecent ? "bg-orange-100 text-orange-600" : "bg-slate-100 text-slate-500"}`}>
                    {sources.isRecent ? "📅 최근 14일" : "🔍 전체 시맨틱"}
                  </span>
                )}
                {sources.searchErrors && sources.searchErrors.length > 0 && (
                  <span className="text-[10px] text-red-500 font-mono break-all">
                    ⚠️ {sources.searchErrors.join(" | ")}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-2">
                {sources.news.map(n => (
                  <a key={`n-${n.id}`} href={n.link} target="_blank" rel="noopener noreferrer"
                    className="flex items-start gap-2 group">
                    <span className="flex-shrink-0 text-[10px] font-semibold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded mt-0.5">뉴스</span>
                    <div className="min-w-0">
                      <p className="text-xs text-slate-700 group-hover:text-blue-600 group-hover:underline line-clamp-1">{n.title}</p>
                      <p className="text-[10px] text-slate-400">{n.company} · {n.date}</p>
                    </div>
                  </a>
                ))}
                {sources.reports.map(r => (
                  <a key={`r-${r.id}`} href={r.link} target="_blank" rel="noopener noreferrer"
                    className="flex items-start gap-2 group">
                    <span className="flex-shrink-0 text-[10px] font-semibold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded mt-0.5">리포트</span>
                    <div className="min-w-0">
                      <p className="text-xs text-slate-700 group-hover:text-blue-600 group-hover:underline line-clamp-1">{r.title}</p>
                      <p className="text-[10px] text-slate-400">{r.securities_firm} · {r.date}</p>
                    </div>
                  </a>
                ))}
                {sources.telegrams.map(t => (
                  <div key={`t-${t.id}`} className="flex items-start gap-2">
                    <span className="flex-shrink-0 text-[10px] font-semibold bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded mt-0.5">텔레그램</span>
                    <div className="min-w-0">
                      <p className="text-xs text-slate-700 line-clamp-1">{t.summary}</p>
                      <p className="text-[10px] text-slate-400">{t.channel} · {t.date_utc?.slice(0,10)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 예시 질문 (첫 화면) */}
      {!answer && !loading && (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 py-8">
          <div className="text-center">
            <p className="text-4xl mb-3">💬</p>
            <p className="text-slate-500 text-sm">반도체 시황에 대해 무엇이든 물어보세요</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
            {EXAMPLES.map(ex => (
              <button key={ex} onClick={() => submit(ex)}
                className="text-left text-sm px-4 py-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-600 transition-colors">
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 입력창 */}
      <div className="sticky bottom-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-lg flex items-end gap-2 px-4 py-3">
          <textarea
            ref={textareaRef}
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(question);
              }
            }}
            placeholder="반도체 시황을 질문하세요... (Enter로 전송)"
            rows={1}
            className="flex-1 resize-none text-sm text-slate-800 placeholder-slate-400 outline-none bg-transparent leading-relaxed"
            style={{ maxHeight: "120px" }}
          />
          <button
            onClick={() => submit(question)}
            disabled={!question.trim() || loading}
            className="flex-shrink-0 bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            전송
          </button>
        </div>
        <p className="text-center text-[10px] text-slate-300 mt-1.5">
          최신 뉴스·리포트·텔레그램 기반 · AI 답변은 참고용입니다
        </p>
      </div>
    </div>
  );
}
