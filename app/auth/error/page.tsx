import Link from "next/link";

export default function AuthErrorPage() {
  return (
    <div className="max-w-md mx-auto px-4 py-20 text-center">
      <div className="text-5xl mb-4">😵</div>
      <h1 className="text-2xl font-bold text-slate-800 mb-2">로그인에 실패했습니다</h1>
      <p className="text-slate-500 mb-6">인증 과정에서 오류가 발생했습니다. 다시 시도해주세요.</p>
      <Link
        href="/"
        className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
      >
        홈으로 돌아가기
      </Link>
    </div>
  );
}
