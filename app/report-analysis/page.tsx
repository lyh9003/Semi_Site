"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL?.trim();

type BlockType = "text" | "h1" | "h2" | "h3" | "image" | "divider" | "quote";

interface Block {
  id: number;
  type: BlockType;
  content: string;
  order_index: number;
}

const TYPE_LABELS: Record<BlockType, string> = {
  text: "텍스트",
  h1: "제목 1",
  h2: "제목 2",
  h3: "제목 3",
  image: "이미지",
  divider: "구분선",
  quote: "인용",
};

const FONT_SIZES = ["12", "14", "16", "18", "20", "24", "28", "32"];
const COLORS = [
  { label: "빨강", value: "#e53e3e" },
  { label: "주황", value: "#dd6b20" },
  { label: "노랑", value: "#d69e2e" },
  { label: "초록", value: "#38a169" },
  { label: "파랑", value: "#3182ce" },
  { label: "회색", value: "#718096" },
];

function autoLinkUrls(html: string) {
  return html.replace(
    /(?<!href=["'])(https?:\/\/[^\s<"']+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#3182ce;text-decoration:underline">$1</a>'
  );
}

// ── 포맷 툴바 ─────────────────────────────────────────────
function FormatBar({ colorPickerRef }: { colorPickerRef: React.RefObject<HTMLInputElement | null> }) {
  function exec(cmd: string, val?: string) { document.execCommand(cmd, false, val); }

  return (
    <div className="flex flex-wrap items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 rounded-xl shadow-sm">
      <button type="button" onMouseDown={(e) => { e.preventDefault(); exec("bold"); }}
        className="w-7 h-7 flex items-center justify-center rounded font-bold text-slate-700 hover:bg-slate-100 text-sm">B</button>
      <button type="button" onMouseDown={(e) => { e.preventDefault(); exec("italic"); }}
        className="w-7 h-7 flex items-center justify-center rounded italic text-slate-700 hover:bg-slate-100 text-sm">I</button>
      <button type="button" onMouseDown={(e) => { e.preventDefault(); exec("underline"); }}
        className="w-7 h-7 flex items-center justify-center rounded underline text-slate-700 hover:bg-slate-100 text-sm">U</button>
      <div className="w-px h-4 bg-slate-200 mx-0.5" />
      <select
        className="h-7 px-1 text-xs border border-slate-200 rounded bg-white text-slate-700 cursor-pointer"
        defaultValue=""
        onChange={(e) => {
          const size = e.target.value;
          e.target.value = "";
          if (!size) return;
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
            r.setStart(span.firstChild!, 1);
            r.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r);
          }
        }}
      >
        <option value="">크기</option>
        {FONT_SIZES.map((s) => <option key={s} value={s}>{s}px</option>)}
      </select>
      <select
        className="h-7 px-1 text-xs border border-slate-200 rounded bg-white text-slate-700 cursor-pointer"
        defaultValue=""
        onChange={(e) => {
          const color = e.target.value;
          e.target.value = "";
          if (color) exec("foreColor", color);
        }}
      >
        <option value="">색상</option>
        {COLORS.map((c) => <option key={c.value} value={c.value} style={{ color: c.value }}>{c.label}</option>)}
      </select>
      <button type="button"
        onMouseDown={(e) => { e.preventDefault(); colorPickerRef.current?.click(); }}
        className="w-7 h-7 flex items-center justify-center rounded border border-slate-200 hover:bg-slate-100 text-sm">🎨</button>
      <input ref={colorPickerRef} type="color" className="absolute opacity-0 w-0 h-0"
        onChange={(e) => exec("foreColor", e.target.value)} />
      <div className="w-px h-4 bg-slate-200 mx-0.5" />
      <button type="button"
        onMouseDown={(e) => {
          e.preventDefault();
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
            const a = `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:#3182ce;text-decoration:underline">${text}</a>`;
            exec("insertHTML", a);
          }
        }}
        className="w-7 h-7 flex items-center justify-center rounded text-slate-700 hover:bg-slate-100 text-sm">🔗</button>
    </div>
  );
}

// ── 블록 컴포넌트 ──────────────────────────────────────────
interface BlockProps {
  block: Block;
  isAdmin: boolean;
  isFirst: boolean;
  isLast: boolean;
  onSave: (id: number, content: string, type?: BlockType) => void;
  onDelete: (id: number) => void;
  onMoveUp: (id: number) => void;
  onMoveDown: (id: number) => void;
  onAddAfter: (id: number) => void;
  onImageUpload: (id: number, file: File) => Promise<void>;
}

