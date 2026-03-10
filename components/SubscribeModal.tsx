"use client";

import { useRouter } from "next/navigation";

interface SubscribeModalProps {
  onClose: () => void;
  userId: string;
  userEmail?: string;
  userName?: string;
}

export default function SubscribeModal({ onClose }: SubscribeModalProps) {
  const router = useRouter();

  const handleSubscribe = () => {
    onClose();
    router.push("/payment/checkout");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-sm w-full mx-4">
        <div className="text-center mb-6">
          <div className="text-5xl mb-4">📊</div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">구독이 필요합니다</h2>
          <p className="text-sm text-slate-500 mb-4">
            증권 리포트 다운로드는 구독 회원 전용 서비스입니다.
          </p>
          <div className="bg-blue-50 rounded-xl p-4 text-left">
            <p className="text-sm font-semibold text-blue-800 mb-2">✅ 구독 혜택</p>
            <ul className="text-sm text-blue-700 space-y-1">
              <li>• 모든 증권사 리포트 무제한 다운로드</li>
              <li>• 최신 반도체 분석 리포트 제공</li>
              <li>• 월간 뉴스레터 발송</li>
            </ul>
            <p className="text-lg font-bold text-blue-800 mt-3">월 9,900원</p>
          </div>
        </div>

        <button
          onClick={handleSubscribe}
          className="w-full flex items-center justify-center gap-3 py-3 px-4 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-xl transition-colors"
        >
          <span className="font-bold text-lg">toss</span>
          <span>토스페이먼츠로 구독하기</span>
        </button>

        <button
          onClick={onClose}
          className="w-full mt-3 py-2.5 text-sm text-slate-400 hover:text-slate-600 transition-colors"
        >
          닫기
        </button>
      </div>
    </div>
  );
}
