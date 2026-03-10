"use client";

import { useEffect, useState, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";

export default function PaymentSuccessPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const confirmed = useRef(false);

  useEffect(() => {
    if (confirmed.current) return;
    confirmed.current = true;

    const paymentKey = searchParams.get("paymentKey");
    const orderId = searchParams.get("orderId");
    const amount = searchParams.get("amount");

    if (!paymentKey || !orderId || !amount) {
      setErrorMsg("결제 정보가 올바르지 않습니다.");
      setStatus("error");
      return;
    }

    fetch("/api/payment/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentKey,
        orderId,
        amount: Number(amount),
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? "승인 실패");
        }
        setStatus("success");
        // 하드 리다이렉트로 reports 페이지 완전 새로고침 (캐시 무효화)
        setTimeout(() => { window.location.href = "/reports?payment=success"; }, 2500);
      })
      .catch((e) => {
        setErrorMsg(e.message);
        setStatus("error");
      });
  }, []);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-bounce">💳</div>
          <p className="text-lg font-semibold text-slate-700">결제를 처리하고 있습니다...</p>
          <p className="text-sm text-slate-400 mt-2">잠시만 기다려주세요.</p>
        </div>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">🎉</div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">구독이 완료됐습니다!</h1>
          <p className="text-slate-500 mb-2">이제 모든 증권 리포트를 다운로드할 수 있습니다.</p>
          <p className="text-sm text-slate-400">잠시 후 자동으로 이동합니다...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center max-w-sm mx-4">
        <div className="text-5xl mb-4">😥</div>
        <h1 className="text-xl font-bold text-slate-800 mb-2">결제 처리 중 오류가 발생했습니다</h1>
        <p className="text-sm text-red-500 mb-6">{errorMsg}</p>
        <Link
          href="/reports"
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
        >
          리포트 페이지로 돌아가기
        </Link>
      </div>
    </div>
  );
}
