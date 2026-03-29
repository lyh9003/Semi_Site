"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { BoardPost } from "@/lib/types";

const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL;

export default function BoardDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const supabase = createClient();
  const [post, setPost] = useState<BoardPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setIsAdmin(data.user?.email === ADMIN_EMAIL);
    });

    fetch(`/api/board/${id}`)
      .then((r) => r.json())
      .then(({ data }) => {
        setPost(data ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  const handleDelete = async () => {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    setDeleting(true);
    const res = await fetch(`/api/board/${id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/board");
    } else {
      alert("삭제에 실패했습니다.");
      setDeleting(false);
    }
  };

  const formatDateTime = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!post) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-8">
        <p className="text-slate-400 text-center py-20">게시글을 찾을 수 없습니다.</p>
        <div className="text-center">
          <Link href="/board" className="text-blue-600 hover:underline">목록으로</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-6">
        <Link href="/board" className="text-sm text-slate-400 hover:text-slate-600 transition-colors">
          ← 아카이브 목록
        </Link>
      </div>

      <article className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {/* 헤더 */}
        <div className="px-6 py-5 border-b border-slate-100">
          <h1 className="text-xl font-bold text-slate-800 mb-3">{post.title}</h1>
          <div className="flex items-center justify-between text-sm text-slate-400">
            <span>{formatDateTime(post.created_at)}</span>
            <span>조회 {post.views}</span>
          </div>
        </div>

        {/* 본문 (HTML 렌더링) */}
        <div className="px-6 py-6">
          <div
            className="text-slate-700 text-sm leading-relaxed prose prose-sm max-w-none [&_img]:max-w-full [&_img]:rounded-lg [&_img]:my-2 [&_img]:cursor-pointer"
            dangerouslySetInnerHTML={{ __html: post.content }}
            onClick={(e) => {
              const target = e.target as HTMLElement;
              if (target.tagName === "IMG") setLightbox((target as HTMLImageElement).src);
            }}
          />
        </div>
      </article>

      {/* 관리자 버튼 */}
      {isAdmin && (
        <div className="flex gap-3 justify-end mt-4">
          <Link
            href={`/board/${id}/edit`}
            className="px-4 py-2 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
          >
            수정
          </Link>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-4 py-2 bg-red-500 text-white text-sm font-medium rounded-lg hover:bg-red-600 disabled:opacity-60 transition-colors"
          >
            {deleting ? "삭제 중..." : "삭제"}
          </button>
        </div>
      )}

      {/* 라이트박스 */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="relative max-w-4xl max-h-full w-full h-full flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightbox}
              alt="확대 이미지"
              className="max-w-full max-h-full object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              onClick={() => setLightbox(null)}
              className="absolute top-0 right-0 w-8 h-8 bg-white/20 text-white rounded-full text-sm flex items-center justify-center hover:bg-white/40 transition-colors"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