function BlockItem({ block, isAdmin, isFirst, isLast, onSave, onDelete, onMoveUp, onMoveDown, onAddAfter, onImageUpload }: BlockProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [addHovered, setAddHovered] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (ref.current && block.type !== "image" && block.type !== "divider") {
      if (ref.current.innerHTML !== block.content) {
        ref.current.innerHTML = block.content;
      }
    }
  }, [block.id]);

  const schedSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (ref.current) onSave(block.id, ref.current.innerHTML);
    }, 800);
  }, [block.id, onSave]);

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData.items)
      .filter((i) => i.type.startsWith("image/"))
      .map((i) => i.getAsFile())
      .filter((f): f is File => f !== null);
    if (imgs.length > 0) {
      e.preventDefault();
      for (const f of imgs) await onImageUpload(block.id, f);
    }
  }, [block.id, onImageUpload]);

  const blockClass = {
    text: "text-slate-700 text-sm leading-relaxed",
    h1: "text-2xl font-bold text-slate-900",
    h2: "text-xl font-bold text-slate-800",
    h3: "text-lg font-semibold text-slate-800",
    quote: "text-slate-600 italic border-l-4 border-blue-400 pl-4 text-sm leading-relaxed",
    image: "",
    divider: "",
  }[block.type];

  if (block.type === "divider") {
    return (
      <div className="relative group" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
        <hr className="border-slate-200 my-1" />
        {isAdmin && hovered && (
          <AdminControls
            isFirst={isFirst} isLast={isLast}
            onMoveUp={() => onMoveUp(block.id)}
            onMoveDown={() => onMoveDown(block.id)}
            onDelete={() => onDelete(block.id)}
            label="구분선"
          />
        )}
        {isAdmin && (
          <AddButton show={addHovered} onMouseEnter={() => setAddHovered(true)} onMouseLeave={() => setAddHovered(false)} onClick={() => onAddAfter(block.id)} />
        )}
      </div>
    );
  }

  if (block.type === "image") {
    return (
      <div className="relative group" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
        {block.content ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={block.content} alt="" className="max-w-full rounded-lg my-1" />
        ) : isAdmin ? (
          <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors">
            <span className="text-2xl mb-1">🖼</span>
            <span className="text-sm text-slate-400">클릭하거나 이미지를 붙여넣기</span>
            <input type="file" accept="image/*" className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) await onImageUpload(block.id, f);
              }} />
          </label>
        ) : null}
        {isAdmin && hovered && block.content && (
          <label className="absolute top-2 left-2 px-2 py-1 text-xs bg-black/50 text-white rounded cursor-pointer hover:bg-black/70">
            이미지 변경
            <input type="file" accept="image/*" className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) await onImageUpload(block.id, f);
              }} />
          </label>
        )}
        {isAdmin && hovered && (
          <AdminControls
            isFirst={isFirst} isLast={isLast}
            onMoveUp={() => onMoveUp(block.id)}
            onMoveDown={() => onMoveDown(block.id)}
            onDelete={() => onDelete(block.id)}
            label="이미지"
          />
        )}
        {isAdmin && (
          <AddButton show={addHovered} onMouseEnter={() => setAddHovered(true)} onMouseLeave={() => setAddHovered(false)} onClick={() => onAddAfter(block.id)} />
        )}
      </div>
    );
  }

  // 텍스트 계열 블록
  return (
    <div className="relative group" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {isAdmin && hovered && (
        <div className="absolute -left-8 top-1/2 -translate-y-1/2 flex flex-col gap-0.5">
          <select
            value={block.type}
            onChange={(e) => {
              onSave(block.id, ref.current?.innerHTML ?? block.content, e.target.value as BlockType);
            }}
            className="text-xs border border-slate-200 rounded bg-white text-slate-500 cursor-pointer w-6 h-6 p-0 text-center"
            title="블록 타입 변경"
          >
            {(Object.keys(TYPE_LABELS) as BlockType[]).filter(t => t !== "divider" && t !== "image").map((t) => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>
      )}
      <div
        ref={ref}
        contentEditable={isAdmin}
        suppressContentEditableWarning
        onInput={schedSave}
        onBlur={() => {
          if (saveTimer.current) clearTimeout(saveTimer.current);
          if (ref.current) onSave(block.id, ref.current.innerHTML);
        }}
        onPaste={handlePaste}
        data-placeholder={isAdmin ? (block.type === "h1" ? "제목 1" : block.type === "h2" ? "제목 2" : block.type === "h3" ? "제목 3" : block.type === "quote" ? "인용문..." : "내용을 입력하세요...") : undefined}
        className={`outline-none w-full py-1 px-0 break-words ${blockClass} ${isAdmin ? "cursor-text empty:before:content-[attr(data-placeholder)] empty:before:text-slate-300" : ""}`}
        dangerouslySetInnerHTML={!isAdmin ? { __html: autoLinkUrls(block.content) } : undefined}
      />
      {isAdmin && hovered && (
        <AdminControls
          isFirst={isFirst} isLast={isLast}
          onMoveUp={() => onMoveUp(block.id)}
          onMoveDown={() => onMoveDown(block.id)}
          onDelete={() => onDelete(block.id)}
          label={TYPE_LABELS[block.type]}
        />
      )}
      {isAdmin && (
        <AddButton show={addHovered} onMouseEnter={() => setAddHovered(true)} onMouseLeave={() => setAddHovered(false)} onClick={() => onAddAfter(block.id)} />
      )}
    </div>
  );
}

function AdminControls({ isFirst, isLast, onMoveUp, onMoveDown, onDelete, label }: {
  isFirst: boolean; isLast: boolean;
  onMoveUp: () => void; onMoveDown: () => void; onDelete: () => void; label: string;
}) {
  return (
    <div className="absolute -right-2 top-1/2 -translate-y-1/2 translate-x-full flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-1.5 py-1 shadow-sm z-10">
      <span className="text-xs text-slate-300 pr-1">{label}</span>
      <button type="button" onClick={onMoveUp} disabled={isFirst}
        className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:bg-slate-100 disabled:opacity-20 text-xs">↑</button>
      <button type="button" onClick={onMoveDown} disabled={isLast}
        className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:bg-slate-100 disabled:opacity-20 text-xs">↓</button>
      <button type="button" onClick={onDelete}
        className="w-5 h-5 flex items-center justify-center rounded text-red-400 hover:bg-red-50 text-xs">✕</button>
    </div>
  );
}

function AddButton({ show, onMouseEnter, onMouseLeave, onClick }: {
  show: boolean; onMouseEnter: () => void; onMouseLeave: () => void; onClick: () => void;
}) {
  return (
    <div className="relative h-2 -my-1 z-10" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      {show && (
        <div className="absolute inset-x-0 flex items-center justify-center">
          <div className="flex-1 h-px bg-blue-300" />
          <button type="button" onClick={onClick}
            className="mx-2 w-5 h-5 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center hover:bg-blue-600 shadow-sm">
            +
          </button>
          <div className="flex-1 h-px bg-blue-300" />
        </div>
      )}
    </div>
  );
}

// ── 메인 페이지 ────────────────────────────────────────────
export default function ReportAnalysisPage() {
  const supabase = createClient();
  const [isAdmin, setIsAdmin] = useState(false);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [addMenu, setAddMenu] = useState(false);
  const [saving, setSaving] = useState(false);
  const colorPickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setIsAdmin(data.user?.email?.trim() === ADMIN_EMAIL);
    });
    fetch("/api/report-blocks")
      .then((r) => r.json())
      .then(({ data }) => { setBlocks(data ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // ── 블록 저장 ──
  const handleSave = useCallback(async (id: number, content: string, type?: BlockType) => {
    setSaving(true);
    const body: Record<string, string> = { content };
    if (type) body.type = type;
    await fetch(`/api/report-blocks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (type) {
      setBlocks((prev) => prev.map((b) => b.id === id ? { ...b, type, content } : b));
    }
    setSaving(false);
  }, []);

  // ── 블록 삭제 ──
  const handleDelete = useCallback(async (id: number) => {
    if (!confirm("이 블록을 삭제할까요?")) return;
    await fetch(`/api/report-blocks/${id}`, { method: "DELETE" });
    setBlocks((prev) => prev.filter((b) => b.id !== id));
  }, []);

  // ── 순서 이동 ──
  const move = useCallback(async (id: number, dir: "up" | "down") => {
    const idx = blocks.findIndex((b) => b.id === id);
    if (dir === "up" && idx === 0) return;
    if (dir === "down" && idx === blocks.length - 1) return;
    const newBlocks = [...blocks];
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    [newBlocks[idx], newBlocks[swapIdx]] = [newBlocks[swapIdx], newBlocks[idx]];
    setBlocks(newBlocks);
    await fetch("/api/report-blocks/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: newBlocks.map((b) => b.id) }),
    });
  }, [blocks]);

  // ── 블록 추가 ──
  const addBlock = useCallback(async (type: BlockType, afterId?: number) => {
    const idx = afterId ? blocks.findIndex((b) => b.id === afterId) : blocks.length - 1;
    const order_index = idx + 1;
    const res = await fetch("/api/report-blocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, content: "", order_index }),
    });
    const { data } = await res.json();
    setBlocks((prev) => {
      const insertAt = afterId ? prev.findIndex((b) => b.id === afterId) + 1 : prev.length;
      const next = [...prev];
      next.splice(insertAt, 0, data);
      return next;
    });
    setAddMenu(false);
    // 새 블록에 포커스
    setTimeout(() => {
      const el = document.querySelector(`[data-block-id="${data.id}"]`) as HTMLElement;
      el?.focus();
    }, 100);
  }, [blocks]);

  // ── 이미지 업로드 ──
  const handleImageUpload = useCallback(async (blockId: number, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/board/upload", { method: "POST", body: formData });
    if (!res.ok) return;
    const { url } = await res.json();

    const block = blocks.find((b) => b.id === blockId);
    if (block?.type === "image") {
      await fetch(`/api/report-blocks/${blockId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: url }),
      });
      setBlocks((prev) => prev.map((b) => b.id === blockId ? { ...b, content: url } : b));
    } else {
      // 텍스트 블록에 인라인 이미지 삽입
      const img = document.createElement("img");
      img.src = url;
      img.style.cssText = "max-width:100%;border-radius:8px;margin:4px 0;display:block;";
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.insertNode(img);
        range.setStartAfter(img);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      // blur로 자동 저장 트리거
    }
  }, [blocks]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <main className="max-w-3xl mx-auto px-6 py-10">
      {/* 헤더 */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">레포트 분석</h1>
        {saving && <span className="text-xs text-slate-400 mt-1 block">저장 중...</span>}
      </div>

      {/* 포맷 툴바 (관리자만) */}
      {isAdmin && (
        <div className="sticky top-[105px] md:top-[64px] z-20 mb-4">
          <FormatBar colorPickerRef={colorPickerRef} />
        </div>
      )}

      {/* 블록 목록 */}
      <div className="space-y-1 pl-8 pr-16">
        {blocks.length === 0 && isAdmin && (
          <p className="text-slate-300 text-sm py-8 text-center">아래 버튼으로 첫 블록을 추가해보세요.</p>
        )}
        {blocks.length === 0 && !isAdmin && (
          <p className="text-slate-400 text-sm py-8 text-center">아직 작성된 내용이 없습니다.</p>
        )}
        {blocks.map((block, idx) => (
          <BlockItem
            key={block.id}
            block={block}
            isAdmin={isAdmin}
            isFirst={idx === 0}
            isLast={idx === blocks.length - 1}
            onSave={handleSave}
            onDelete={handleDelete}
            onMoveUp={(id) => move(id, "up")}
            onMoveDown={(id) => move(id, "down")}
            onAddAfter={(id) => addBlock("text", id)}
            onImageUpload={handleImageUpload}
          />
        ))}
      </div>

      {/* 블록 추가 버튼 (관리자) */}
      {isAdmin && (
        <div className="mt-6 pl-8 relative">
          <button
            type="button"
            onClick={() => setAddMenu((v) => !v)}
            className="flex items-center gap-2 px-4 py-2 border border-dashed border-slate-300 rounded-lg text-slate-400 text-sm hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-colors w-full"
          >
            <span className="text-lg leading-none">+</span>
            <span>블록 추가</span>
          </button>
          {addMenu && (
            <div className="absolute left-8 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg p-2 z-20 grid grid-cols-2 gap-1 w-72">
              {(Object.entries(TYPE_LABELS) as [BlockType, string][]).map(([type, label]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => addBlock(type)}
                  className="text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
                >
                  <span className="mr-2">
                    {type === "h1" ? "H1" : type === "h2" ? "H2" : type === "h3" ? "H3" :
                     type === "image" ? "🖼" : type === "divider" ? "—" :
                     type === "quote" ? "❝" : "¶"}
                  </span>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
