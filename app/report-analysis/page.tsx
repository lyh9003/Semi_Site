"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL?.trim();

type BlockType = "text" | "h1" | "h2" | "h3" | "image" | "divider" | "quote";

interface Page { id: number; title: string; icon: string; order_index: number; parent_id: number | null; }
interface Block { id: number; type: BlockType; content: string; order_index: number; page_id: number; }

const TYPE_LABELS: Record<BlockType, { label: string; icon: string }> = {
  text:    { label: "텍스트",  icon: "¶" },
  h1:      { label: "제목 1",  icon: "H1" },
  h2:      { label: "제목 2",  icon: "H2" },
  h3:      { label: "제목 3",  icon: "H3" },
  image:   { label: "이미지",  icon: "🖼" },
  divider: { label: "구분선",  icon: "—" },
  quote:   { label: "인용",    icon: "❝" },
};

const FONT_SIZES = ["12", "14", "16", "18", "20", "24", "28", "32"];
const COLORS = [
  { label: "빨강", value: "#e53e3e" }, { label: "주황", value: "#dd6b20" },
  { label: "초록", value: "#38a169" }, { label: "파랑", value: "#3182ce" },
  { label: "회색", value: "#718096" },
];
const PAGE_ICONS = ["📄", "📝", "📊", "📈", "💡", "🔍", "📌", "⭐", "🗂", "📋"];

