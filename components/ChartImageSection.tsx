"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Image from "next/image";

interface ChartImage {
  slot: number;
  url: string | null;
}

export default function ChartImageSection() {
  const [images, setImages] = useState<ChartImage[]>([
    { slot: 1, url: null },
  ]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [uploading, setUploading] = useState<number | null>(null);
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/admin/chart-image")
      .then((r) => r.json())
      .then((data: ChartImage[]) => {
        if (Array.isArray(data)) {
          const slot1 = data.find((d) => d.slot === 1);
          if (slot1) setImages([slot1]);
        }
      });

    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.email === process.env.NEXT_PUBLIC_ADMIN_EMAIL) {
        setIsAdmin(true);
      }
    });
  }, []);

  const uploadFile = async (file: File, slot: number) => {
    setUploading(slot);
    const formData = new FormData();
    formData.append("slot", String(slot));
    formData.append("file", file);

    const res = await fetch("/api/admin/chart-image", {
      method: "POST",
      body: formData,
    });

    if (res.ok) {
      const { url } = await res.json();
      setImages((prev) =>
        prev.map((img) => (img.slot === slot ? { ...img, url } : img))
      );
    }
    setUploading(null);
  };

  // 클립보드 붙여넣기 (관리자 전용)
  useEffect(() => {
    if (!isAdmin) return;
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) uploadFile(file, 1);
          break;
        }
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [isAdmin]);

  const handleUploadClick = (slot: number) => {
    setActiveSlot(slot);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || activeSlot === null) return;
    await uploadFile(file, activeSlot);
    setActiveSlot(null);
    e.target.value = "";
  };

  const handleDelete = async (slot: number) => {
    if (!confirm("이미지를 삭제하시겠습니까?")) return;

    const res = await fetch("/api/admin/chart-image", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot }),
    });

    if (res.ok) {
      setImages((prev) =>
        prev.map((img) => (img.slot === slot ? { ...img, url: null } : img))
      );
    }
  };

  const hasAnyImage = images.some((img) => img.url);

  // 비관리자 + 이미지 없음 → 렌더하지 않음
  if (!isAdmin && !hasAnyImage) return null;

  return (
    <div className="h-full">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
      {images.map((img) => (
        <div
          key={img.slot}
          className="bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col aspect-square"
        >
          {img.url ? (
            <div className="relative flex-1">
              <Image
                src={img.url}
                alt={`차트 ${img.slot}`}
                fill
                className="object-contain"
                unoptimized
              />
              {isAdmin && (
                <div className="absolute top-1.5 right-1.5 flex gap-1">
                  <button
                    onClick={() => handleUploadClick(img.slot)}
                    disabled={uploading === img.slot}
                    className="text-xs bg-blue-600 text-white px-2 py-1 rounded shadow hover:bg-blue-700 disabled:opacity-50"
                  >
                    교체
                  </button>
                  <button
                    onClick={() => handleDelete(img.slot)}
                    className="text-xs bg-red-500 text-white px-2 py-1 rounded shadow hover:bg-red-600"
                  >
                    삭제
                  </button>
                </div>
              )}
            </div>
          ) : isAdmin ? (
            <button
              onClick={() => handleUploadClick(img.slot)}
              disabled={uploading === img.slot}
              className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
            >
              {uploading === img.slot ? (
                <span className="text-xs">업로드 중...</span>
              ) : (
                <>
                  <span className="text-3xl font-light">+</span>
                  <span className="text-xs">차트 이미지 {img.slot} 업로드</span>
                </>
              )}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
