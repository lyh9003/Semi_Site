"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL;

export default function BoardEditPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const supabase = createClient();
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [checking, setChecking] = useState(true);
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user || data.user.email !== ADMIN_EMAIL) {
        router.replace("/board");
        return;
      }
      fetch(`/api/board/${id}`)
        .then((r) => r.json())
        .then(({ data: post }) => {
          if (post && editorRef.current) {
            setTitle(post.title);
            editorRef.current.innerHTML = post.content ?? "";
          }
          setChecking(false);
        });
    });
  }, [id]);

  const uploadFile = async (file: File): Promise<string | null> => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/board/upload", { method: "POST", body: formData });
    if (res.ok) {
      const { url } = await res.json();
      return url;
    }
    const { error: msg } = await res.json();
    setError(msg ?? "이미지 업로드에 실패했습니다.");
    return null;
  };

  const insertImageAtCursor = (url: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();

    const img = document.createElement("img");
    img.src = url;
    img.style.cssText = "max-width:100%;border-radius:8px;margin:4px 0;display:block;";

    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(img);
      const br = document.createElement("br");
      range.setStartAfter(img);
      range.insertNode(br);
      range.setStartAfter(br);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      editor.appendChild(img);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const imageFiles = Array.from(e.clipboardData.items)
      .filter((item) => item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null);

    if (imageFiles.length > 0) {
      e.preventDefault();
      setUploading(true);
      for (const file of imageFiles) {
        const url = await uploadFile(file);
        if (url) insertImageAtCursor(url);
      }
      setUploading(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploading(true);
    for (const file of files) {
      const url = await uploadFile(file);
      if (url) insertImageAtCursor(url);
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = editorRef.current?.innerHTML ?? "";
    if (!title.trim() || !content.trim() || content === "<br>") {
      setError("제목과 내용을 모두 입력해주세요.");
      return;
    }
    setSubmitting(true);
    setError("");

    const res = await fetch(`/api/board/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content }),
    });

    if (res.ok) {
      router.push(`/board/${id}`);
    } else {
      const { error: msg } = await res.json();
      setError(msg ?? "오류가 발생했습니다.");
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Link href={`/board/${id}`} className="text-slate-400 hover:text-slate-600 transition-colors">
          ← 돌아가기
        </Link>
        <h1 className="text-2xl font-bold text-slate-800">글 수정</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="제목을 입력하세요"
          className="w-full px-4 py-3 border border-slate-200 rounded-xl text-slate-800 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />

        {/* 에디터 툴바 */}
        <div className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-t-xl bg-slate-50 border-b-0">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            {uploading ? (
              <><span className="w-3.5 h-3.5 border border-blue-400 border-t-transparent rounded-full animate-spin inline-block" /> 업로드 중</>
            ) : (
              <>🖼 이미지 삽입</>
            )}
          </button>
          <span className="text-xs text-slate-400">또는 Ctrl+V로 붙여넣기</span>
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
        </div>

        {/* contenteditable 에디터 */}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onPaste={handlePaste}
          data-placeholder="내용을 입력하세요"
          className="w-full min-h-64 px-4 py-3 border border-slate-200 rounded-b-xl text-slate-800 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent empty:before:content-[attr(data-placeholder)] empty:before:text-slate-400"
        />

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <div className="flex gap-3 justify-end">
          <Link
            href={`/board/${id}`}
            className="px-6 py-2.5 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
          >
            취소
          </Link>
          <button
            type="submit"
            disabled={submitting || uploading}
            className="px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            {submitting ? "저장 중..." : "저장"}
          </button>
        </div>
      </form>
    </main>
  );
}