function autoLink(html: string) {
  return html.replace(/(?<!href=["'])(https?:\/\/[^\s<"']+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#3182ce;text-decoration:underline">$1</a>');
}

// ── 포맷 툴바 ─────────────────────────────────────────────
function FormatBar() {
  const colorRef = useRef<HTMLInputElement>(null);
  function exec(cmd: string, val?: string) { document.execCommand(cmd, false, val); }

  const applySize = (size: string) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const span = document.createElement("span");
    span.style.fontSize = `${size}px`;
    if (!range.collapsed) {
      span.appendChild(range.extractContents());
      range.insertNode(span);
    } else {
      span.innerHTML = "\u200B";
      range.insertNode(span);
      const r = document.createRange();
      r.setStart(span.firstChild!, 1); r.collapse(true);
      sel.removeAllRanges(); sel.addRange(r);
    }
  };

  const insertLink = () => {
    const url = window.prompt("링크 URL", "https://");
    if (!url) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) {
      exec("createLink", url);
      document.querySelectorAll(`a[href="${url}"]`).forEach((a) => {
        (a as HTMLAnchorElement).target = "_blank";
        (a as HTMLAnchorElement).rel = "noopener noreferrer";
        (a as HTMLAnchorElement).style.cssText = "color:#3182ce;text-decoration:underline";
      });
    } else {
      const text = window.prompt("표시 텍스트", url) || url;
      exec("insertHTML", `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:#3182ce;text-decoration:underline">${text}</a>`);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1 px-3 py-1.5 bg-white border-b border-slate-200">
      {[["B","bold","font-bold"],["I","italic","italic"],["U","underline","underline"]].map(([label, cmd, cls]) => (
        <button key={cmd} type="button"
          onMouseDown={(e) => { e.preventDefault(); exec(cmd); }}
          className={`w-7 h-7 flex items-center justify-center rounded text-slate-600 hover:bg-slate-100 text-sm ${cls}`}>
          {label}
        </button>
      ))}
      <div className="w-px h-4 bg-slate-200 mx-0.5" />
      <select className="h-7 px-1 text-xs border border-slate-200 rounded bg-white text-slate-600 cursor-pointer"
        defaultValue="" onChange={(e) => { const v = e.target.value; e.target.value = ""; if (v) applySize(v); }}>
        <option value="">크기</option>
        {FONT_SIZES.map((s) => <option key={s} value={s}>{s}px</option>)}
      </select>
      <select className="h-7 px-1 text-xs border border-slate-200 rounded bg-white text-slate-600 cursor-pointer"
        defaultValue="" onChange={(e) => { const v = e.target.value; e.target.value = ""; if (v) exec("foreColor", v); }}>
        <option value="">색상</option>
        {COLORS.map((c) => <option key={c.value} value={c.value} style={{ color: c.value }}>{c.label}</option>)}
      </select>
      <button type="button" onMouseDown={(e) => { e.preventDefault(); colorRef.current?.click(); }}
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-sm">🎨</button>
      <input ref={colorRef} type="color" className="absolute opacity-0 w-0 h-0"
        onChange={(e) => exec("foreColor", e.target.value)} />
      <div className="w-px h-4 bg-slate-200 mx-0.5" />
      <button type="button" onMouseDown={(e) => { e.preventDefault(); insertLink(); }}
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-sm">🔗</button>
    </div>
  );
}

// ── 사이드바 ──────────────────────────────────────────────
function PageTreeItem({ page, pages, depth, selectedId, isAdmin, expandedIds, onToggleExpand, onSelect, onAdd, onRename, onDelete, onMove }: {
  page: Page; pages: Page[]; depth: number;
  selectedId: number | null; isAdmin: boolean;
  expandedIds: Set<number>;
  onToggleExpand: (id: number) => void;
  onSelect: (id: number) => void;
  onAdd: (parentId: number | null) => void;
  onRename: (id: number, title: string) => void;
  onDelete: (id: number) => void;
  onMove: (id: number, dir: "up" | "down") => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(page.title);
  const children = pages.filter((p) => p.parent_id === page.id).sort((a, b) => a.order_index - b.order_index);
  const hasChildren = children.length > 0;
  const isExpanded = expandedIds.has(page.id);
  const siblings = pages.filter((p) => p.parent_id === page.parent_id).sort((a, b) => a.order_index - b.order_index);
  const sibIdx = siblings.findIndex((p) => p.id === page.id);

  return (
    <div>
      <div className="relative" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}>
        {editing ? (
          <div className="flex items-center gap-1 pr-2 py-0.5">
            <span className="w-4 flex-shrink-0" />
            <span className="text-sm flex-shrink-0">{page.icon}</span>
            <input autoFocus value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={() => { onRename(page.id, editTitle); setEditing(false); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { onRename(page.id, editTitle); setEditing(false); }
                if (e.key === "Escape") { setEditTitle(page.title); setEditing(false); }
              }}
              className="flex-1 text-sm bg-white border border-blue-400 rounded px-1.5 py-0.5 outline-none min-w-0"
            />
          </div>
        ) : (
          <button type="button" onClick={() => onSelect(page.id)}
            className={`w-full flex items-center gap-1 pr-1 py-1 rounded-lg text-sm transition-colors text-left group/item ${selectedId === page.id ? "bg-white shadow-sm text-slate-900 font-medium" : "text-slate-600 hover:bg-slate-200/60"}`}>
            {/* 접기/펼치기 토글 */}
            <span className="w-4 flex-shrink-0 flex items-center justify-center"
              onClick={(e) => { e.stopPropagation(); if (hasChildren) onToggleExpand(page.id); }}>
              {hasChildren
                ? <span className={`text-slate-400 text-xs transition-transform ${isExpanded ? "rotate-90" : ""}`}>▶</span>
                : <span className="text-slate-300 text-xs opacity-0 group-hover/item:opacity-100">▶</span>}
            </span>
            <span className="text-sm flex-shrink-0">{page.icon}</span>
            <span className="flex-1 truncate">{page.title || "제목 없음"}</span>
            {isAdmin && hovered && (
              <span className="flex items-center gap-0.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                <button type="button" title="하위 페이지 추가" onClick={() => { onAdd(page.id); onToggleExpand(page.id); }}
                  className="w-4 h-4 flex items-center justify-center text-blue-400 hover:text-blue-600 text-xs font-bold">+</button>
                <button type="button" onClick={() => onMove(page.id, "up")} disabled={sibIdx === 0}
                  className="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-slate-600 disabled:opacity-20 text-xs">↑</button>
                <button type="button" onClick={() => onMove(page.id, "down")} disabled={sibIdx === siblings.length - 1}
                  className="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-slate-600 disabled:opacity-20 text-xs">↓</button>
                <button type="button" onClick={() => { setEditTitle(page.title); setEditing(true); }}
                  className="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-slate-600 text-xs">✏️</button>
                <button type="button" onClick={() => onDelete(page.id)}
                  className="w-4 h-4 flex items-center justify-center text-red-400 hover:text-red-600 text-xs">✕</button>
              </span>
            )}
          </button>
        )}
      </div>
      {/* 하위 페이지 재귀 렌더 */}
      {isExpanded && children.map((child) => (
        <PageTreeItem key={child.id} page={child} pages={pages} depth={depth + 1}
          selectedId={selectedId} isAdmin={isAdmin} expandedIds={expandedIds}
          onToggleExpand={onToggleExpand} onSelect={onSelect} onAdd={onAdd}
          onRename={onRename} onDelete={onDelete} onMove={onMove} />
      ))}
    </div>
  );
}

function Sidebar({ pages, selectedId, isAdmin, onSelect, onAdd, onRename, onDelete, onMove, sidebarOpen, onToggle }: {
  pages: Page[]; selectedId: number | null; isAdmin: boolean;
  onSelect: (id: number) => void;
  onAdd: (parentId: number | null) => void;
  onRename: (id: number, title: string) => void;
  onDelete: (id: number) => void;
  onMove: (id: number, dir: "up" | "down") => void;
  sidebarOpen: boolean;
  onToggle: () => void;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // 선택된 페이지의 모든 조상을 자동 펼치기
  useEffect(() => {
    if (!selectedId) return;
    const ancestors = new Set<number>();
    let cur = pages.find((p) => p.id === selectedId);
    while (cur?.parent_id) {
      ancestors.add(cur.parent_id);
      cur = pages.find((p) => p.id === cur!.parent_id);
    }
    if (ancestors.size) setExpandedIds((prev) => new Set([...prev, ...ancestors]));
  }, [selectedId, pages]);

  const rootPages = pages.filter((p) => !p.parent_id).sort((a, b) => a.order_index - b.order_index);

  return (
    <>
      {sidebarOpen && <div className="fixed inset-0 bg-black/30 z-20 md:hidden" onClick={onToggle} />}
      <aside className={`
        fixed md:sticky top-[105px] md:top-[64px] left-0 z-30
        h-[calc(100vh-105px)] md:h-[calc(100vh-64px)]
        w-60 bg-[#f7f7f5] border-r border-slate-200
        flex flex-col overflow-hidden transition-transform duration-200
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
      `}>
        <div className="px-3 py-3 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">레포트 분석</span>
          <button type="button" onClick={onToggle} className="md:hidden w-6 h-6 flex items-center justify-center rounded text-slate-400 hover:bg-slate-200 text-sm">✕</button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {rootPages.map((page) => (
            <PageTreeItem key={page.id} page={page} pages={pages} depth={0}
              selectedId={selectedId} isAdmin={isAdmin} expandedIds={expandedIds}
              onToggleExpand={toggleExpand} onSelect={onSelect} onAdd={onAdd}
              onRename={onRename} onDelete={onDelete} onMove={onMove} />
          ))}
          {rootPages.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-4 px-2">페이지가 없습니다</p>
          )}
        </nav>

        {isAdmin && (
          <div className="p-2 border-t border-slate-200 flex-shrink-0">
            <button type="button" onClick={() => onAdd(null)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-slate-500 hover:bg-slate-200/60 transition-colors">
              <span>+</span><span>새 페이지</span>
            </button>
          </div>
        )}
      </aside>
    </>
  );
}

// ── 슬래시 메뉴 ───────────────────────────────────────────
const SLASH_ITEMS: { type: BlockType; label: string; desc: string; icon: string }[] = [
  { type: "text",    label: "텍스트",  desc: "일반 텍스트",       icon: "¶"  },
  { type: "h1",      label: "제목 1",  desc: "대제목",            icon: "H1" },
  { type: "h2",      label: "제목 2",  desc: "중제목",            icon: "H2" },
  { type: "h3",      label: "제목 3",  desc: "소제목",            icon: "H3" },
  { type: "quote",   label: "인용",    desc: "인용 블록",         icon: "❝"  },
  { type: "image",   label: "이미지",  desc: "이미지 업로드",     icon: "🖼"  },
  { type: "divider", label: "구분선",  desc: "수평 구분선",       icon: "—"  },
];

// ── 블록 아이템 ────────────────────────────────────────────
interface BlockItemProps {
  block: Block;
  isAdmin: boolean;
  isFirst: boolean;
  isLast: boolean;
  onSave: (id: number, content: string, type?: BlockType) => void;
  onDelete: (id: number) => void;
  onMove: (id: number, dir: "up" | "down") => void;
  onEnter: (id: number, currentHtml: string) => void;
  onBackspaceEmpty: (id: number) => void;
  onImageUpload: (blockId: number, file: File) => Promise<void>;
}

function BlockItem({ block, isAdmin, isFirst, isLast, onSave, onDelete, onMove, onEnter, onBackspaceEmpty, onImageUpload }: BlockItemProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [slashMenu, setSlashMenu] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (ref.current && block.type !== "image" && block.type !== "divider") {
      if (ref.current.innerHTML !== block.content) ref.current.innerHTML = block.content;
    }
  }, [block.id]);

  const schedSave = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (ref.current) onSave(block.id, ref.current.innerHTML);
    }, 800);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // 슬래시 메뉴가 열려있을 때
    if (slashMenu) {
      if (e.key === "ArrowDown")   { e.preventDefault(); setSlashIdx((i) => Math.min(i + 1, SLASH_ITEMS.length - 1)); return; }
      if (e.key === "ArrowUp")     { e.preventDefault(); setSlashIdx((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Enter")       { e.preventDefault(); applySlashType(SLASH_ITEMS[slashIdx].type); return; }
      if (e.key === "Escape")      { setSlashMenu(false); return; }
    }
    // Enter → 새 블록
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const html = ref.current?.innerHTML ?? "";
      onEnter(block.id, html);
      return;
    }
    // Backspace on empty → 블록 삭제
    if (e.key === "Backspace") {
      const isEmpty = !ref.current?.textContent?.trim() && !ref.current?.querySelector("img");
      if (isEmpty) { e.preventDefault(); onBackspaceEmpty(block.id); }
    }
  };

  const handleInput = () => {
    schedSave();
    const text = ref.current?.textContent ?? "";
    if (text === "/") { setSlashMenu(true); setSlashIdx(0); }
    else if (!text.startsWith("/")) setSlashMenu(false);
  };

  const applySlashType = (type: BlockType) => {
    setSlashMenu(false);
    if (ref.current) ref.current.innerHTML = "";
    onSave(block.id, "", type);
    setTimeout(() => ref.current?.focus(), 10);
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData.items)
      .filter((i) => i.type.startsWith("image/")).map((i) => i.getAsFile()).filter(Boolean) as File[];
    if (imgs.length) { e.preventDefault(); for (const f of imgs) await onImageUpload(block.id, f); }
  };

  const blockClass: Record<BlockType, string> = {
    text:    "text-slate-700 text-[15px] leading-7",
    h1:      "text-3xl font-bold text-slate-900 leading-tight mt-6",
    h2:      "text-2xl font-bold text-slate-800 leading-tight mt-4",
    h3:      "text-xl font-semibold text-slate-800 leading-snug mt-3",
    quote:   "text-slate-600 italic border-l-4 border-blue-300 pl-4 text-[15px] leading-7",
    image:   "",
    divider: "",
  };

  const placeholder: Record<BlockType, string> = {
    text: "글을 입력하거나 '/'로 명령어를 입력하세요",
    h1: "제목 1", h2: "제목 2", h3: "제목 3",
    quote: "인용문 입력...", image: "", divider: "",
  };

  if (block.type === "divider") return (
    <div className="group relative py-3" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <hr className="border-slate-200" />
      {isAdmin && hovered && (
        <div className="absolute right-0 top-1/2 -translate-y-1/2 flex gap-0.5 bg-white border border-slate-200 rounded-lg px-1 py-0.5 shadow-sm">
          <button type="button" onClick={() => onMove(block.id, "up")} disabled={isFirst} className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-600 disabled:opacity-20 text-xs">↑</button>
          <button type="button" onClick={() => onMove(block.id, "down")} disabled={isLast} className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-600 disabled:opacity-20 text-xs">↓</button>
          <button type="button" onClick={() => onDelete(block.id)} className="w-5 h-5 flex items-center justify-center text-red-400 hover:text-red-600 text-xs">✕</button>
        </div>
      )}
    </div>
  );

  if (block.type === "image") return (
    <div className="group relative py-1" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {block.content
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={block.content} alt="" className="max-w-full rounded-lg" />
        : isAdmin
          ? <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-blue-300 hover:bg-blue-50 transition-colors text-slate-400">
              <span className="text-2xl mb-1">🖼</span><span className="text-sm">클릭 또는 Ctrl+V</span>
              <input type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) await onImageUpload(block.id, f); }} />
            </label>
          : null}
      {isAdmin && hovered && (
        <div className="absolute right-0 top-2 flex gap-0.5 bg-white border border-slate-200 rounded-lg px-1 py-0.5 shadow-sm">
          {block.content && <label className="px-2 text-xs text-slate-500 hover:text-slate-700 cursor-pointer flex items-center">변경<input type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) await onImageUpload(block.id, f); }} /></label>}
          <button type="button" onClick={() => onMove(block.id, "up")} disabled={isFirst} className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-600 disabled:opacity-20 text-xs">↑</button>
          <button type="button" onClick={() => onMove(block.id, "down")} disabled={isLast} className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-600 disabled:opacity-20 text-xs">↓</button>
          <button type="button" onClick={() => onDelete(block.id)} className="w-5 h-5 flex items-center justify-center text-red-400 hover:text-red-600 text-xs">✕</button>
        </div>
      )}
    </div>
  );

  return (
    <div className="group relative" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {/* 왼쪽 핸들 (관리자 hover) */}
      {isAdmin && hovered && (
        <div className="absolute -left-7 top-1 flex flex-col gap-0.5 opacity-40 hover:opacity-100">
          <button type="button" onClick={() => onMove(block.id, "up")} disabled={isFirst} className="w-5 h-4 flex items-center justify-center text-slate-400 hover:text-slate-600 disabled:opacity-20 text-xs leading-none">↑</button>
          <button type="button" onClick={() => onMove(block.id, "down")} disabled={isLast} className="w-5 h-4 flex items-center justify-center text-slate-400 hover:text-slate-600 disabled:opacity-20 text-xs leading-none">↓</button>
        </div>
      )}
      {/* 오른쪽 삭제 버튼 */}
      {isAdmin && hovered && (
        <button type="button" onClick={() => onDelete(block.id)}
          className="absolute -right-6 top-1 w-5 h-5 flex items-center justify-center text-slate-300 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
      )}

      <div
        ref={ref}
        data-block-id={block.id}
        contentEditable={isAdmin}
        suppressContentEditableWarning
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        onBlur={() => { if (saveTimer.current) clearTimeout(saveTimer.current); if (ref.current) onSave(block.id, ref.current.innerHTML); setSlashMenu(false); }}
        onPaste={handlePaste}
        data-placeholder={isAdmin ? placeholder[block.type] : undefined}
        className={`outline-none w-full min-h-[1.6em] break-words ${blockClass[block.type]} ${isAdmin ? "empty:before:content-[attr(data-placeholder)] empty:before:text-slate-300 empty:before:pointer-events-none" : ""}`}
        dangerouslySetInnerHTML={!isAdmin ? { __html: autoLink(block.content) } : undefined}
      />

      {/* 슬래시 명령어 메뉴 */}
      {slashMenu && (
        <div className="absolute left-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg p-1 z-30 w-56">
          <p className="text-xs text-slate-400 px-2 py-1">블록 타입 선택</p>
          {SLASH_ITEMS.map((item, i) => (
            <button key={item.type} type="button"
              onMouseDown={(e) => { e.preventDefault(); applySlashType(item.type); }}
              className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm text-left transition-colors ${i === slashIdx ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-50"}`}>
              <span className="w-6 text-center font-mono text-xs text-slate-500">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              <span className="text-xs text-slate-400">{item.desc}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 블록 에디터 ────────────────────────────────────────────
function BlockEditor({ pageId, isAdmin }: { pageId: number; isAdmin: boolean }) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const pendingFocus = useRef<number | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/report-blocks?page_id=${pageId}`)
      .then((r) => r.json())
      .then(({ data }) => { setBlocks(data ?? []); setLoading(false); });
  }, [pageId]);

  // 블록 focus 처리
  useEffect(() => {
    if (pendingFocus.current !== null) {
      const el = document.querySelector(`[data-block-id="${pendingFocus.current}"]`) as HTMLElement;
      el?.focus();
      // 커서를 끝으로
      const range = document.createRange();
      const sel = window.getSelection();
      if (el && sel) { range.selectNodeContents(el); range.collapse(false); sel.removeAllRanges(); sel.addRange(range); }
      pendingFocus.current = null;
    }
  });

  const handleSave = useCallback(async (id: number, content: string, type?: BlockType) => {
    if (id < 0) return; // 아직 생성 중인 임시 블록
    const body: Record<string, string> = { content };
    if (type) body.type = type;
    fetch(`/api/report-blocks/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (type) setBlocks((prev) => prev.map((b) => b.id === id ? { ...b, type, content } : b));
  }, []);

  // Enter: 현재 블록 내용 저장 + 새 블록 생성
  const handleEnter = useCallback(async (id: number, currentHtml: string) => {
    // 현재 블록 저장
    fetch(`/api/report-blocks/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: currentHtml }) });

    const tempId = -Date.now();
    const idx = blocks.findIndex((b) => b.id === id);
    const newBlock: Block = { id: tempId, type: "text", content: "", order_index: idx + 1, page_id: pageId };

    // 낙관적 업데이트
    setBlocks((prev) => { const next = [...prev]; next.splice(idx + 1, 0, newBlock); return next; });
    pendingFocus.current = tempId;

    // 서버 생성
    const res = await fetch("/api/report-blocks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "text", content: "", order_index: idx + 1, page_id: pageId }),
    });
    const { data } = await res.json();
    setBlocks((prev) => prev.map((b) => b.id === tempId ? { ...b, id: data.id } : b));
    pendingFocus.current = data.id;
  }, [blocks, pageId]);

  // Backspace on empty: 블록 삭제 후 이전 블록으로 포커스
  const handleBackspaceEmpty = useCallback(async (id: number) => {
    const idx = blocks.findIndex((b) => b.id === id);
    const prevId = idx > 0 ? blocks[idx - 1].id : null;
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    if (prevId) pendingFocus.current = prevId;
    if (id > 0) fetch(`/api/report-blocks/${id}`, { method: "DELETE" });
  }, [blocks]);

  const handleDelete = useCallback(async (id: number) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    if (id > 0) fetch(`/api/report-blocks/${id}`, { method: "DELETE" });
  }, []);

  const handleMove = useCallback(async (id: number, dir: "up" | "down") => {
    const idx = blocks.findIndex((b) => b.id === id);
    if (dir === "up" && idx === 0) return;
    if (dir === "down" && idx === blocks.length - 1) return;
    const next = [...blocks];
    const si = dir === "up" ? idx - 1 : idx + 1;
    [next[idx], next[si]] = [next[si], next[idx]];
    setBlocks(next);
    fetch("/api/report-blocks/reorder", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: next.map((b) => b.id) }) });
  }, [blocks]);

  const handleImageUpload = useCallback(async (blockId: number, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/board/upload", { method: "POST", body: formData });
    if (!res.ok) return;
    const { url } = await res.json();
    const block = blocks.find((b) => b.id === blockId);
    if (block?.type === "image") {
      fetch(`/api/report-blocks/${blockId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: url }) });
      setBlocks((prev) => prev.map((b) => b.id === blockId ? { ...b, content: url } : b));
    } else {
      const img = document.createElement("img");
      img.src = url; img.style.cssText = "max-width:100%;border-radius:8px;margin:4px 0;display:block;";
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.insertNode(img); range.setStartAfter(img); range.collapse(true);
        sel.removeAllRanges(); sel.addRange(range);
      }
    }
  }, [blocks]);

  if (loading) return (
    <div className="flex justify-center py-10">
      <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="pl-8 pr-8">
      {blocks.length === 0 && !isAdmin && <p className="text-slate-400 text-sm py-4">작성된 내용이 없습니다.</p>}

      <div className="space-y-0.5">
        {blocks.map((block, idx) => (
          <BlockItem key={block.id} block={block} isAdmin={isAdmin}
            isFirst={idx === 0} isLast={idx === blocks.length - 1}
            onSave={handleSave} onDelete={handleDelete} onMove={handleMove}
            onEnter={handleEnter} onBackspaceEmpty={handleBackspaceEmpty}
            onImageUpload={handleImageUpload}
          />
        ))}
      </div>

      {/* 빈 영역 클릭 시 새 블록 */}
      {isAdmin && (
        <div className="min-h-[80px] cursor-text" onClick={async () => {
          const res = await fetch("/api/report-blocks", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "text", content: "", order_index: blocks.length, page_id: pageId }),
          });
          const { data } = await res.json();
          setBlocks((prev) => [...prev, data]);
          pendingFocus.current = data.id;
        }} />
      )}
    </div>
  );
}

