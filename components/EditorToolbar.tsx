"use client";

import { useRef } from "react";

interface Props {
  onImageClick: () => void;
  onAttachClick: () => void;
  uploading: boolean;
  attachUploading: boolean;
}

const FONT_SIZES = ["10", "12", "14", "16", "18", "20", "24", "28", "32"];
const COLORS = [
  { label: "기본", value: "" },
  { label: "빨강", value: "#e53e3e" },
  { label: "주황", value: "#dd6b20" },
  { label: "노랑", value: "#d69e2e" },
  { label: "초록", value: "#38a169" },
  { label: "파랑", value: "#3182ce" },
  { label: "남색", value: "#5a67d8" },
  { label: "회색", value: "#718096" },
];

function exec(command: string, value?: string) {
  document.execCommand(command, false, value);
}

export default function EditorToolbar({ onImageClick, onAttachClick, uploading, attachUploading }: Props) {
  const colorRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-t-xl bg-slate-50 border-b-0 sticky top-0 z-20">
      {/* 굵게 */}
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); exec("bold"); }}
        title="굵게 (Ctrl+B)"
        className="w-7 h-7 flex items-center justify-center rounded font-bold text-slate-700 hover:bg-slate-200 transition-colors text-sm"
      >
        B
      </button>

      {/* 밑줄 */}
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); exec("underline"); }}
        title="밑줄 (Ctrl+U)"
        className="w-7 h-7 flex items-center justify-center rounded text-slate-700 hover:bg-slate-200 transition-colors text-sm underline"
      >
        U
      </button>

      {/* 기울임 */}
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); exec("italic"); }}
        title="기울임 (Ctrl+I)"
        className="w-7 h-7 flex items-center justify-center rounded text-slate-700 hover:bg-slate-200 transition-colors text-sm italic"
      >
        I
      </button>

      <div className="w-px h-5 bg-slate-300 mx-0.5" />

      {/* 글자 크기 */}
      <select
        title="글자 크기"
        defaultValue=""
        onChange={(e) => {
          if (e.target.value) {
            exec("fontSize", "7"); // placeholder size
            // execCommand fontSize only supports 1-7, so we override with style
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
              const range = sel.getRangeAt(0);
              const span = document.createElement("span");
              span.style.fontSize = `${e.target.value}px`;
              try {
                range.surroundContents(span);
                sel.removeAllRanges();
                const newRange = document.createRange();
                newRange.setStartAfter(span);
                newRange.collapse(true);
                sel.addRange(newRange);
              } catch {
                // 선택 범위가 여러 요소에 걸쳐있으면 무시
              }
            }
          }
          e.target.value = "";
        }}
        className="h-7 px-1 text-xs border border-slate-200 rounded bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
      >
        <option value="">크기</option>
        {FONT_SIZES.map((s) => (
          <option key={s} value={s}>{s}px</option>
        ))}
      </select>

      {/* 글자 색상 */}
      <div className="relative">
        <select
          title="글자 색상"
          defaultValue=""
          onChange={(e) => {
            if (e.target.value !== undefined) {
              if (e.target.value === "") {
                exec("removeFormat");
              } else {
                exec("foreColor", e.target.value);
              }
            }
            e.target.value = "";
          }}
          className="h-7 px-1 text-xs border border-slate-200 rounded bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
        >
          <option value="">색상</option>
          {COLORS.filter((c) => c.value).map((c) => (
            <option key={c.value} value={c.value} style={{ color: c.value }}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {/* 색상 직접 선택 */}
      <div className="relative" title="색상 직접 선택">
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); colorRef.current?.click(); }}
          className="w-7 h-7 flex items-center justify-center rounded border border-slate-200 hover:bg-slate-200 transition-colors text-sm"
        >
          🎨
        </button>
        <input
          ref={colorRef}
          type="color"
          className="absolute opacity-0 w-0 h-0"
          onChange={(e) => exec("foreColor", e.target.value)}
        />
      </div>

      <div className="w-px h-5 bg-slate-300 mx-0.5" />

      {/* 이미지 삽입 */}
      <button
        type="button"
        onClick={onImageClick}
        disabled={uploading}
        title="이미지 삽입"
        className="flex items-center gap-1 px-2 h-7 text-xs border border-slate-200 rounded bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
      >
        {uploading ? (
          <><span className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin inline-block" /> 업로드 중</>
        ) : (
          <>🖼 이미지</>
        )}
      </button>

      {/* 첨부파일 */}
      <button
        type="button"
        onClick={onAttachClick}
        disabled={attachUploading}
        title="파일 첨부"
        className="flex items-center gap-1 px-2 h-7 text-xs border border-slate-200 rounded bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
      >
        {attachUploading ? (
          <><span className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin inline-block" /> 업로드 중</>
        ) : (
          <>📎 첨부</>
        )}
      </button>

      <span className="text-xs text-slate-400 ml-1 hidden sm:inline">Ctrl+V 붙여넣기</span>
    </div>
  );
}
