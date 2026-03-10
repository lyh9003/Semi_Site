"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loadTossPayments } from "@tosspayments/tosspayments-sdk";
import { createClient } from "@/lib/supabase/client";

export default function CheckoutPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [paying, setPaying] = useState(false);
  const widgetsRef = useRef<Awaited<ReturnType<Awaited<ReturnType<typeof loadTossPayments>>["widgets"]>> | null>(null);
  const userIdRef = useRef<string>("");
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const init = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/reports");
        return;
      }
      userIdRef.current = user.id;

      const tossPayments = await loadTossPayments(process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY!);
      const widgets = tossPayments.widgets({ customerKey: user.id });
      widgetsRef.current = widgets;

      await widgets.setAmount({ currency: "KRW", value: 9900 });
      await widgets.renderPaymentMethods({ selector: "#payment-method" });
      const agreementWidget = await widgets.renderAgreement({ selector: "#agreement" });

      agreementWidget.on("agreementStatusChange", (status) => {
        setAgreed(status.agreedRequiredTerms);
      });

      setReady(true);
    };

    init();
  }, [router]);

  const handlePay = async () => {
    if (!widgetsRef.current || !userIdRef.current) return;
    setPaying(true);
    try {
      const orderId = `semicon_${userIdRef.current.slice(0, 8)}_${Date.now()}`;
      await widgetsRef.current.requestPayment({
        orderId,
        orderName: "SemiCon Weekly 월 구독권",
        successUrl: `${window.location.origin}/payment/success`,
        failUrl: `${window.location.origin}/payment/fail`,
      });
    } catch (e) {
      // 사용자가 결제창을 닫으면 무시
      setPaying(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-10">
      <button
        onClick={() => router.back()}
        className="text-sm text-slate-400 hover:text-slate-600 mb-6 inline-flex items-center gap-1"
      >
        ← 돌아가기
      </button>

      <h1 className="text-2xl font-bold text-slate-800 mb-6">구독 결제</h1>

      <div className="bg-blue-50 rounded-xl p-4 mb-6">
        <p className="font-semibold text-blue-800">SemiCon Weekly 월 구독권</p>
        <ul className="text-sm text-blue-700 mt-2 space-y-1">
          <li>• 모든 증권사 리포트 무제한 다운로드</li>
          <li>• 최신 반도체 분석 리포트 제공</li>
          <li>• 월간 뉴스레터 발송</li>
        </ul>
        <p className="text-2xl font-bold text-blue-900 mt-3">9,900원 / 월</p>
      </div>

      {/* 위젯 렌더링 영역 */}
      <div id="payment-method" className="mb-4" />
      <div id="agreement" className="mb-6" />

      {ready && (
        <button
          onClick={handlePay}
          disabled={!agreed || paying}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors"
        >
          {paying ? "결제 처리 중..." : "9,900원 결제하기"}
        </button>
      )}

      {!ready && (
        <div className="w-full py-3 bg-slate-100 rounded-xl text-center text-slate-400 text-sm animate-pulse">
          결제 위젯 로딩 중...
        </div>
      )}
    </div>
  );
}