// ── 메인 페이지 ────────────────────────────────────────────
export default function ReportAnalysisPage() {
  const supabase = createClient();
  const [isAdmin, setIsAdmin] = useState(false);
  const [pages, setPages] = useState<Page[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editingPageTitle, setEditingPageTitle] = useState(false);
  const [pageTitle, setPageTitle] = useState("");
  const [pageIcon, setPageIcon] = useState("📄");
  const [showIconPicker, setShowIconPicker] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setIsAdmin(data.user?.email?.trim() === ADMIN_EMAIL));
    fetch("/api/report-pages").then((r) => r.json()).then(({ data }) => {
      setPages(data ?? []);
      if (data?.length > 0) setSelectedPageId(data[0].id);
    });
  }, []);

  const selectedPage = pages.find((p) => p.id === selectedPageId);

  useEffect(() => {
    if (selectedPage) { setPageTitle(selectedPage.title); setPageIcon(selectedPage.icon); }
  }, [selectedPageId]);

  const handleAddPage = async (parentId: number | null = null) => {
    const siblings = pages.filter((p) => p.parent_id === parentId);
    const res = await fetch("/api/report-pages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "새 페이지", icon: "📄", order_index: siblings.length, parent_id: parentId }),
    });
    const { data } = await res.json();
    setPages((prev) => [...prev, data]);
    setSelectedPageId(data.id);
  };

  const handleRenamePage = async (id: number, title: string) => {
    await fetch(`/api/report-pages/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }),
    });
    setPages((prev) => prev.map((p) => p.id === id ? { ...p, title } : p));
    if (id === selectedPageId) setPageTitle(title);
  };

  const handleDeletePage = async (id: number) => {
    if (!confirm("이 페이지를 삭제할까요?")) return;
    await fetch(`/api/report-pages/${id}`, { method: "DELETE" });
    const next = pages.filter((p) => p.id !== id);
    setPages(next);
    if (selectedPageId === id) setSelectedPageId(next[0]?.id ?? null);
  };

  const handleMovePage = async (id: number, dir: "up" | "down") => {
    const page = pages.find((p) => p.id === id);
    if (!page) return;
    // 같은 부모의 형제들만 대상으로 순서 변경
    const siblings = pages
      .filter((p) => p.parent_id === page.parent_id)
      .sort((a, b) => a.order_index - b.order_index);
    const idx = siblings.findIndex((p) => p.id === id);
    if (dir === "up" && idx === 0) return;
    if (dir === "down" && idx === siblings.length - 1) return;
    const next = [...siblings];
    const si = dir === "up" ? idx - 1 : idx + 1;
    [next[idx], next[si]] = [next[si], next[idx]];
    // order_index 업데이트
    const updated = next.map((p, i) => ({ ...p, order_index: i }));
    setPages((prev) => prev.map((p) => updated.find((u) => u.id === p.id) ?? p));
    await Promise.all(
      updated.map((p) =>
        fetch(`/api/report-pages/${p.id}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_index: p.order_index }),
        })
      )
    );
  };

  const handleSavePageMeta = async (icon?: string) => {
    if (!selectedPageId) return;
    const body = icon ? { title: pageTitle, icon } : { title: pageTitle, icon: pageIcon };
    await fetch(`/api/report-pages/${selectedPageId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    setPages((prev) => prev.map((p) => p.id === selectedPageId ? { ...p, ...body } : p));
    if (icon) setPageIcon(icon);
    setEditingPageTitle(false);
  };

  return (
    <div className="flex" style={{ minHeight: "calc(100vh - 105px)" }}>
      {/* 사이드바 토글 (모바일) */}
      <button type="button" onClick={() => setSidebarOpen(true)}
        className="fixed bottom-4 left-4 z-20 md:hidden w-10 h-10 bg-white border border-slate-200 rounded-full shadow-md flex items-center justify-center text-slate-600">
        ☰
      </button>

      <Sidebar
        pages={pages} selectedId={selectedPageId} isAdmin={isAdmin}
        onSelect={(id) => { setSelectedPageId(id); setSidebarOpen(false); }}
        onAdd={(parentId) => handleAddPage(parentId)}
        onRename={handleRenamePage}
        onDelete={handleDeletePage}
        onMove={handleMovePage}
        sidebarOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
      />

      {/* 메인 컨텐츠 */}
      <div className="flex-1 overflow-auto min-w-0">
        {/* 포맷 툴바 */}
        {isAdmin && selectedPageId && (
          <div className="sticky top-0 z-10 bg-white border-b border-slate-200">
            <FormatBar />
          </div>
        )}

        {selectedPageId && selectedPage ? (
          <div className="max-w-3xl mx-auto px-8 py-10">
            {/* 페이지 제목 영역 */}
            <div className="mb-8 group">
              <div className="flex items-start gap-3">
                {/* 아이콘 */}
                <div className="relative">
                  <button type="button" onClick={() => isAdmin && setShowIconPicker((v) => !v)}
                    className={`text-4xl leading-none ${isAdmin ? "hover:opacity-70 cursor-pointer" : "cursor-default"}`}>
                    {pageIcon}
                  </button>
                  {showIconPicker && isAdmin && (
                    <div className="absolute top-12 left-0 bg-white border border-slate-200 rounded-xl shadow-lg p-2 z-20 flex flex-wrap gap-1 w-48">
                      {PAGE_ICONS.map((ic) => (
                        <button key={ic} type="button" onClick={() => { setShowIconPicker(false); handleSavePageMeta(ic); }}
                          className="w-8 h-8 flex items-center justify-center rounded hover:bg-slate-100 text-xl">{ic}</button>
                      ))}
                    </div>
                  )}
                </div>
                {/* 제목 */}
                <div className="flex-1 min-w-0">
                  {isAdmin && editingPageTitle ? (
                    <input autoFocus value={pageTitle} onChange={(e) => setPageTitle(e.target.value)}
                      onBlur={() => handleSavePageMeta()}
                      onKeyDown={(e) => { if (e.key === "Enter") handleSavePageMeta(); if (e.key === "Escape") setEditingPageTitle(false); }}
                      className="w-full text-4xl font-bold text-slate-900 bg-transparent border-b-2 border-blue-400 outline-none py-1"
                    />
                  ) : (
                    <h1 onClick={() => isAdmin && setEditingPageTitle(true)}
                      className={`text-4xl font-bold text-slate-900 py-1 ${isAdmin ? "cursor-text hover:opacity-80" : ""} ${!pageTitle ? "text-slate-300" : ""}`}>
                      {pageTitle || (isAdmin ? "제목 없음" : "")}
                    </h1>
                  )}
                </div>
              </div>
            </div>

            {/* 블록 에디터 */}
            <BlockEditor key={selectedPageId} pageId={selectedPageId} isAdmin={isAdmin} />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full py-20 text-slate-400">
            {pages.length === 0
              ? <>{isAdmin && <button type="button" onClick={() => handleAddPage(null)} className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">+ 첫 페이지 만들기</button>}</>
              : <p className="text-sm">왼쪽에서 페이지를 선택하세요</p>}
          </div>
        )}
      </div>
    </div>
  );
}
