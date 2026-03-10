import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";

export const metadata: Metadata = {
  title: "SemiCon Weekly | 반도체 뉴스레터",
  description: "반도체 산업의 최신 뉴스와 증권 리포트를 한눈에. 국내외 반도체 기업 분석, AI 메모리, HBM, 파운드리 동향을 전달합니다.",
  keywords: ["반도체", "뉴스레터", "HBM", "메모리", "파운드리", "삼성전자", "SK하이닉스"],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-slate-50">
        <Header />
        <main>{children}</main>
        <footer className="mt-16 border-t border-slate-200 bg-white">
          <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-blue-600">⬡</span>
              <span className="font-bold text-slate-700">SemiCon Weekly</span>
            </div>
            <p className="text-sm text-slate-400">
              © 2025 SemiCon Weekly. 반도체 산업의 인사이트를 전달합니다.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
