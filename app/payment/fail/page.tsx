"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

function FailContent() {
  const searchParams = useSearchParams();
  const message = searchParams.get("message") ?? "결제가 취소됐거나 오류가 발생했습니다.";

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center max-w-sm mx-4">
        <div className="text-5xl mb-4">😢</div>
        <h1 className="text-xl font-bold text-slate-800 mb-2">결제에 실패했습니다</h1>
        <p className="text-sm text-slate-500 mb-6">{message}</p>
        <div className="flex flex-col gap-3">
          <Link
            href="/reports"
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
          >
            다시 시도하기
          </Link>
          <Link href="/" className="text-sm text-slate-400 hover:text-slate-600">
            홈으로 돌아가기
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function PaymentFailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><p className="text-slate-400">로딩 중...</p></div>}>
      <FailContent />
    </Suspense>
  );
}
