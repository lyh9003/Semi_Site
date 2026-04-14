"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL?.trim();

interface Page {
  id: number;
  title: string;
  icon: string;
  order_index: number;
  parent_id: number | null;
  content: string;
}

const FONT_SIZES = ["12", "14", "16", "18", "20", "24", "28", "32"];
const COLORS = [
  { label: "빨강", value: "#e53e3e" }, { label: "주황", value: "#dd6b20" },
  { label: "초록", value: "#38a169" }, { label: "파랑", value: "#3182ce" },
  { label: "회색", value: "#718096" },
];
const PAGE_ICONS = ["📄", "📝", "📊", "📈", "💡", "🔍", "📌", "⭐", "🗂", "📋"];

const SLASH_ITEMS = [
  { label: "제목 1", desc: "대제목", icon: "H1", cmd: () => document.execCommand("formatBlock", false, "h1") },
  { label: "제목 2", desc: "중제목", icon: "H2", cmd: () => document.execCommand("formatBlock", false, "h2") },
  { label: "제목 3", desc: "소제목", icon: "H3", cmd: () => document.execCommand("formatBlock", false, "h3") },
  { label: "텍스트", desc: "일반 텍스트", icon: "¶", cmd: () => document.execCommand("formatBlock", false, "p") },
  { label: "인용", desc: "인용 블록", icon: "❝", cmd: () => document.execCommand("formatBlock", false, "blockquote") },
  { label: "구분선", desc: "수평선", icon: "—", cmd: () => document.execCommand("insertHTML", false, "<hr style='border:none;border-top:1px solid #e2e8f0;margin:12px 0;' />") },
];

