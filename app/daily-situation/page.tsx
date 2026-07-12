"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL?.trim();

interface Entry {
  date: string;
  title: string;
  weather_emoji: string;
  weather_label: string;
}
interface EntryDetail extends Entry {
  content: string;
}

// ── 날짜 헬퍼 ─────────────────────────────────────────────────────────────────
const DAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

function toKST(dateStr: string) {
  return new Date(dateStr + "T00:00:00+09:00");
}

function isoWeekStart(d: Date): Date {
  const day = d.getDay(); // 0=일
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(d);
  m.setDate(d.getDate() + diff);
  m.setHours(0, 0, 0, 0);
  return m;
}

interface WeekGroup { label: string; weekStart: Date; days: Date[] }
interface MonthGroup { year: number; month: number; label: string; weeks: WeekGroup[] }

function buildTree(entryDates: Set<string>): MonthGroup[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const groups: MonthGroup[] = [];

  // 3개월 전 ~ 다음달 말까지
  for (let mo = -3; mo <= 1; mo++) {
    const year  = today.getFullYear() + Math.floor((today.getMonth() + mo) / 12);
    const month = ((today.getMonth() + mo) % 12 + 12) % 12;
    const monthStart = new Date(year, month, 1);
    const monthEnd   = new Date(year, month + 1, 0);

    const weeks: WeekGroup[] = [];
    let ws = isoWeekStart(monthStart);

    while (ws <= monthEnd) {
      const days: Date[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(ws);
        d.setDate(ws.getDate() + i);
        days.push(d);
      }
      const firstInMonth = days.find(d => d.getMonth() === month)!;
      const lastInMonth  = [...days].reverse().find(d => d.getMonth() === month)!;
      const label = `${firstInMonth.getDate()}/${(firstInMonth.getMonth()+1).toString().padStart(2,"0")}(${DAY_KO[firstInMonth.getDay()]}) ~ ${lastInMonth.getDate()}/${(lastInMonth.getMonth()+1).toString().padStart(2,"0")}(${DAY_KO[lastInMonth.getDay()]})`;
      weeks.push({ label, weekStart: ws, days });
      ws = new Date(ws);
      ws.setDate(ws.getDate() + 7);
    }

    if (weeks.some(w => w.days.some(d => entryDates.has(fmtDate(d)) || d <= today))) {
      groups.push({ year, month, label: `${year}년 ${month + 1}월`, weeks });
    }
  }

  return groups.reverse(); // 최신 달이 위
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

// ── 에디터 ──────────────────────────────────────────────────────────────────
const FONT_SIZES = ["12","14","16","18","20","24","28","32"];
const COLORS = [
  { label:"빨강", value:"#e53e3e" }, { label:"주황", value:"#dd6b20" },
  { label:"초록", value:"#38a169" }, { label:"파랑", value:"#3182ce" },
  { label:"회색", value:"#718096" },
];

function autoLink(html: string) {
  return html.replace(/(?<!href=["'])(?<!src=["'])(https?:\/\/[^\s<"']+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#3182ce;text-decoration:underline">$1</a>');
}

const CONTENT_CLS = `
  text-slate-700 text-[15px] leading-7 break-words
  [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-slate-900 [&_h2]:mt-6 [&_h2]:mb-2
  [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-slate-800 [&_h3]:mt-4 [&_h3]:mb-1
  [&_blockquote]:border-l-4 [&_blockquote]:border-blue-300 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-slate-600
  [&_a]:text-blue-600 [&_a]:underline
  [&_img]:max-w-full [&_img]:rounded-lg [&_img]:my-1
  [&_hr]:border-none [&_hr]:border-t [&_hr]:border-slate-200 [&_hr]:my-3
  [&_strong]:font-semibold
`;

function Editor({ detail, isAdmin, onSaved }: {
  detail: EntryDetail;
  isAdmin: boolean;
  onSaved: (content: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const colorRef  = useRef<HTMLInputElement>(null);
  const imgRef    = useRef<HTMLInputElement>(null);
  const timer     = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = detail.content || "";
  }, [detail.date]);

  const save = useCallback(() => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    fetch(`/api/daily-situation/${detail.date}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: html }),
    });
    onSaved(html);
  }, [detail.date, onSaved]);

  const sched = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, 800);
  }, [save]);

  const exec = (cmd: string, val?: string) => document.execCommand(cmd, false, val);

  const applySize = (size: string) => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const span = document.createElement("span");
    span.style.fontSize = `${size}px`;
    if (!range.collapsed) { span.appendChild(range.extractContents()); range.insertNode(span); }
    else { span.innerHTML = "​"; range.insertNode(span); }
    sched();
  };

  const uploadImg = async (file: File) => {
    const fd = new FormData(); fd.append("file", file);
    const r = await fetch("/api/board/upload", { method: "POST", body: fd });
    if (!r.ok) return;
    const { url } = await r.json();
    editorRef.current?.focus();
    exec("insertHTML", `<img src="${url}" style="max-width:100%;border-radius:8px;margin:4px 0;display:block;" />`);
    sched();
  };

  return (
    <div className="flex flex-col min-h-full">
      {isAdmin && (
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200">
          <div className="flex flex-wrap items-center gap-1 px-3 py-1.5">
            {[["B","bold","font-bold"],["I","italic","italic"],["U","underline","underline"]].map(([l,c,cls]) => (
              <button key={c} type="button" onMouseDown={e => { e.preventDefault(); exec(c); }}
                className={`w-7 h-7 flex items-center justify-center rounded text-slate-600 hover:bg-slate-100 text-sm ${cls}`}>{l}</button>
            ))}
            <div className="w-px h-4 bg-slate-200 mx-0.5" />
            {[["H2","h2"],["H3","h3"]].map(([l,t]) => (
              <button key={t} type="button" onMouseDown={e => { e.preventDefault(); exec("formatBlock", t); }}
                className="px-2 h-7 flex items-center justify-center rounded text-slate-600 hover:bg-slate-100 text-xs font-bold">{l}</button>
            ))}
            <button type="button" onMouseDown={e => { e.preventDefault(); exec("formatBlock","p"); }}
              className="px-2 h-7 flex items-center justify-center rounded text-slate-500 hover:bg-slate-100 text-xs">P</button>
            <div className="w-px h-4 bg-slate-200 mx-0.5" />
            <select className="h-7 px-1 text-xs border border-slate-200 rounded bg-white text-slate-600"
              defaultValue="" onChange={e => { const v = e.target.value; e.target.value = ""; if (v) applySize(v); }}>
              <option value="">크기</option>
              {FONT_SIZES.map(s => <option key={s} value={s}>{s}px</option>)}
            </select>
            <select className="h-7 px-1 text-xs border border-slate-200 rounded bg-white text-slate-600"
              defaultValue="" onChange={e => { const v = e.target.value; e.target.value = ""; if (v) exec("foreColor", v); }}>
              <option value="">색상</option>
              {COLORS.map(c => <option key={c.value} value={c.value} style={{ color: c.value }}>{c.label}</option>)}
            </select>
            <button type="button" onMouseDown={e => { e.preventDefault(); colorRef.current?.click(); }}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-sm">🎨</button>
            <input ref={colorRef} type="color" className="absolute opacity-0 w-0 h-0"
              onChange={e => exec("foreColor", e.target.value)} />
            <div className="w-px h-4 bg-slate-200 mx-0.5" />
            <button type="button" onMouseDown={e => { e.preventDefault(); imgRef.current?.click(); }}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-sm">🖼</button>
            <input ref={imgRef} type="file" accept="image/*" className="hidden"
              onChange={async e => { const f = e.target.files?.[0]; if (f) await uploadImg(f); e.target.value = ""; }} />
            <button type="button" onMouseDown={e => { e.preventDefault(); exec("insertHTML", "<hr style='border:none;border-top:1px solid #e2e8f0;margin:12px 0;' />"); sched(); }}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-sm font-bold text-slate-600">—</button>
          </div>
        </div>
      )}
      <div className="flex-1 px-10 py-8">
        {isAdmin ? (
          <div ref={editorRef} contentEditable suppressContentEditableWarning
            onInput={sched} onBlur={() => { if (timer.current) clearTimeout(timer.current); save(); }}
            data-placeholder="내용을 입력하세요..."
            className={`outline-none min-h-[60vh] ${CONTENT_CLS} empty:before:content-[attr(data-placeholder)] empty:before:text-slate-300 empty:before:pointer-events-none`}
          />
        ) : (
          <div className={CONTENT_CLS} dangerouslySetInnerHTML={{ __html: autoLink(detail.content || "") }} />
        )}
      </div>
    </div>
  );
}

// ── 사이드바 ────────────────────────────────────────────────────────────────
function Sidebar({ entries, selectedDate, onSelect, sidebarOpen, onToggle, onWeekly, isWeeklySelected }: {
  entries: Entry[];
  selectedDate: string | null;
  onSelect: (date: string) => void;
  sidebarOpen: boolean;
  onToggle: () => void;
  onWeekly: () => void;
  isWeeklySelected: boolean;
}) {
  const entrySet = new Set(entries.map(e => e.date));
  const entryMap = new Map(entries.map(e => [e.date, e]));
  const today = fmtDate(new Date());
  const tree = buildTree(entrySet);

  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(() => {
    const now = new Date();
    return new Set([`${now.getFullYear()}-${now.getMonth()}`]);
  });
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(() => {
    const ws = isoWeekStart(new Date());
    return new Set([fmtDate(ws)]);
  });

  // 선택된 날짜의 월/주 자동 열기
  useEffect(() => {
    if (!selectedDate) return;
    const d = toKST(selectedDate);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const ws = isoWeekStart(d);
    setExpandedMonths(p => new Set([...p, key]));
    setExpandedWeeks(p => new Set([...p, fmtDate(ws)]));
  }, [selectedDate]);

  const toggleMonth = (key: string) =>
    setExpandedMonths(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleWeek = (key: string) =>
    setExpandedWeeks(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; });

  return (
    <>
      {sidebarOpen && <div className="fixed inset-0 bg-black/30 z-20 md:hidden" onClick={onToggle} />}
      <aside className={`
        fixed md:sticky top-[105px] md:top-[64px] left-0 z-30
        h-[calc(100vh-105px)] md:h-[calc(100vh-64px)]
        w-60 bg-[#f7f7f5] border-r border-slate-200 flex flex-col overflow-hidden transition-transform duration-200
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
      `}>
        <div className="px-3 py-3 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">일자별 시황</span>
          <button type="button" onClick={onToggle} className="md:hidden w-6 h-6 flex items-center justify-center rounded text-slate-400 hover:bg-slate-200 text-sm">✕</button>
        </div>

        {/* 최근 시황 버튼 */}
        <button
          type="button"
          onClick={onWeekly}
          className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm font-semibold border-b border-slate-200 transition-colors ${
            isWeeklySelected
              ? "bg-blue-50 text-blue-700"
              : "text-slate-700 hover:bg-slate-100"
          }`}
        >
          <span>📊</span>
          <span>최근 시황</span>
          <span className="ml-auto text-[10px] text-slate-400 font-normal">최근 7일</span>
        </button>

        <nav className="flex-1 overflow-y-auto py-2">
          {tree.map(mg => {
            const mkey = `${mg.year}-${mg.month}`;
            const isMonthOpen = expandedMonths.has(mkey);
            const monthHasEntry = mg.weeks.some(w => w.days.some(d => entrySet.has(fmtDate(d))));

            return (
              <div key={mkey}>
                {/* 월 헤더 */}
                <button type="button" onClick={() => toggleMonth(mkey)}
                  className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200/60 transition-colors">
                  <span className={`text-[10px] transition-transform ${isMonthOpen ? "rotate-90" : ""}`}>▶</span>
                  <span>📅 {mg.label}</span>
                  {monthHasEntry && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-500" />}
                </button>

                {isMonthOpen && mg.weeks.map((wg, wi) => {
                  const wkey = fmtDate(wg.weekStart);
                  const isWeekOpen = expandedWeeks.has(wkey);
                  const weekHasEntry = wg.days.some(d => entrySet.has(fmtDate(d)));
                  const weekInMonth = wg.days.some(d => d.getMonth() === mg.month);
                  if (!weekInMonth) return null;

                  return (
                    <div key={wkey}>
                      {/* 주 헤더 */}
                      <button type="button" onClick={() => toggleWeek(wkey)}
                        className="w-full flex items-center gap-1.5 pl-6 pr-3 py-1 text-[11px] text-slate-500 hover:bg-slate-200/40 transition-colors">
                        <span className={`text-[9px] transition-transform ${isWeekOpen ? "rotate-90" : ""}`}>▶</span>
                        <span>{wi + 1}주 · {wg.label}</span>
                        {weekHasEntry && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-400" />}
                      </button>

                      {isWeekOpen && wg.days.map(d => {
                        const ds = fmtDate(d);
                        const hasEntry = entrySet.has(ds);
                        const isToday = ds === today;
                        const isSelected = ds === selectedDate;
                        const isOtherMonth = d.getMonth() !== mg.month;
                        const entry = entryMap.get(ds);

                        return (
                          <button key={ds} type="button"
                            onClick={() => hasEntry && onSelect(ds)}
                            disabled={!hasEntry}
                            className={`w-full flex items-center gap-2 pl-10 pr-3 py-1 text-xs transition-colors ${
                              isSelected
                                ? "bg-white shadow-sm text-slate-900 font-semibold"
                                : hasEntry
                                  ? "text-slate-700 hover:bg-slate-200/60 cursor-pointer"
                                  : isOtherMonth
                                    ? "text-slate-300 cursor-default"
                                    : "text-slate-400 cursor-default"
                            }`}>
                            <span className={`w-6 flex-shrink-0 text-center font-medium ${isToday ? "text-blue-600" : ""}`}>
                              {DAY_KO[d.getDay()]}
                            </span>
                            <span className={isToday ? "text-blue-600 font-semibold" : ""}>
                              {d.getMonth()+1}/{d.getDate()}
                            </span>
                            {isToday && <span className="text-[9px] text-blue-500 font-bold">오늘</span>}
                            {entry && (
                              <span className="ml-auto text-[10px]">{entry.weather_emoji}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

// ── 주간 요약 뷰 ──────────────────────────────────────────────────────────────
function WeeklySummaryView() {
  const [content, setContent]     = useState<string | null>(null);
  const [dateFrom, setDateFrom]   = useState("");
  const [dateTo, setDateTo]       = useState("");
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (regenerate = false) => {
    const url = regenerate ? "/api/weekly-summary?regenerate=1" : "/api/weekly-summary";
    const res = await fetch(url, regenerate ? { cache: "no-store" } : undefined);
    if (!res.ok) throw new Error();
    const data = await res.json();
    setContent(data.content ?? null);
    setDateFrom(data.dateFrom ?? "");
    setDateTo(data.dateTo ?? "");
  };

  useEffect(() => {
    load().catch(() => setContent(null)).finally(() => setLoading(false));
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await load(true); } catch { /* ignore */ }
    finally { setRefreshing(false); }
  };

  const CONTENT_CLS_WEEKLY = `
    text-slate-700 text-[15px] leading-7 break-words
    [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-slate-900 [&_h2]:mt-6 [&_h2]:mb-2
    [&_strong]:font-semibold [&_a]:text-blue-600 [&_a]:underline
  `;

  return (
    <div className="flex flex-col min-h-full">
      <div className="px-10 pt-10 pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">최근 시황</h1>
          {dateFrom && dateTo && (
            <p className="text-sm text-slate-400 mt-1">{dateFrom} ~ {dateTo} · 7일 주간 요약</p>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-600 rounded-lg transition-colors font-medium"
        >
          {refreshing ? <span className="animate-spin inline-block text-xs">⚙️</span> : "↻"} 새로고침
        </button>
      </div>
      <div className="px-10 pb-10">
        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm py-10">
            <span className="animate-spin inline-block">⚙️</span> 주간 요약을 불러오는 중...
          </div>
        ) : content ? (
          <div className={CONTENT_CLS_WEEKLY} dangerouslySetInnerHTML={{ __html: content }} />
        ) : (
          <p className="text-slate-400 text-sm py-10">아직 주간 요약이 없습니다. 새로고침을 눌러 생성하세요.</p>
        )}
      </div>
    </div>
  );
}

// ── 메인 페이지 ────────────────────────────────────────────────────────────────
export default function DailySituationPage() {
  const supabase = createClient();
  const [isAdmin, setIsAdmin] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showWeekly, setShowWeekly] = useState(false);
  const [detail, setDetail] = useState<EntryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) =>
      setIsAdmin(data.user?.email?.trim() === ADMIN_EMAIL)
    );
    fetch("/api/daily-situation")
      .then(r => r.json())
      .then(({ data }) => {
        const list: Entry[] = data ?? [];
        setEntries(list);
        // 오늘 또는 가장 최신 날짜 자동 선택
        const today = fmtDate(new Date());
        const target = list.find(e => e.date === today) ?? list[0];
        if (target) setSelectedDate(target.date);
      });
  }, []);

  useEffect(() => {
    if (!selectedDate) return;
    setDetailLoading(true);
    setDetail(null);
    fetch(`/api/daily-situation/${selectedDate}`)
      .then(r => r.ok ? r.json() : null)
      .then(res => {
        setDetail(res?.data ?? null);
        setDetailLoading(false);
      });
  }, [selectedDate]);

  const handleSaved = useCallback((content: string) => {
    setDetail(prev => prev ? { ...prev, content } : prev);
  }, []);

  return (
    <div className="flex h-[calc(100vh-105px)] md:h-[calc(100vh-64px)]">
      <button type="button" onClick={() => setSidebarOpen(true)}
        className="fixed bottom-4 left-4 z-20 md:hidden w-10 h-10 bg-white border border-slate-200 rounded-full shadow-md flex items-center justify-center text-slate-600">
        ☰
      </button>

      <Sidebar
        entries={entries}
        selectedDate={showWeekly ? null : selectedDate}
        onSelect={date => { setShowWeekly(false); setSelectedDate(date); setSidebarOpen(false); }}
        sidebarOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(v => !v)}
        onWeekly={() => { setShowWeekly(true); setSidebarOpen(false); }}
        isWeeklySelected={showWeekly}
      />

      <div className="flex-1 overflow-auto min-w-0">
        {showWeekly ? (
          <WeeklySummaryView />
        ) : detailLoading ? (
          <div className="flex items-center justify-center h-full text-slate-400">
            <div className="text-center">
              <div className="text-3xl mb-2 animate-spin inline-block">⚙️</div>
              <p className="text-sm">불러오는 중...</p>
            </div>
          </div>
        ) : detail ? (
          <div className="flex flex-col min-h-full">
            <div className="px-10 pt-10 pb-4">
              <div className="flex items-center gap-3 mb-1">
                <span className="text-3xl">{detail.weather_emoji}</span>
                <span className="text-xs font-semibold px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full">
                  {detail.weather_label}
                </span>
              </div>
              <h1 className="text-3xl font-bold text-slate-900">{detail.title}</h1>
            </div>
            <Editor key={detail.date} detail={detail} isAdmin={isAdmin} onSaved={handleSaved} />
          </div>
        ) : selectedDate ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
            <p className="text-4xl">📭</p>
            <p className="text-sm font-medium text-slate-500">{selectedDate} 시황이 아직 없습니다</p>
            <p className="text-xs text-slate-400">매일 KST 23:00에 자동 생성됩니다</p>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-slate-400">
            <p className="text-sm">왼쪽에서 날짜를 선택하세요</p>
          </div>
        )}
      </div>
    </div>
  );
}
