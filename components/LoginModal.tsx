"use client";

import { createClient } from "@/lib/supabase/client";

interface LoginModalProps {
  onClose: () => void;
}

export default function LoginModal({ onClose }: LoginModalProps) {
  const supabase = createClient();

  const handleKakaoLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "kakao",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/reports`,
      },
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-sm w-full mx-4">
        <div className="text-center mb-6">
          <div className="text-5xl mb-4">🔐</div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">로그인이 필요합니다</h2>
          <p className="text-sm text-slate-500">
            증권 리포트를 열람하려면 카카오 계정으로 로그인해주세요.
          </p>
        </div>

        <button
          onClick={handleKakaoLogin}
          className="w-full flex items-center justify-center gap-3 py-3 px-4 bg-yellow-400 hover:bg-yellow-500 text-slate-800 font-semibold rounded-xl transition-colors"
        >
          <span className="text-xl">🗨️</span>
          <span>카카오로 계속하기</span>
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