function autoLink(html: string) {
  return html.replace(/(?<!href=["'])(?<!src=["'])(https?:\/\/[^\s<"']+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#3182ce;text-decoration:underline">$1</a>');
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
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">증권 리포트 Pick</span>
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

// ── 리치 에디터 (단일 contenteditable) ──────────────────────
function RichEditor({ page, isAdmin, onContentChange, childPages, onSelectPage }: {
  page: Page;
  isAdmin: boolean;
  onContentChange: (id: number, content: string) => void;
  childPages: Page[];
  onSelectPage: (id: number) => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const colorRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [slashMenu, setSlashMenu] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const [slashPos, setSlashPos] = useState({ x: 0, y: 0 });

  // 이미지 리사이즈 상태
  const [selectedImg, setSelectedImg] = useState<HTMLImageElement | null>(null);
  const [imgRect, setImgRect] = useState<DOMRect | null>(null);
  const resizeDrag = useRef<{ startX: number; startWidth: number; side: "left" | "right" } | null>(null);

  // 선택된 이미지의 rect 업데이트 (스크롤/리사이즈 대응)
  const updateImgRect = useCallback(() => {
    if (selectedImg) setImgRect(selectedImg.getBoundingClientRect());
  }, [selectedImg]);

  useEffect(() => {
    if (!selectedImg) return;
    updateImgRect();
    window.addEventListener("scroll", updateImgRect, true);
    window.addEventListener("resize", updateImgRect);
    return () => {
      window.removeEventListener("scroll", updateImgRect, true);
      window.removeEventListener("resize", updateImgRect);
    };
  }, [selectedImg, updateImgRect]);

  // 테두리 드래그 리사이즈
  const startResize = (e: React.MouseEvent, side: "left" | "right" | "bottom" | "bottom-left" | "bottom-right") => {
    if (!selectedImg) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = selectedImg.offsetWidth;
    const startH = selectedImg.offsetHeight;
    resizeDrag.current = { startX, startWidth: startW, side };
    const onMove = (ev: MouseEvent) => {
      if (!resizeDrag.current || !selectedImg) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let newW = startW;
      let newH = startH;
      if (side === "right" || side === "bottom-right") newW = Math.max(50, startW + dx);
      if (side === "left" || side === "bottom-left") newW = Math.max(50, startW - dx);
      if (side === "bottom" || side === "bottom-left" || side === "bottom-right") newH = Math.max(30, startH + dy);
      if (side !== "bottom") {
        selectedImg.style.width = `${newW}px`;
        selectedImg.style.maxWidth = "none";
      }
      if (side === "bottom" || side === "bottom-left" || side === "bottom-right") {
        selectedImg.style.height = `${newH}px`;
        selectedImg.style.objectFit = "fill";
      }
      setImgRect(selectedImg.getBoundingClientRect());
    };
    const onUp = () => {
      resizeDrag.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      schedSave();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // 페이지 전환 시 내용 로드
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = page.content || "";
    }
  }, [page.id]);

  const save = useCallback(() => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    fetch(`/api/report-pages/${page.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: html }),
    });
    onContentChange(page.id, html);
  }, [page.id, onContentChange]);

  const schedSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, 800);
  }, [save]);

  const exec = (cmd: string, val?: string) => { document.execCommand(cmd, false, val); };

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
    schedSave();
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
    schedSave();
  };

  const uploadAndInsert = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/board/upload", { method: "POST", body: formData });
    if (!res.ok) return;
    const { url } = await res.json();
    editorRef.current?.focus();
    exec("insertHTML", `<img src="${url}" style="max-width:100%;border-radius:8px;margin:4px 0;display:block;" />`);
    schedSave();
  };

  const applySlash = (idx: number) => {
    // 슬래시 문자 제거
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent ?? "";
        const pos = range.startOffset;
        const slashPos2 = t.lastIndexOf("/", pos - 1);
        if (slashPos2 >= 0) {
          (node as Text).deleteData(slashPos2, pos - slashPos2);
          range.setStart(node, slashPos2);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    }
    SLASH_ITEMS[idx].cmd();
    setSlashMenu(false);
    editorRef.current?.focus();
    schedSave();
  };

  const handleInput = () => {
    schedSave();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) { setSlashMenu(false); return; }
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      const pos = range.startOffset;
      if (pos > 0 && text[pos - 1] === "/") {
        const rects = range.getClientRects();
        if (rects.length > 0) {
          setSlashPos({ x: rects[0].left, y: rects[0].bottom + window.scrollY });
        }
        setSlashMenu(true);
        setSlashIdx(0);
        return;
      }
    }
    setSlashMenu(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (slashMenu) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSlashIdx((i) => Math.min(i + 1, SLASH_ITEMS.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSlashIdx((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Enter") { e.preventDefault(); applySlash(slashIdx); return; }
      if (e.key === "Escape") { setSlashMenu(false); return; }
    }
  };

  const handleBlur = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    save();
  };

  const handleEditorClick = (e: React.MouseEvent) => {
    if (e.target instanceof HTMLImageElement) {
      setSelectedImg(e.target);
      setImgRect(e.target.getBoundingClientRect());
    } else {
      setSelectedImg(null);
      setImgRect(null);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData.items)
      .filter((i) => i.type.startsWith("image/")).map((i) => i.getAsFile()).filter(Boolean) as File[];
    if (imgs.length) { e.preventDefault(); for (const f of imgs) await uploadAndInsert(f); }
  };

  const contentClass = `
    text-slate-700 text-[15px] leading-7 break-words
    [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:text-slate-900 [&_h1]:leading-tight [&_h1]:mt-6 [&_h1]:mb-2
    [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:text-slate-800 [&_h2]:leading-tight [&_h2]:mt-4 [&_h2]:mb-1
    [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:text-slate-800 [&_h3]:leading-snug [&_h3]:mt-3 [&_h3]:mb-1
    [&_blockquote]:border-l-4 [&_blockquote]:border-blue-300 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-slate-600
    [&_a]:text-blue-600 [&_a]:underline
    [&_img]:max-w-full [&_img]:rounded-lg [&_img]:my-1 [&_img]:cursor-pointer
    [&_hr]:border-none [&_hr]:border-t [&_hr]:border-slate-200 [&_hr]:my-3
  `;

  return (
    <div className="flex flex-col min-h-full">
      {/* 툴바 */}
      {isAdmin && (
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200">
          <div className="flex flex-wrap items-center gap-1 px-3 py-1.5">
            {/* B / I / U */}
            {[["B","bold","font-bold"],["I","italic","italic"],["U","underline","underline"]].map(([label, cmd, cls]) => (
              <button key={cmd} type="button"
                onMouseDown={(e) => { e.preventDefault(); exec(cmd); }}
                className={`w-7 h-7 flex items-center justify-center rounded text-slate-600 hover:bg-slate-100 text-sm ${cls}`}>
                {label}
              </button>
            ))}
            <div className="w-px h-4 bg-slate-200 mx-0.5" />
            {/* 제목 */}
            {[["H1","h1"],["H2","h2"],["H3","h3"]].map(([label, tag]) => (
              <button key={tag} type="button"
                onMouseDown={(e) => { e.preventDefault(); exec("formatBlock", tag); }}
                className="px-2 h-7 flex items-center justify-center rounded text-slate-600 hover:bg-slate-100 text-xs font-bold">
                {label}
              </button>
            ))}
            <button type="button"
              onMouseDown={(e) => { e.preventDefault(); exec("formatBlock", "p"); }}
              className="px-2 h-7 flex items-center justify-center rounded text-slate-500 hover:bg-slate-100 text-xs">
              P
            </button>
            <div className="w-px h-4 bg-slate-200 mx-0.5" />
            {/* 폰트 크기 */}
            <select className="h-7 px-1 text-xs border border-slate-200 rounded bg-white text-slate-600 cursor-pointer"
              defaultValue="" onChange={(e) => { const v = e.target.value; e.target.value = ""; if (v) applySize(v); }}>
              <option value="">크기</option>
              {FONT_SIZES.map((s) => <option key={s} value={s}>{s}px</option>)}
            </select>
            {/* 색상 */}
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
            {/* 링크 */}
            <button type="button" onMouseDown={(e) => { e.preventDefault(); insertLink(); }}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-sm">🔗</button>
            {/* 구분선 */}
            <button type="button"
              onMouseDown={(e) => { e.preventDefault(); exec("insertHTML", "<hr style='border:none;border-top:1px solid #e2e8f0;margin:12px 0;' />"); schedSave(); }}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-sm font-bold text-slate-600">—</button>
            {/* 이미지 */}
            <button type="button" onMouseDown={(e) => { e.preventDefault(); imageInputRef.current?.click(); }}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 text-sm">🖼</button>
            <input ref={imageInputRef} type="file" accept="image/*" className="hidden"
              onChange={async (e) => { const f = e.target.files?.[0]; if (f) await uploadAndInsert(f); e.target.value = ""; }} />
          </div>
        </div>
      )}

      {/* 에디터 본문 */}
      <div className="flex-1 px-10 py-8">
        {isAdmin ? (
          <>
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              onInput={handleInput}
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
              onPaste={handlePaste}
              onClick={handleEditorClick}
              data-placeholder="글을 입력하거나 '/'로 명령어를 입력하세요..."
              className={`outline-none min-h-[60vh] ${contentClass} empty:before:content-[attr(data-placeholder)] empty:before:text-slate-300 empty:before:pointer-events-none`}
            />
            {slashMenu && (
              <div
                className="fixed bg-white border border-slate-200 rounded-xl shadow-lg p-1 z-50 w-56"
                style={{ left: slashPos.x, top: slashPos.y + 4 }}
                onMouseDown={(e) => e.preventDefault()}
              >
                <p className="text-xs text-slate-400 px-2 py-1">블록 타입 선택</p>
                {SLASH_ITEMS.map((item, i) => (
                  <button key={item.label} type="button"
                    onMouseDown={(e) => { e.preventDefault(); applySlash(i); }}
                    className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm text-left transition-colors ${i === slashIdx ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-50"}`}>
                    <span className="w-6 text-center font-mono text-xs text-slate-500">{item.icon}</span>
                    <span className="flex-1">{item.label}</span>
                    <span className="text-xs text-slate-400">{item.desc}</span>
                  </button>
                ))}
              </div>
            )}
            {/* 이미지 리사이즈 오버레이 — 테두리가 리사이즈 존 */}
            {selectedImg && imgRect && (
              <div
                className="fixed z-40 pointer-events-none"
                style={{ left: imgRect.left, top: imgRect.top, width: imgRect.width, height: imgRect.height }}
              >
                {/* 왼쪽 테두리 */}
                <div className="absolute inset-y-0 left-0 w-2 cursor-ew-resize pointer-events-auto bg-blue-500/60 rounded-l"
                  onMouseDown={(e) => startResize(e, "left")} />
                {/* 오른쪽 테두리 */}
                <div className="absolute inset-y-0 right-0 w-2 cursor-ew-resize pointer-events-auto bg-blue-500/60 rounded-r"
                  onMouseDown={(e) => startResize(e, "right")} />
                {/* 하단 테두리 */}
                <div className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize pointer-events-auto bg-blue-500/60 rounded-b"
                  onMouseDown={(e) => startResize(e, "bottom")} />
                {/* 우하단 코너 */}
                <div className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize pointer-events-auto bg-blue-500 rounded-br"
                  onMouseDown={(e) => startResize(e, "bottom-right")} />
                {/* 좌하단 코너 */}
                <div className="absolute bottom-0 left-0 w-4 h-4 cursor-nesw-resize pointer-events-auto bg-blue-500 rounded-bl"
                  onMouseDown={(e) => startResize(e, "bottom-left")} />
                {/* 얇은 전체 테두리선 */}
                <div className="absolute inset-0 border-2 border-blue-500 rounded pointer-events-none" />
                {/* 크기 표시 */}
                <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-slate-700 text-white text-xs px-1.5 py-0.5 rounded pointer-events-none whitespace-nowrap">
                  {Math.round(imgRect.width)} × {Math.round(imgRect.height)}
                </div>
              </div>
            )}
          </>
        ) : (
          <div
            className={contentClass}
            dangerouslySetInnerHTML={{ __html: autoLink(page.content || "") }}
          />
        )}

        {/* 하위 페이지 카드 */}
        {childPages.length > 0 && (
          <div className="px-10 pb-10 mt-4">
            <div className="border-t border-slate-100 pt-6">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">하위 페이지</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {childPages.map((child) => (
                  <button
                    key={child.id}
                    type="button"
                    onClick={() => onSelectPage(child.id)}
                    className="text-left flex items-start gap-3 p-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 hover:shadow-sm transition-all group"
                  >
                    <span className="text-2xl leading-none mt-0.5 flex-shrink-0">{child.icon || "📄"}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 group-hover:text-blue-600 transition-colors truncate">
                        {child.title || "제목 없음"}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">페이지 열기 →</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
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

  const handleContentChange = useCallback((id: number, content: string) => {
    setPages((prev) => prev.map((p) => p.id === id ? { ...p, content } : p));
  }, []);

  const handleAddPage = async (parentId: number | null = null) => {
    const siblings = pages.filter((p) => p.parent_id === parentId);
    const res = await fetch("/api/report-pages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "새 페이지", icon: "📄", order_index: siblings.length, parent_id: parentId }),
    });
    const { data } = await res.json();
    setPages((prev) => [...prev, { ...data, content: "" }]);
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
    const siblings = pages
      .filter((p) => p.parent_id === page.parent_id)
      .sort((a, b) => a.order_index - b.order_index);
    const idx = siblings.findIndex((p) => p.id === id);
    if (dir === "up" && idx === 0) return;
    if (dir === "down" && idx === siblings.length - 1) return;
    const next = [...siblings];
    const si = dir === "up" ? idx - 1 : idx + 1;
    [next[idx], next[si]] = [next[si], next[idx]];
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
        {selectedPageId && selectedPage ? (
          <div className="flex flex-col min-h-full">
            {/* 페이지 제목 영역 */}
            <div className="px-10 pt-10 pb-4">
              <div className="flex items-start gap-3">
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

            {/* 리치 에디터 */}
            <RichEditor
              key={selectedPageId}
              page={selectedPage}
              isAdmin={isAdmin}
              onContentChange={handleContentChange}
              childPages={pages.filter((p) => p.parent_id === selectedPageId).sort((a, b) => a.order_index - b.order_index)}
              onSelectPage={(id) => { setSelectedPageId(id); setSidebarOpen(false); }}
            />
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
